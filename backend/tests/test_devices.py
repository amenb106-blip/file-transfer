from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from db import PairingInvite
from main import app
from test_api import HEADERS, setup, s3
from test_multipart import put_parts, TOKEN

ACTION = {"X-Device-Action": "1"}


def device(name):
    client = TestClient(app, base_url="https://testserver")
    response = client.post("/api/devices", headers=HEADERS, json={"name": name})
    assert response.status_code == 200, response.text
    assert client.get("/api/devices/me").json() == response.json()
    assert "HttpOnly" in response.headers["set-cookie"] and "Secure" in response.headers["set-cookie"]
    return client, response.json()


def connect(sender, receiver):
    invite = sender.post("/api/pairings", headers=ACTION).json()
    claimed = receiver.post("/api/pairings/claim", headers=ACTION, json={"token": invite["token"]})
    assert claimed.status_code == 200, claimed.text
    response = sender.post(f"/api/pairings/{invite['id']}/confirm", headers=ACTION,
                           json={"claimant_id": claimed.json()["claimant"]["id"]})
    assert response.status_code == 200, response.text
    return invite


def test_pairing_requires_both_devices_and_blocks_reuse(setup):
    laptop, laptop_info = device("Laptop")
    phone, phone_info = device("Phone")
    stranger, _ = device("Stranger")
    invite = laptop.post("/api/pairings", headers=ACTION).json()
    body = {"token": invite["token"]}
    assert laptop.post("/api/pairings/claim", headers=ACTION, json=body).status_code == 409
    assert phone.post("/api/pairings/claim", headers=ACTION, json=body).status_code == 200
    assert phone.get("/api/devices/peers").json() == []
    assert stranger.post("/api/pairings/inspect", headers=ACTION, json=body).status_code == 409
    assert stranger.post("/api/pairings/claim", headers=ACTION, json=body).status_code == 409
    path = f"/api/pairings/{invite['id']}/confirm"
    assert phone.post(path, headers=ACTION, json={"claimant_id": phone_info["id"]}).status_code == 410
    assert laptop.post(path, headers=ACTION, json={"claimant_id": phone_info["id"]}).status_code == 200
    assert laptop.post(path, headers=ACTION, json={"claimant_id": phone_info["id"]}).status_code == 200
    assert laptop.get("/api/devices/peers").json() == [phone_info]
    assert phone.get("/api/devices/peers").json() == [laptop_info]


def test_private_delivery_is_only_available_to_paired_recipient(setup, s3):
    _, engine = setup
    laptop, laptop_info = device("Laptop")
    phone, phone_info = device("Phone")
    stranger, _ = device("Stranger")
    invite = connect(laptop, phone)
    response = laptop.post("/api/multipart-transfers", headers=HEADERS,
                           json={"filename": "hello.txt", "size_bytes": 5, "recipient_id": phone_info["id"]})
    assert response.status_code == 201, response.text
    transfer = response.json()
    assert phone.get("/api/inbox").json() == []
    parts = put_parts(s3, engine, transfer, [b"hello"])
    path = f"/api/multipart-transfers/{transfer['id']}/complete"
    body = {"share_token": TOKEN, "parts": parts}
    assert stranger.post(path, headers=HEADERS, json=body).status_code == 403
    assert laptop.post(path, headers=HEADERS, json=body).status_code == 200
    inbox = phone.get("/api/inbox")
    assert inbox.status_code == 200, inbox.text
    assert inbox.json()[0]["sender_name"] == "Laptop"
    assert inbox.json()[0]["id"] == transfer["id"]
    assert laptop.get("/api/inbox").json() == [] and stranger.get("/api/inbox").json() == []
    download = f"/api/inbox/{transfer['id']}/download"
    assert phone.post(download, headers=ACTION).status_code == 200
    assert stranger.post(download, headers=ACTION).status_code == 404
    assert phone.get(f"/api/share/{TOKEN}").status_code == 404
    assert phone.post(f"/api/share/{TOKEN}/download").status_code == 404
    assert phone.delete(f"/api/devices/peers/{laptop_info['id']}", headers=ACTION).status_code == 200
    assert phone.get("/api/inbox").json() == []
    assert phone.post(download, headers=ACTION).status_code == 404
    assert laptop.post(f"/api/pairings/{invite['id']}/confirm", headers=ACTION,
                       json={"claimant_id": phone_info["id"]}).status_code == 410


def test_missing_auth_csrf_and_expired_invites(setup):
    client, engine = setup
    assert client.get("/api/inbox").status_code == 401
    laptop, _ = device("Laptop")
    phone, _ = device("Phone")
    assert laptop.post("/api/pairings").status_code == 403
    invite = laptop.post("/api/pairings", headers=ACTION).json()
    with Session(engine) as session:
        session.get(PairingInvite, invite["id"]).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()
    assert phone.post("/api/pairings/claim", headers=ACTION, json={"token": invite["token"]}).status_code == 410
