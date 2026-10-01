import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db import Transfer, engine

app = FastAPI()
MAX_FILE_SIZE = 25 * 1024 * 1024
passcode_header = APIKeyHeader(name="X-Upload-Passcode", auto_error=False)


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


def require_passcode(passcode: Annotated[str | None, Depends(passcode_header)]):
    expected = os.getenv("UPLOAD_PASSCODE")
    if not expected:
        raise HTTPException(status_code=503, detail="Transfer creation is not configured.")
    if not passcode or not secrets.compare_digest(passcode.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Incorrect or missing upload passcode.")


def get_db():
    with Session(engine) as session:
        yield session


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post(
    "/api/transfers",
    status_code=201,
    response_model=TransferResponse,
    dependencies=[Depends(require_passcode)],
)
def create_transfer(payload: TransferRequest, session: Annotated[Session, Depends(get_db)]):
    now = datetime.now(timezone.utc)
    transfer = Transfer(
        filename=payload.filename,
        size_bytes=payload.size_bytes,
        created_at=now,
        expires_at=now + timedelta(hours=1),
    )
    try:
        session.add(transfer)
        session.flush()
        response = TransferResponse.model_validate(transfer)
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=503, detail="Could not save the transfer. Try again later."
        ) from None
    return response
