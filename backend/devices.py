"""Pair remembered browsers and deliver files to their authenticated inboxes."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db import Device, DeviceDelivery, DevicePair, PairingInvite, Transfer
import storage


def now():
    return datetime.now(timezone.utc)


def utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def paired(session, first, second):
    return session.get(DevicePair, tuple(sorted((first, second)))) is not None


def delivery_sender(request, session, recipient_id, find_device):
    sender = find_device(request, session)
    recipient = session.get(Device, recipient_id)
    if sender is None:
        raise HTTPException(401, "Remember this browser before sending to a device.")
    if recipient is None or utc(recipient.expires_at) <= now() or not paired(session, sender.id, recipient_id):
        raise HTTPException(403, "This device is no longer connected. Pair it again.")
    return sender


def authorize_delivery(request, session, transfer_id, find_device, require_pair=True):
    delivery = session.get(DeviceDelivery, transfer_id)
    if delivery:
        sender = find_device(request, session)
        if sender is None or sender.id != delivery.sender_id:
            raise HTTPException(403, "This upload belongs to another device.")
        if require_pair:
            delivery_sender(request, session, delivery.recipient_id, find_device)
    return delivery


class PairToken(BaseModel):
    token: str = Field(pattern=r"^[0-9a-f]{64}$")


class PairConfirmation(BaseModel):
    claimant_id: str = Field(min_length=36, max_length=36)


def build_device_router(get_db, find_device):
    def private_request(request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        # Cross-origin forms cannot supply this header; no CORS access is enabled.
        if request.method != "GET" and request.headers.get("X-Device-Action") != "1":
            raise HTTPException(403, "Invalid device request.")

    router = APIRouter(prefix="/api", dependencies=[Depends(private_request)])

    def safe_db(session: Annotated[Session, Depends(get_db)]):
        try:
            yield session
        except SQLAlchemyError:
            session.rollback()
            raise HTTPException(503, "Device storage is unavailable. Try again later.") from None

    Database = Annotated[Session, Depends(safe_db)]

    def authenticated(request: Request, session: Database):
        device = find_device(request, session)
        if device is None:
            raise HTTPException(401, "Remember this browser to connect devices or open your inbox.")
        return device

    Current = Annotated[Device, Depends(authenticated)]

    def valid_invite(session, statement):
        invite = session.scalar(statement.with_for_update())
        if invite is None or utc(invite.expires_at) <= now():
            raise HTTPException(410, "This pairing invitation expired. Create a new QR code.")
        owner = session.get(Device, invite.owner_id)
        if owner is None or utc(owner.expires_at) <= now():
            raise HTTPException(410, "The inviting device has expired. Register it again.")
        return invite, owner

    def describe(invite, owner, session):
        claimant = session.get(Device, invite.claimant_id) if invite.claimant_id else None
        return {"id": invite.id, "owner_name": owner.name,
                "claimant": {"id": claimant.id, "name": claimant.name} if claimant else None,
                "status": "paired" if invite.confirmed_at else "waiting",
                "expires_at": utc(invite.expires_at)}

    @router.get("/devices/peers")
    def peers(device: Current, session: Database):
        condition = or_(and_(DevicePair.device_a == device.id, DevicePair.device_b == Device.id),
                        and_(DevicePair.device_b == device.id, DevicePair.device_a == Device.id))
        return [{"id": peer.id, "name": peer.name} for peer in session.scalars(
            select(Device).join(DevicePair, condition).where(Device.expires_at > now()).order_by(Device.name)
        ).all()]

    @router.post("/pairings")
    def invite(device: Current, session: Database):
        # Serialize generation for this device; generating a new QR cancels the old one.
        session.scalar(select(Device).where(Device.id == device.id).with_for_update())
        session.execute(delete(PairingInvite).where(PairingInvite.owner_id == device.id))
        token = secrets.token_hex(32)
        record = PairingInvite(owner_id=device.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                               expires_at=now() + timedelta(minutes=10))
        session.add(record)
        session.flush()
        result = {"id": record.id, "token": token, "expires_at": record.expires_at}
        session.commit()
        return result

    @router.post("/pairings/inspect")
    def inspect(payload: PairToken, device: Current, session: Database):
        invite, owner = valid_invite(session, select(PairingInvite).where(
            PairingInvite.token_hash == hashlib.sha256(payload.token.encode()).hexdigest()))
        if owner.id == device.id:
            raise HTTPException(409, "Open this invitation on your other device.")
        if invite.claimant_id and invite.claimant_id != device.id:
            raise HTTPException(409, "This invitation was already used by another device.")
        return describe(invite, owner, session)

    @router.post("/pairings/claim")
    def claim(payload: PairToken, device: Current, session: Database):
        invite, owner = valid_invite(session, select(PairingInvite).where(
            PairingInvite.token_hash == hashlib.sha256(payload.token.encode()).hexdigest()))
        if owner.id == device.id:
            raise HTTPException(409, "A device cannot connect to itself.")
        if invite.claimant_id and invite.claimant_id != device.id:
            raise HTTPException(409, "This invitation was already used by another device.")
        invite.claimant_id = device.id
        result = describe(invite, owner, session)
        session.commit()
        return result

    @router.get("/pairings/{invite_id}")
    def pairing_status(invite_id: str, device: Current, session: Database):
        invite, owner = valid_invite(session, select(PairingInvite).where(
            PairingInvite.id == invite_id,
            or_(PairingInvite.owner_id == device.id, PairingInvite.claimant_id == device.id)))
        return describe(invite, owner, session)

    @router.post("/pairings/{invite_id}/confirm")
    def confirm(invite_id: str, payload: PairConfirmation, device: Current, session: Database):
        invite, owner = valid_invite(session, select(PairingInvite).where(
            PairingInvite.id == invite_id, PairingInvite.owner_id == device.id))
        if not invite.claimant_id or invite.claimant_id != payload.claimant_id:
            raise HTTPException(409, "The connecting device changed. Refresh the invitation.")
        claimant = session.get(Device, invite.claimant_id)
        if utc(claimant.expires_at) <= now():
            raise HTTPException(410, "The connecting device has expired.")
        first, second = sorted((device.id, claimant.id))
        if not paired(session, first, second):
            session.add(DevicePair(device_a=first, device_b=second))
        invite.confirmed_at = now()
        result = describe(invite, owner, session)
        session.commit()
        return result

    @router.delete("/pairings/{invite_id}")
    def cancel_invite(invite_id: str, device: Current, session: Database):
        session.execute(delete(PairingInvite).where(PairingInvite.id == invite_id, PairingInvite.owner_id == device.id))
        session.commit()
        return {"status": "canceled"}

    @router.delete("/devices/peers/{peer_id}")
    def disconnect(peer_id: str, device: Current, session: Database):
        first, second = sorted((device.id, peer_id))
        invitations = or_(
            and_(PairingInvite.owner_id == device.id, PairingInvite.claimant_id == peer_id),
            and_(PairingInvite.owner_id == peer_id, PairingInvite.claimant_id == device.id))
        # Wait for any in-flight confirmation before removing its connection.
        session.scalars(select(PairingInvite).where(invitations).with_for_update()).all()
        session.execute(delete(DevicePair).where(DevicePair.device_a == first, DevicePair.device_b == second))
        # Old confirmed invitations must not be usable to re-pair silently.
        session.execute(delete(PairingInvite).where(invitations))
        session.commit()
        return {"status": "disconnected"}

    def inbox_query(device):
        connection = or_(
            and_(DevicePair.device_a == DeviceDelivery.sender_id, DevicePair.device_b == device.id),
            and_(DevicePair.device_b == DeviceDelivery.sender_id, DevicePair.device_a == device.id))
        return (select(Transfer, Device.name).join(DeviceDelivery, DeviceDelivery.transfer_id == Transfer.id)
                .join(Device, Device.id == DeviceDelivery.sender_id).join(DevicePair, connection)
                .where(DeviceDelivery.recipient_id == device.id, Transfer.status == "ready", Transfer.expires_at > now()))

    @router.get("/inbox")
    def inbox(device: Current, session: Database):
        return [{"id": transfer.id, "filename": transfer.filename, "size_bytes": transfer.size_bytes,
                 "expires_at": utc(transfer.expires_at), "sender_name": sender}
                for transfer, sender in session.execute(inbox_query(device).order_by(Transfer.created_at.desc()).limit(100))]

    @router.post("/inbox/{transfer_id}/download")
    def download(transfer_id: str, device: Current, session: Database,
                 s3: Annotated[object, Depends(storage.get_s3)]):
        row = session.execute(inbox_query(device).where(Transfer.id == transfer_id)).first()
        if row is None:
            raise HTTPException(404, "This file expired or is no longer in your inbox.")
        transfer = row[0]
        try:
            url = storage.download_url(s3, transfer.s3_key, transfer.filename, utc(transfer.expires_at))
        except storage.DownloadExpired:
            raise HTTPException(410, "This file has expired.") from None
        except (storage.StorageNotConfigured, BotoCoreError, ClientError):
            raise HTTPException(503, "File storage is unavailable. Try again later.") from None
        session.execute(update(Transfer).where(Transfer.id == transfer_id).values(download_count=Transfer.download_count + 1))
        session.commit()
        return {"url": url}

    return router
