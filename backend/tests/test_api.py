import base64
import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote, urlparse
from uuid import UUID

import boto3
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from moto import mock_aws
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite://"

from db import Base, Transfer
from main import MAX_FILE_SIZE, app, get_db, hash_token
from storage import content_disposition, get_s3

TEST_PASSCODE = "test-only-passcode"
TEST_BUCKET = "test-bucket"
HEADERS = {"X-Upload-Passcode": TEST_PASSCODE}


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.delenv("AWS_SESSION_TOKEN", raising=False)
    monkeypatch.setenv("AWS_REGION", "us-east-2")
    monkeypatch.setenv("S3_BUCKET", TEST_BUCKET)
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-2")
        client.create_bucket(
            Bucket=TEST_BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-east-2"}
        )
        yield client


@pytest.fixture
def setup(monkeypatch, s3):
    monkeypatch.setenv("UPLOAD_PASSCODE", TEST_PASSCODE)
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(test_engine)

    def test_db():
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[get_s3] = lambda: s3
    try:
        with TestClient(app) as client:
            yield client, test_engine
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def create(client, filename="notes.pdf", size=100, headers=HEADERS):
    return client.post("/api/transfers", headers=headers, json={"filename": filename, "size_bytes": size})


def complete(client, transfer_id, headers=HEADERS, token=None):
    body = {"json": {"share_token": token}} if token is not None else {}
    return client.post(f"/api/transfers/{transfer_id}/complete", headers=headers, **body)


def upload(s3, transfer, body):
    s3.put_object(Bucket=TEST_BUCKET, Key=f"transfers/{transfer['id']}", Body=body)


def share(client, s3, body=b"hello", filename="notes.pdf"):
    transfer = create(client, filename=filename, size=len(body)).json()
    upload(s3, transfer, body)
    response = complete(client, transfer["id"])
    assert response.status_code == 200
    return transfer, response.json()["share_token"]


def expire(test_engine, transfer_id):
    with Session(test_engine) as session:
        session.get(Transfer, transfer_id).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()


def all_transfers(test_engine):
    with Session(test_engine) as session:
        return session.scalars(select(Transfer)).all()


def test_health(setup):
    client, _ = setup
    assert client.get("/api/health").json() == {"status": "ok"}


@pytest.mark.parametrize("size", [1, MAX_FILE_SIZE])
def test_create_transfer_saves_pending_metadata(setup, size):
    client, test_engine = setup
    response = create(client, size=size)
    assert response.status_code == 201
    data = response.json()
    UUID(data["id"])
    assert data["status"] == "pending"
    assert datetime.fromisoformat(data["expires_at"]) - datetime.fromisoformat(data["created_at"]) == timedelta(minutes=10)
    assert "s3_key" not in data and "share_token_hash" not in data
    with Session(test_engine) as session:
        record = session.get(Transfer, data["id"])
        assert record.filename == "notes.pdf" and record.size_bytes == size
        assert record.download_count == 0
        assert record.s3_key == f"transfers/{data['id']}"
        assert record.share_token_hash is None


def test_upload_permission_only_allows_the_declared_size(setup):
    client, _ = setup
    data = create(client, size=1234).json()
    fields = data["upload"]["fields"]
    assert fields["key"] == f"transfers/{data['id']}"
    policy = json.loads(base64.b64decode(fields["policy"]))
    assert ["content-length-range", 1234, 1234] in policy["conditions"]


def test_upload_key_does_not_contain_filename(setup):
    client, _ = setup
    data = create(client, filename="secret plans.pdf").json()
    assert "secret" not in data["upload"]["fields"]["key"]


@pytest.mark.parametrize("passcode", [None, "wrong-passcode"])
def test_unauthorized_request_creates_no_record(setup, passcode):
    client, test_engine = setup
    headers = {"X-Upload-Passcode": passcode} if passcode else {}
    response = create(client, headers=headers)
    assert response.status_code == 401
    assert "upload" not in response.json()
    assert all_transfers(test_engine) == []


def test_unconfigured_passcode_fails_closed(setup, monkeypatch):
    client, _ = setup
    monkeypatch.delenv("UPLOAD_PASSCODE")
    assert create(client).status_code == 503


def test_unconfigured_storage_creates_no_record(setup, monkeypatch):
    client, test_engine = setup
    monkeypatch.delenv("S3_BUCKET")
    response = create(client)
    assert response.status_code == 503
    assert all_transfers(test_engine) == []


