# File Transfer

A full-stack web application for sharing files between devices using temporary links and QR codes. Files upload directly to AWS S3, with FastAPI managing transfer validation and access.

[Live App](https://file-transfer-silk.vercel.app) | [![Tests](https://github.com/amenb106-blip/file-transfer/actions/workflows/tests.yml/badge.svg)](https://github.com/amenb106-blip/file-transfer/actions/workflows/tests.yml)

## Features

- Upload files up to **25 MiB** directly to AWS S3 with progress tracking.
- Share files through a link or QR code that expires **10 minutes after transfer creation**.
- Passcode-protected uploads; recipients can download using a valid share link.
- Server-side upload verification and short-lived download URLs.

## Tech Stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Backend | FastAPI, Python |
| Database | PostgreSQL, SQLAlchemy |
| File storage | AWS S3, boto3 |
| Testing | pytest, Moto (mocked S3) |
| CI | GitHub Actions |
| Hosting | Vercel |

## How It Works

1. Select a file and enter the upload passcode.
2. The browser uploads the file directly to S3 using a presigned form provided by the API.
3. The backend verifies the upload, then the app displays a share link and QR code.
4. The recipient opens the link and downloads the file after the API checks the share token and expiration.

## Local Setup

Requires Python 3.14, Node.js 24, PostgreSQL, and an AWS S3 bucket.

### Configuration

Copy [backend/.env.example](backend/.env.example) to `backend/.env` and set:

- `DATABASE_URL` and `UPLOAD_PASSCODE`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET`

The AWS credentials need `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` access to `transfers/*` in the bucket. Configure bucket CORS to allow `POST` from `http://localhost:5173` with all headers.

### Cleanup and retention

Set `CRON_SECRET` to a separate random secret (at least 32 characters) in Vercel's production environment. The daily job in `vercel.json` calls `/api/cron/cleanup` at 08:00 UTC with `Authorization: Bearer <CRON_SECRET>`. This daily schedule works on Vercel Hobby; scheduling can vary within the hour. See [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Each run removes up to 1,000 transfers whose links expired at least one hour ago, including abandoned uploads. Objects are deleted before database records. Failed object deletions retain their records for retry and return HTTP 503. Database failures are also retryable, including when S3 already deleted the objects. A successful response with `remaining: true` means a backlog remains; invoke the same protected endpoint again to drain it. Monitor failures and backlog as traffic grows.

Links expire after 10 minutes; physical deletion happens later. Cleanup includes a one-hour grace period for in-flight requests. Configure an S3 lifecycle rule scoped to `transfers/` to expire objects after one day as a backstop for late uploads or objects with no database record. For versioned or previously versioned buckets, also expire noncurrent versions and remove expired delete markers: deleting a key alone does not erase older versions. Merge these rules with any existing bucket policy rather than replacing unrelated rules. See [S3 lifecycle expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).

The cleanup endpoint also works locally when `CRON_SECRET` is set in `backend/.env`, but the Vercel schedule runs only after deployment. No bucket settings are changed automatically.

### Retrying an upload

If sharing fails after the file reaches S3, use **Retry sharing** in the same open page. The browser retains the transfer ID and a random completion token and retries without uploading again. Only the token hash is stored in the database; retries return the same link without changing its expiry. Selecting another file or reloading the page discards the in-memory attempt. An expired attempt starts a new transfer on retry. Existing API clients that complete without a token remain supported but cannot recover a lost completion response.

### Backend

From the repository root:

```powershell
cd backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe db.py
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

### Frontend

In a second terminal, from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The development server forwards API requests to FastAPI on port `8000`.

## Testing

Backend tests use an in-memory database and mocked S3 to cover validation, authorization, uploads, and link expiration.

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend checks, from a separate terminal at the repository root:

```powershell
cd frontend
npm run build
npm run lint
npm test
```

GitHub Actions runs these checks on every push and pull request.
