import os
from functools import lru_cache
from urllib.parse import quote

import boto3
from botocore.config import Config

UPLOAD_URL_SECONDS = 10 * 60
DOWNLOAD_URL_SECONDS = 60


class StorageNotConfigured(Exception):
    pass


def bucket_name():
    bucket = os.getenv("S3_BUCKET")
    if not bucket:
        raise StorageNotConfigured
    return bucket


@lru_cache
def get_s3():
    return boto3.client(
        "s3",
        region_name=os.getenv("AWS_REGION"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def object_key(transfer_id):
    # The filename is kept in the database, not the key, so odd names can't break S3 paths.
    return f"transfers/{transfer_id}"


def upload_permission(s3, key, size_bytes):
    # S3 rejects the upload unless the file is exactly the size the browser declared.
    return s3.generate_presigned_post(
        Bucket=bucket_name(),
        Key=key,
        Conditions=[["content-length-range", size_bytes, size_bytes]],
        ExpiresIn=UPLOAD_URL_SECONDS,
    )


def uploaded_size(s3, key):
    return s3.head_object(Bucket=bucket_name(), Key=key)["ContentLength"]


def download_url(s3, key, filename):
    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket_name(),
            "Key": key,
            "ResponseContentDisposition": content_disposition(filename),
        },
        ExpiresIn=DOWNLOAD_URL_SECONDS,
    )


def content_disposition(filename):
    fallback = "".join(
        character if character.isascii() and character not in '"\\' else "_"
        for character in filename
    )
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