@pytest.mark.parametrize("size", [0, -1, MAX_FILE_SIZE + 1, 1.5, "100", True])
def test_invalid_size_creates_no_record(setup, size):
    client, test_engine = setup
    response = create(client, size=size)
    assert response.status_code == 422
    assert all_transfers(test_engine) == []


@pytest.mark.parametrize("filename", ["", "   ", ".", "..", "../notes.pdf", "folder\\notes.pdf", "bad\r\nname", "bad\x00name", "x" * 256])
def test_invalid_filename(setup, filename):
    client, _ = setup
    assert create(client, filename=filename).status_code == 422


def test_client_cannot_set_ready_status(setup):
    client, _ = setup
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": "notes.pdf", "size_bytes": 100, "status": "ready"})
    assert response.status_code == 422


def test_database_failure_is_generic_and_rolls_back(setup, monkeypatch):
    client, test_engine = setup

    def fail_commit(self):
        raise SQLAlchemyError("private connection details must not appear")

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = create(client)
    assert response.status_code == 503
    assert "private connection" not in response.text
    assert all_transfers(test_engine) == []


def test_complete_marks_ready_and_stores_only_token_hash(setup, s3):
    client, test_engine = setup
    transfer, token = share(client, s3)
    assert len(token) >= 40
    with Session(test_engine) as session:
        record = session.get(Transfer, transfer["id"])
        assert record.status == "ready"
        assert record.share_token_hash == hash_token(token)
        assert token not in record.share_token_hash


def test_complete_before_upload_is_refused(setup):
    client, test_engine = setup
    transfer = create(client).json()
    response = complete(client, transfer["id"])
    assert response.status_code == 409
    assert all_transfers(test_engine)[0].status == "pending"


def test_complete_with_wrong_size_is_refused(setup, s3):
    client, test_engine = setup
    transfer = create(client, size=100).json()
    upload(s3, transfer, b"x" * 99)
    assert complete(client, transfer["id"]).status_code == 409
    assert all_transfers(test_engine)[0].status == "pending"


def test_complete_twice_is_refused(setup, s3):
    client, _ = setup
    transfer, _ = share(client, s3)
    assert complete(client, transfer["id"]).status_code == 409


def test_completion_retry_recovers_same_link_without_storage_access(setup, s3, monkeypatch):
    client, test_engine = setup
    transfer = create(client, size=5).json()
    upload(s3, transfer, b"hello")
    token = "ab" * 32
    first = complete(client, transfer["id"], token=token)
    assert first.status_code == 200
    monkeypatch.setattr(s3, "head_object", lambda **kwargs: pytest.fail("Retry must not recheck S3"))
    retry = complete(client, transfer["id"], token=token)
    assert retry.status_code == 200
    assert retry.json() == first.json()
    assert all_transfers(test_engine)[0].share_token_hash == hash_token(token)
    assert client.get(f"/api/share/{token}").status_code == 200
    assert complete(client, transfer["id"], token="cd" * 32).status_code == 409
    assert complete(client, transfer["id"], token=token, headers={}).status_code == 401
    expire(test_engine, transfer["id"])
    assert complete(client, transfer["id"], token=token).status_code == 410


@pytest.mark.parametrize("other_token, expected", [("ab" * 32, 200), ("cd" * 32, 409)])
def test_overlapping_completions_preserve_winning_link(setup, s3, monkeypatch, other_token, expected):
    import storage

    client, _ = setup
    transfer = create(client, size=5).json()
    upload(s3, transfer, b"hello")
    original = storage.uploaded_size

    def finish_other_request(s3_client, key):
        monkeypatch.setattr(storage, "uploaded_size", original)
        assert complete(client, transfer["id"], token=other_token).status_code == 200
        return original(s3_client, key)

    monkeypatch.setattr(storage, "uploaded_size", finish_other_request)
    assert complete(client, transfer["id"], token="ab" * 32).status_code == expected
    assert client.get(f"/api/share/{other_token}").status_code == 200


@pytest.mark.parametrize("token", ["", "a" * 63, "a" * 65, "z" * 64])
def test_completion_rejects_invalid_retry_tokens(setup, token):
    client, _ = setup
    transfer = create(client).json()
    assert complete(client, transfer["id"], token=token).status_code == 422


def test_failed_completion_commit_can_be_retried(setup, s3, monkeypatch):
    client, _ = setup
    transfer = create(client, size=5).json()
    upload(s3, transfer, b"hello")
    with monkeypatch.context() as patch:
        def fail_commit(self):
            raise SQLAlchemyError("private database details")
        patch.setattr(Session, "commit", fail_commit)
        assert complete(client, transfer["id"], token="ab" * 32).status_code == 503
    assert complete(client, transfer["id"], token="ab" * 32).status_code == 200


