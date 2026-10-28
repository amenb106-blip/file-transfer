import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase

load_dotenv(Path(__file__).with_name(".env"))

database_url = os.getenv("DATABASE_URL")

if not database_url:
    raise RuntimeError("Add DATABASE_URL to backend/.env")

database_url = database_url.replace(
    "postgresql://",
    "postgresql+psycopg://",
    1,
)

engine = create_engine(database_url, pool_pre_ping=True)


class Base(DeclarativeBase):
    pass


class Transfer(Base):
    __tablename__ = "transfers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    filename = Column(String(255), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    status = Column(String(20), nullable=False, default="pending")

    s3_key = Column(String(255), nullable=True)
    share_token_hash = Column(String(64), unique=True, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    expires_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    download_count = Column(Integer, nullable=False, default=0)


class MultipartUpload(Base):
    __tablename__ = "multipart_uploads"

    transfer_id = Column(String(36), ForeignKey("transfers.id"), primary_key=True)
    upload_id = Column(String(1024), nullable=False)


class Device(Base):
    __tablename__ = "devices"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name = Column(String(64), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)


class DevicePair(Base):
    __tablename__ = "device_pairs"
    device_a = Column(String(36), ForeignKey("devices.id"), primary_key=True)
    device_b = Column(String(36), ForeignKey("devices.id"), primary_key=True)


class PairingInvite(Base):
    __tablename__ = "pairing_invites"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id = Column(String(36), ForeignKey("devices.id"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    claimant_id = Column(String(36), ForeignKey("devices.id"), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)


class DeviceDelivery(Base):
    __tablename__ = "device_deliveries"
    transfer_id = Column(String(36), ForeignKey("transfers.id"), primary_key=True)
    sender_id = Column(String(36), ForeignKey("devices.id"), nullable=False)
    recipient_id = Column(String(36), ForeignKey("devices.id"), nullable=False, index=True)


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    print("Transfer table ready!")
