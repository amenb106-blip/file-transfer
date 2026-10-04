import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from sqlalchemy import BigInteger, Column, DateTime, Integer, String, create_engine
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


if __name__ == "__main__":
    Base.metadata.create_all(engine)
    print("Transfer table ready!")