def test_completion_cannot_publish_a_transfer_that_expires_during_verification(setup, s3, monkeypatch):
    import storage

    client, test_engine = setup
    transfer = create(client, size=5).json()
    upload(s3, transfer, b"hello")
    original = storage.uploaded_size

    def expire_during_verification(s3_client, key):
        expire(test_engine, transfer["id"])
        return original(s3_client, key)

    monkeypatch.setattr(storage, "uploaded_size", expire_during_verification)
    assert complete(client, transfer["id"], token="ab" * 32).status_code == 410
    assert all_transfers(test_engine)[0].status == "pending"


def test_complete_requires_passcode(setup, s3):
    client, test_engine = setup
    transfer = create(client, size=5).json()
    upload(s3, transfer, b"hello")
    assert complete(client, transfer["id"], headers={"X-Upload-Passcode": "wrong"}).status_code == 401
    assert all_transfers(test_engine)[0].status == "pending"


def test_complete_unknown_transfer(setup):
    client, _ = setup
    assert complete(client, "00000000-0000-0000-0000-000000000000").status_code == 404


def test_complete_expired_transfer_is_refused(setup, s3):
    client, test_engine = setup
    transfer = create(client, size=5).json()
    upload(s3, transfer, b"hello")
    expire(test_engine, transfer["id"])
    assert complete(client, transfer["id"]).status_code == 410


def test_share_info_does_not_count_as_download(setup, s3):
    client, test_engine = setup
    transfer, token = share(client, s3)
    response = client.get(f"/api/share/{token}")
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "notes.pdf" and data["size_bytes"] == 5
    assert datetime.fromisoformat(data["expires_at"]).tzinfo is not None
    assert "id" not in data and "s3_key" not in data
    assert all_transfers(test_engine)[0].download_count == 0


def test_download_returns_short_lived_link_and_counts(setup, s3):
    client, test_engine = setup
    transfer, token = share(client, s3)
    response = client.post(f"/api/share/{token}/download")
    assert response.status_code == 200
    url = urlparse(response.json()["url"])
    assert url.path.endswith(f"transfers/{transfer['id']}")
    query = parse_qs(url.query)
    assert query["X-Amz-Expires"] == ["60"]
    assert 'filename="notes.pdf"' in unquote(query["response-content-disposition"][0])
    assert all_transfers(test_engine)[0].download_count == 1


@pytest.mark.parametrize("token", ["not-a-real-token", "x" * 128])
def test_unknown_token_is_refused(setup, token):
    client, _ = setup
    assert client.get(f"/api/share/{token}").status_code == 404
    assert client.post(f"/api/share/{token}/download").status_code == 404


def test_pending_transfer_cannot_be_downloaded(setup):
    client, _ = setup
    transfer = create(client).json()
    assert client.get(f"/api/share/{transfer['id']}").status_code == 404


def test_expired_link_is_refused(setup, s3):
    client, test_engine = setup
    transfer, token = share(client, s3)
    expire(test_engine, transfer["id"])
    assert client.get(f"/api/share/{token}").status_code == 410
    assert client.post(f"/api/share/{token}/download").status_code == 410
    assert all_transfers(test_engine)[0].download_count == 0


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("notes.pdf", "attachment; filename=\"notes.pdf\"; filename*=UTF-8''notes.pdf"),
        ('my "best" résumé.pdf', "attachment; filename=\"my _best_ r_sum_.pdf\"; filename*=UTF-8''my%20%22best%22%20r%C3%A9sum%C3%A9.pdf"),
    ],
)
def test_content_disposition_keeps_original_filename(filename, expected):
    assert content_disposition(filename) == expected


CRON_HEADERS = {"Authorization": "Bearer test-cleanup-secret"}


def make_cleanup_eligible(test_engine, transfer_id):
    with Session(test_engine) as session:
        session.get(Transfer, transfer_id).expires_at = datetime.now(timezone.utc) - timedelta(hours=2)
        session.commit()


