from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from botocore.exceptions import ClientError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db import MultipartUpload, Transfer
from storage import MAX_MULTIPART_SIZE, PART_SIZE
from test_api import (HEADERS, TEST_BUCKET, CRON_HEADERS, all_transfers, expire,
                      make_cleanup_eligible, setup, s3)  # shared isolated fixtures

TOKEN = "ab" * 32


def create(client, size=5):
    return client.post("/api/multipart-transfers", headers=HEADERS,
                       json={"filename": "example.bin", "size_bytes": size})


def put_parts(s3, engine, transfer, bodies):
    with Session(engine) as session:
        upload_id = session.get(MultipartUpload, transfer["id"]).upload_id
    return [{"number": number, "etag": s3.upload_part(
        Bucket=TEST_BUCKET, Key=f"transfers/{transfer['id']}", UploadId=upload_id,
        PartNumber=number, Body=body,
    )["ETag"]} for number, body in enumerate(bodies, 1)]


def complete(client, transfer, parts, token=TOKEN):
    return client.post(f"/api/multipart-transfers/{transfer['id']}/complete", headers=HEADERS,
                       json={"share_token": token, "parts": parts})


def cancel(client, transfer):
    return client.delete(f"/api/multipart-transfers/{transfer['id']}", headers=HEADERS)


def test_multipart_upload_and_download_with_short_last_part(setup, s3):
    client, engine = setup
    transfer = create(client, PART_SIZE + 3).json()
    assert transfer["part_size"] == PART_SIZE
    assert datetime.fromisoformat(transfer["expires_at"]) - datetime.fromisoformat(transfer["created_at"]) == timedelta(hours=1)
    parts = put_parts(s3, engine, transfer, [b"a" * PART_SIZE, b"end"])
    response = complete(client, transfer, parts)
    assert response.status_code == 200
    expires = datetime.fromisoformat(response.json()["expires_at"])
    assert 590 < (expires - datetime.now(expires.tzinfo)).total_seconds() <= 600
    assert client.get(f"/api/share/{TOKEN}").status_code == 200
    obj = s3.get_object(Bucket=TEST_BUCKET, Key=f"transfers/{transfer['id']}")
    assert obj["Body"].read() == b"a" * PART_SIZE + b"end"
    assert complete(client, transfer, parts).json() == response.json()
    assert complete(client, transfer, parts, "cd" * 32).status_code == 409
    assert cancel(client, transfer).status_code == 409


def test_part_permissions_bound_number_and_length_and_require_auth(setup):
    client, _ = setup
    transfer = create(client, PART_SIZE + 3).json()
    path = f"/api/multipart-transfers/{transfer['id']}/parts/2"
    assert client.post(path).status_code == 401
    response = client.post(path, headers=HEADERS)
    assert response.status_code == 200
    query = parse_qs(urlparse(response.json()["url"]).query)
    assert query["partNumber"] == ["2"]
    assert "content-length" in query["X-Amz-SignedHeaders"][0]
    assert int(query["X-Amz-Expires"][0]) <= 600
    assert client.post(path[:-1] + "3", headers=HEADERS).status_code == 422
    assert client.post(path[:-1] + "0", headers=HEADERS).status_code == 422
    assert client.post("/api/multipart-transfers", json={"filename": "a", "size_bytes": 5}).status_code == 401
    assert create(client, MAX_MULTIPART_SIZE + 1).status_code == 422


@pytest.mark.parametrize("case", ["missing", "wrong_size", "wrong_etag", "duplicate"])
def test_incomplete_or_invalid_manifest_cannot_publish(setup, s3, case):
    client, engine = setup
    transfer = create(client, PART_SIZE + 3).json()
    parts = put_parts(s3, engine, transfer, [b"a" * PART_SIZE, b"end" if case != "wrong_size" else b"no"])
    if case == "missing":
        parts.pop()
    elif case == "wrong_etag":
        parts[0]["etag"] = '"incorrect"'
    elif case == "duplicate":
        parts[1]["number"] = 1
    assert complete(client, transfer, parts).status_code in {409, 422}
    assert all_transfers(engine)[0].status == "pending"


