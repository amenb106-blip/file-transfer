# Setup and maintenance

[Back to README](../README.md)

## Database and environment

Copy [backend/.env.example](../backend/.env.example) to `backend/.env` and configure:

- `DATABASE_URL`: PostgreSQL connection string.
- `UPLOAD_PASSCODE`: required to create and manage uploads.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET`.
- `CRON_SECRET`: a separate random secret of at least 32 characters for cleanup.

Run `.\.venv\Scripts\python.exe db.py` from `backend` after installing dependencies. It creates missing tables, including `multipart_uploads`, without altering existing transfer records. Check that `DATABASE_URL` points to the intended database first.

## S3 permissions and CORS

Keep the bucket private. The application's AWS credentials need these permissions on `transfers/*`:

- `s3:PutObject`
- `s3:GetObject`
- `s3:DeleteObject`
- `s3:AbortMultipartUpload`
- `s3:ListMultipartUploadParts`

Merge this CORS rule with existing rules, replacing the origins with those you use. Exposing `ETag` lets the browser confirm each uploaded part.

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://file-transfer-silk.vercel.app"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

## Expiration and cleanup

Multipart uploads have one hour to finish. Share links expire 10 minutes after completion; physical deletion happens later.

[vercel.json](../vercel.json) schedules `/api/cron/cleanup` daily at 08:00 UTC. Set `CRON_SECRET` in the deployment environment; the endpoint requires `Authorization: Bearer <CRON_SECRET>`.

Each run handles up to 1,000 transfers that expired at least one hour earlier. It aborts multipart uploads and deletes objects before database records. Failures retain records for retry and return HTTP 503. A response with `remaining: true` means more cleanup is needed; call the protected endpoint again to drain the backlog.

Configure lifecycle rules scoped to `transfers/` as a backstop:

- Expire completed objects after one day.
- Abort incomplete multipart uploads after one day with `AbortIncompleteMultipartUpload` and `DaysAfterInitiation: 1`.
- For versioned or previously versioned buckets, expire noncurrent versions and remove expired delete markers.

Object expiration alone does not remove unfinished multipart uploads. Merge these rules with existing lifecycle settings. The app does not configure the bucket automatically.

References: [AWS multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [S3 lifecycle expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html), [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Recovery and compatibility

Failed parts retry up to three times with increasing delays and fresh upload URLs. Manual retries in the same tab keep confirmed parts. Completion retries reuse the same token and do not extend the share link's expiry.

Upload metadata is saved in this tab's `sessionStorage`, but restoring uploads after refresh is not implemented yet. The file contents and upload passcode are not saved.

The legacy `/api/transfers` API keeps its 25 MiB limit and 10-minute lifetime from creation. The frontend uses `/api/multipart-transfers`; both flows use the same share/download endpoints.

## Checks

Backend, from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend, from `frontend`:

```powershell
npm run build
npm run lint
npm test
```

Backend tests use an in-memory database and mocked S3. GitHub Actions runs the checks on pushes and pull requests.