def test_cleanup_deletes_old_ready_and_abandoned_transfers(setup, s3, monkeypatch):
    client, test_engine = setup
    monkeypatch.setenv("CRON_SECRET", "test-cleanup-secret")
    ready, _ = share(client, s3)
    abandoned = create(client, size=5).json()
    upload(s3, abandoned, b"hello")
    missing = create(client).json()
    active, token = share(client, s3)
    recent, _ = share(client, s3)
    expire(test_engine, recent["id"])
    for transfer in [ready, abandoned, missing]:
        make_cleanup_eligible(test_engine, transfer["id"])
    result = client.get("/api/cron/cleanup", headers=CRON_HEADERS)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert result.json() == {"deleted": 3, "failed": 0, "remaining": False}
    assert {record.id for record in all_transfers(test_engine)} == {active["id"], recent["id"]}
    keys = {obj["Key"] for obj in s3.list_objects_v2(Bucket=TEST_BUCKET)["Contents"]}
    assert keys == {f"transfers/{active['id']}", f"transfers/{recent['id']}"}
    assert client.get(f"/api/share/{token}").status_code == 200
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).json()["deleted"] == 0


@pytest.mark.parametrize("headers", [{}, HEADERS, {"Authorization": "Bearer wrong"}])
def test_cleanup_requires_its_own_secret(setup, s3, monkeypatch, headers):
    client, test_engine = setup
    monkeypatch.setenv("CRON_SECRET", "test-cleanup-secret")
    transfer, _ = share(client, s3)
    make_cleanup_eligible(test_engine, transfer["id"])
    assert client.get("/api/cron/cleanup", headers=headers).status_code == 401
    assert len(all_transfers(test_engine)) == 1
    assert s3.head_object(Bucket=TEST_BUCKET, Key=f"transfers/{transfer['id']}")["ContentLength"] == 5


def test_unconfigured_cleanup_fails_closed(setup, monkeypatch):
    client, _ = setup
    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).status_code == 503


def test_cleanup_keeps_failed_deletions_for_retry(setup, s3, monkeypatch):
    client, test_engine = setup
    monkeypatch.setenv("CRON_SECRET", "test-cleanup-secret")
    failed, _ = share(client, s3)
    removed, _ = share(client, s3)
    for transfer in [failed, removed]:
        make_cleanup_eligible(test_engine, transfer["id"])
    original = s3.delete_objects
    failed_key = f"transfers/{failed['id']}"

    def partial_delete(**kwargs):
        kwargs["Delete"]["Objects"] = [obj for obj in kwargs["Delete"]["Objects"] if obj["Key"] != failed_key]
        result = original(**kwargs)
        result["Errors"] = [{"Key": failed_key, "Code": "AccessDenied"}]
        return result

    with monkeypatch.context() as patch:
        patch.setattr(s3, "delete_objects", partial_delete)
        response = client.get("/api/cron/cleanup", headers=CRON_HEADERS)
    assert response.status_code == 503
    assert response.json() == {"deleted": 1, "failed": 1, "remaining": True}
    assert [record.id for record in all_transfers(test_engine)] == [failed["id"]]
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).json()["deleted"] == 1


@pytest.mark.parametrize("failure", ["storage", "database"])
def test_cleanup_failure_preserves_records_for_retry(setup, s3, monkeypatch, failure):
    client, test_engine = setup
    monkeypatch.setenv("CRON_SECRET", "test-cleanup-secret")
    transfer, _ = share(client, s3)
    make_cleanup_eligible(test_engine, transfer["id"])
    with monkeypatch.context() as patch:
        if failure == "storage":
            def fail_delete(**kwargs):
                raise ClientError({"Error": {"Code": "AccessDenied"}}, "DeleteObjects")
            patch.setattr(s3, "delete_objects", fail_delete)
        else:
            def fail_commit(self):
                raise SQLAlchemyError("private database details")
            patch.setattr(Session, "commit", fail_commit)
        response = client.get("/api/cron/cleanup", headers=CRON_HEADERS)
    assert response.status_code == 503
    assert "private" not in response.text
    assert len(all_transfers(test_engine)) == 1
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).json()["deleted"] == 1


def test_cleanup_bounds_each_run_and_reports_backlog(setup, s3, monkeypatch):
    import cleanup

    client, test_engine = setup
    monkeypatch.setenv("CRON_SECRET", "test-cleanup-secret")
    monkeypatch.setattr(cleanup, "CLEANUP_BATCH_SIZE", 1)
    for _ in range(2):
        transfer, _ = share(client, s3)
        make_cleanup_eligible(test_engine, transfer["id"])
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).json() == {
        "deleted": 1, "failed": 0, "remaining": True,
    }
    assert client.get("/api/cron/cleanup", headers=CRON_HEADERS).json() == {
        "deleted": 1, "failed": 0, "remaining": False,
    }
