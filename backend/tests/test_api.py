import os
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

# Set before importing the app so tests never connect to the real database.
os.environ["DATABASE_URL"] = "sqlite://"

from db import Base, Transfer
from main import MAX_FILE_SIZE, app, get_db

TEST_PASSCODE = "test-only-passcode"
HEADERS = {"X-Upload-Passcode": TEST_PASSCODE}


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("UPLOAD_PASSCODE", TEST_PASSCODE)
    test_engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(test_engine)

    def test_db():
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            yield client, test_engine
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_health(setup):
    client, _ = setup
    assert client.get("/api/health").json() == {"status": "ok"}


@pytest.mark.parametrize("size", [1, MAX_FILE_SIZE])
def test_create_transfer_saves_pending_metadata(setup, size):
    client, test_engine = setup
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": "notes.pdf", "size_bytes": size})
    assert response.status_code == 201
    data = response.json()
    UUID(data["id"])
    assert data["status"] == "pending"
    assert datetime.fromisoformat(data["expires_at"]) - datetime.fromisoformat(data["created_at"]) == timedelta(hours=1)
    assert "s3_key" not in data and "share_token_hash" not in data
    with Session(test_engine) as session:
        record = session.get(Transfer, data["id"])
        assert record.filename == "notes.pdf" and record.size_bytes == size
        assert record.download_count == 0
        assert record.s3_key is None and record.share_token_hash is None


@pytest.mark.parametrize("passcode", [None, "wrong-passcode"])
def test_unauthorized_request_creates_no_record(setup, passcode):
    client, test_engine = setup
    headers = {"X-Upload-Passcode": passcode} if passcode else {}
    response = client.post("/api/transfers", headers=headers, json={"filename": "notes.pdf", "size_bytes": 100})
    assert response.status_code == 401
    with Session(test_engine) as session:
        assert session.scalars(select(Transfer)).all() == []


def test_unconfigured_passcode_fails_closed(setup, monkeypatch):
    client, _ = setup
    monkeypatch.delenv("UPLOAD_PASSCODE")
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": "notes.pdf", "size_bytes": 100})
    assert response.status_code == 503


@pytest.mark.parametrize("size", [0, -1, MAX_FILE_SIZE + 1, 1.5, "100", True])
def test_invalid_size_creates_no_record(setup, size):
    client, test_engine = setup
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": "notes.pdf", "size_bytes": size})
    assert response.status_code == 422
    with Session(test_engine) as session:
        assert session.scalars(select(Transfer)).all() == []


@pytest.mark.parametrize("filename", ["", "   ", ".", "..", "../notes.pdf", "folder\\notes.pdf", "bad\r\nname", "bad\x00name", "x" * 256])
def test_invalid_filename(setup, filename):
    client, _ = setup
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": filename, "size_bytes": 100})
    assert response.status_code == 422


def test_client_cannot_set_ready_status(setup):
    client, _ = setup
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": "notes.pdf", "size_bytes": 100, "status": "ready"})
    assert response.status_code == 422


def test_database_failure_is_generic_and_rolls_back(setup, monkeypatch):
    client, test_engine = setup

    def fail_commit(self):
        raise SQLAlchemyError("private connection details must not appear")

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.post("/api/transfers", headers=HEADERS, json={"filename": "notes.pdf", "size_bytes": 100})
    assert response.status_code == 503
    assert "private connection" not in response.text
    with Session(test_engine) as session:
        assert session.scalars(select(Transfer)).all() == []
