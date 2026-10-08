"""Bounded, retryable cleanup of expired transfers and abandoned uploads."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from db import Transfer
from storage import bucket_name

# Allow time for in-flight uploads/downloads to finish after link expiration.
# An S3 lifecycle rule is still needed for late uploads and noncurrent versions.
CLEANUP_GRACE = timedelta(hours=1)
CLEANUP_BATCH_SIZE = 1000


def cleanup_expired(session, s3):
    cutoff = datetime.now(timezone.utc) - CLEANUP_GRACE
    transfers = session.scalars(
        select(Transfer)
        .where(Transfer.expires_at <= cutoff)
        .order_by(Transfer.expires_at, Transfer.id)
        .limit(CLEANUP_BATCH_SIZE)
    ).all()
    failed_keys = set()
    keys = [transfer.s3_key for transfer in transfers if transfer.s3_key]
    if keys:
        result = s3.delete_objects(
            Bucket=bucket_name(),
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
        )
        failed_keys = {error["Key"] for error in result.get("Errors", [])}

    deleted_ids = [
        transfer.id for transfer in transfers if transfer.s3_key not in failed_keys
    ]
    # Delete objects first. On a database failure the next run safely deletes the
    # already-missing objects again; S3 failures keep their records for retries.
    if deleted_ids:
        session.execute(delete(Transfer).where(Transfer.id.in_(deleted_ids)))
        session.commit()
    remaining = session.scalar(
        select(Transfer.id).where(Transfer.expires_at <= cutoff).limit(1)
    ) is not None
    return {
        "deleted": len(deleted_ids),
        "failed": len(transfers) - len(deleted_ids),
        "remaining": remaining,
    }
