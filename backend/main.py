import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import Depends, FastAPI, HTTPException, Path
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import storage
from db import Transfer, engine
from storage import StorageNotConfigured, get_s3

app = FastAPI()
MAX_FILE_SIZE = 25 * 1024 * 1024
TRANSFER_LIFETIME = timedelta(minutes=10)
passcode_header = APIKeyHeader(name="X-Upload-Passcode", auto_error=False)
ShareToken = Annotated[str, Path(min_length=1, max_length=128)]


class TransferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(strict=True, gt=0, le=MAX_FILE_SIZE)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, filename):
        if not filename.strip() or filename in {".", ".."}:
            raise ValueError("Choose a file with a valid name.")
        if any(
            character in "/\\" or ord(character) < 32 or ord(character) == 127
            for character in filename
        ):
            raise ValueError("File names cannot contain paths or control characters.")
        return filename


class TransferResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    size_bytes: int
    status: str
    created_at: datetime
    expires_at: datetime


class UploadPermission(BaseModel):
    url: str
    fields: dict[str, str]


class CreatedTransferResponse(TransferResponse):
    upload: UploadPermission


class CompletedTransferResponse(BaseModel):
    share_token: str
    expires_at: datetime


class SharedFileResponse(BaseModel):
    filename: str
    size_bytes: int
    expires_at: datetime


class DownloadResponse(BaseModel):
    url: str


def require_passcode(passcode: Annotated[str | None, Depends(passcode_header)]):
    expected = os.getenv("UPLOAD_PASSCODE")
    if not expected:
        raise HTTPException(status_code=503, detail="Transfer creation is not configured.")
    if not passcode or not secrets.compare_digest(passcode.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Incorrect or missing upload passcode.")


def get_db():
    with Session(engine) as session:
        yield session


def storage_unavailable():
    return HTTPException(status_code=503, detail="File storage is unavailable. Try again later.")


def database_unavailable():
    return HTTPException(status_code=503, detail="Could not save the transfer. Try again later.")


def as_utc(moment):
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def is_expired(transfer):
    return datetime.now(timezone.utc) >= as_utc(transfer.expires_at)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def find_shared_transfer(session, token):
    transfer = session.scalar(
        select(Transfer).where(
            Transfer.share_token_hash == hash_token(token), Transfer.status == "ready"
        )
    )
    if transfer is None:
        raise HTTPException(status_code=404, detail="This link is invalid.")
    if is_expired(transfer):
        raise HTTPException(status_code=410, detail="This link has expired.")
    return transfer


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post(
    "/api/transfers",
    status_code=201,
    response_model=CreatedTransferResponse,
    dependencies=[Depends(require_passcode)],
)
def create_transfer(
    payload: TransferRequest,
    session: Annotated[Session, Depends(get_db)],
    s3: Annotated[object, Depends(get_s3)],
):
    transfer_id = str(uuid4())
    key = storage.object_key(transfer_id)
    try:
        upload = storage.upload_permission(s3, key, payload.size_bytes)
    except (StorageNotConfigured, BotoCoreError, ClientError):
        raise storage_unavailable() from None

    now = datetime.now(timezone.utc)
    transfer = Transfer(
        id=transfer_id,
        filename=payload.filename,
        size_bytes=payload.size_bytes,
        s3_key=key,
        created_at=now,
        expires_at=now + TRANSFER_LIFETIME,
    )
    try:
        session.add(transfer)
        session.flush()
        response = CreatedTransferResponse(
            **TransferResponse.model_validate(transfer).model_dump(), upload=upload
        )
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise database_unavailable() from None
    return response


@app.post(
    "/api/transfers/{transfer_id}/complete",
    response_model=CompletedTransferResponse,
    dependencies=[Depends(require_passcode)],
)
def complete_transfer(
    transfer_id: str,
    session: Annotated[Session, Depends(get_db)],
    s3: Annotated[object, Depends(get_s3)],
):
    transfer = session.get(Transfer, transfer_id)
    if transfer is None:
        raise HTTPException(status_code=404, detail="Transfer not found.")
    if transfer.status != "pending":
        raise HTTPException(status_code=409, detail="This transfer is already complete.")
    if is_expired(transfer):
        raise HTTPException(status_code=410, detail="This transfer has expired.")

    try:
        size = storage.uploaded_size(s3, transfer.s3_key)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"403", "404", "NoSuchKey"}:
            raise HTTPException(
                status_code=409, detail="The file has not finished uploading."
            ) from None
        raise storage_unavailable() from None
    except (StorageNotConfigured, BotoCoreError):
        raise storage_unavailable() from None
    if size != transfer.size_bytes:
        raise HTTPException(
            status_code=409, detail="The uploaded file does not match the expected size."
        )

    share_token = secrets.token_urlsafe(32)
    try:
        result = session.execute(
            update(Transfer)
            .where(Transfer.id == transfer_id, Transfer.status == "pending")
            .values(status="ready", share_token_hash=hash_token(share_token))
        )
        if result.rowcount != 1:
            session.rollback()
            raise HTTPException(status_code=409, detail="This transfer is already complete.")
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise database_unavailable() from None
    return CompletedTransferResponse(
        share_token=share_token, expires_at=as_utc(transfer.expires_at)
    )


@app.get("/api/share/{token}", response_model=SharedFileResponse)
def shared_file(token: ShareToken, session: Annotated[Session, Depends(get_db)]):
    transfer = find_shared_transfer(session, token)
    return SharedFileResponse(
        filename=transfer.filename,
        size_bytes=transfer.size_bytes,
        expires_at=as_utc(transfer.expires_at),
    )


@app.post("/api/share/{token}/download", response_model=DownloadResponse)
def download_shared_file(
    token: ShareToken,
    session: Annotated[Session, Depends(get_db)],
    s3: Annotated[object, Depends(get_s3)],
):
    transfer = find_shared_transfer(session, token)
    try:
        url = storage.download_url(s3, transfer.s3_key, transfer.filename)
    except (StorageNotConfigured, BotoCoreError, ClientError):
        raise storage_unavailable() from None
    try:
        session.execute(
            update(Transfer)
            .where(Transfer.id == transfer.id)
            .values(download_count=Transfer.download_count + 1)
        )
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=503, detail="Could not start the download. Try again later."
        ) from None
    return DownloadResponse(url=url)