def test_cancel_is_idempotent_and_blocks_new_parts_and_completion(setup, s3):
    client, engine = setup
    transfer = create(client).json()
    parts = put_parts(s3, engine, transfer, [b"hello"])
    assert client.delete(f"/api/multipart-transfers/{transfer['id']}").status_code == 401
    assert cancel(client, transfer).status_code == 200
    assert cancel(client, transfer).status_code == 200
    assert not s3.list_multipart_uploads(Bucket=TEST_BUCKET).get("Uploads")
    assert complete(client, transfer, parts).status_code == 409
    assert client.post(f"/api/multipart-transfers/{transfer['id']}/parts/1", headers=HEADERS).status_code == 409


def test_expired_upload_refuses_parts_and_completion_but_allows_cancel(setup, s3):
    client, engine = setup
    transfer = create(client).json()
    parts = put_parts(s3, engine, transfer, [b"hello"])
    expire(engine, transfer["id"])
    assert complete(client, transfer, parts).status_code == 410
    assert client.post(f"/api/multipart-transfers/{transfer['id']}/parts/1", headers=HEADERS).status_code == 410
    assert cancel(client, transfer).status_code == 200


@pytest.mark.parametrize("failure", ["response", "database"])
def test_s3_completion_success_can_recover_after_lost_response_or_commit(setup, s3, monkeypatch, failure):
    client, engine = setup
    transfer = create(client).json()
    parts = put_parts(s3, engine, transfer, [b"hello"])
    original = s3.complete_multipart_upload
    with monkeypatch.context() as patch:
        if failure == "response":
            def lost_response(**kwargs):
                original(**kwargs)
                raise ClientError({"Error": {"Code": "InternalError"}}, "CompleteMultipartUpload")
            patch.setattr(s3, "complete_multipart_upload", lost_response)
        else:
            def fail_commit(self):
                raise SQLAlchemyError("private database error")
            patch.setattr(Session, "commit", fail_commit)
        assert complete(client, transfer, parts).status_code == 503
    assert all_transfers(engine)[0].status == "pending"
    assert complete(client, transfer, parts).status_code == 200


def test_creation_commit_failure_aborts_s3_upload(setup, s3, monkeypatch):
    client, engine = setup
    def fail_commit(self):
        raise SQLAlchemyError("private database error")
    monkeypatch.setattr(Session, "commit", fail_commit)
    assert create(client).status_code == 503
    assert all_transfers(engine) == []
    assert not s3.list_multipart_uploads(Bucket=TEST_BUCKET).get("Uploads")


def test_cleanup_aborts_abandoned_parts_and_retains_failures_for_retry(setup, s3, monkeypatch):
    client, engine = setup
    monkeypatch.setenv("CRON_SECRET", "test-cleanup-secret")
    transfer = create(client).json()
    put_parts(s3, engine, transfer, [b"hello"])
    make_cleanup_eligible(engine, transfer["id"])
    with monkeypatch.context() as patch:
        def fail_abort(**kwargs):
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "AbortMultipartUpload")
        patch.setattr(s3, "abort_multipart_upload", fail_abort)
        response = client.get("/api/cron/cleanup", headers=CRON_HEADERS)
        assert response.status_code == 503
        assert response.json()["failed"] == 1
    assert len(all_transfers(engine)) == 1
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).json()["deleted"] == 1
    assert not s3.list_multipart_uploads(Bucket=TEST_BUCKET).get("Uploads")
    with Session(engine) as session:
        assert session.get(MultipartUpload, transfer["id"]) is None


def test_legacy_completion_cannot_bypass_multipart_protocol(setup, s3):
    client, engine = setup
    transfer = create(client).json()
    assert client.post(f"/api/transfers/{transfer['id']}/complete", headers=HEADERS).status_code == 409
