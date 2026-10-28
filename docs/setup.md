# Setup and maintenance

[Back to README](../README.md)

## Database and environment

Copy [backend/.env.example](../backend/.env.example) to `backend/.env` and configure:

- `DATABASE_URL`: PostgreSQL connection string.
- `UPLOAD_PASSCODE`: required to create and manage uploads.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET`.
- `CRON_SECRET`: a separate random secret of at least 32 characters for cleanup.

Run `.\.venv\Scripts\python.exe db.py` from `backend` after installing dependencies. It creates missing tables, including `multipart_uploads`, `devices`, `device_pairs`, `pairing_invites`, and `device_deliveries`, without altering existing transfer records. Check that `DATABASE_URL` points to the intended database first.

“Remember this device” requires the upload passcode and stores a 90-day HttpOnly, SameSite=Lax cookie. Only its token hash is stored in the database. Cookies are Secure by default; set `DEVICE_COOKIE_SECURE=false` only for local HTTP development, and omit it or set it to `true` on HTTPS deployments. Clearing cookies or letting the device identity expire requires registering and pairing again. Uploads still require the passcode.

## Pair devices and receive files

1. Choose **Connect a device** and save each browser with a name such as “My laptop” or “My phone.”
2. On the laptop, choose **Connect a device** and choose **Create pairing QR**. Scan it with the phone, or copy the pairing link to the other device.
3. On the phone, choose **Request connection**. Approve the phone's name on the laptop. Invitations expire after 10 minutes and can be claimed by one device only.
4. Choose the paired device under **Send to**, select a file, and upload. Choose **Receive files** on the recipient to download it. The inbox refreshes every 8 seconds while the page is open; files expire 10 minutes after upload completes.

Pairing tokens stay in the link fragment and are submitted in request bodies; the database stores their hashes. Both devices must approve. Device-targeted files require the recipient's cookie and an active pairing; their generated share tokens cannot be used on public share endpoints. **Disconnect** removes the pairing and blocks further inbox downloads between those devices. Already-issued S3 download URLs can remain usable until their short expiry.

Use the same HTTPS site on both devices. A QR generated from `localhost` points to the scanning device's own localhost, not the laptop. For local phone development, use an accessible LAN URL, serve Vite on that interface, permit that origin in S3 CORS, and use the local HTTP cookie setting. No background delivery or automatic saving to the device's filesystem is implemented; the recipient opens the website and presses Download.

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
