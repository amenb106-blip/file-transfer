# File Transfer

A web app for sending a file from one device to another with a temporary link.

**Status: in progress.** The upload → share link → download flow works in local development. The app is not deployed yet, so share links only work on the computer running it.

## How it works

1. The browser sends the file's name and size, plus an upload passcode, to the FastAPI backend.
2. The backend saves a `pending` transfer in PostgreSQL and returns a presigned S3 upload form that only accepts a file of exactly that size.
3. The browser uploads the file directly to S3. The file does not pass through the backend.
4. The browser asks the backend to complete the transfer. The backend checks that the file exists in S3 with the expected size, marks the transfer `ready`, and returns a random share token.
5. The share link (`/d/<token>`) opens a download page. When the user clicks **Download**, the backend checks the token and expiry, counts the download, and returns an S3 download URL that is valid for 60 seconds and keeps the original filename.

Transfers expire ten minutes after they are created. Only a SHA-256 hash of each share token is stored in the database.

## What works

Checked with automated tests and with manual runs against a real S3 bucket and Neon PostgreSQL database:

- Passcode-protected transfer creation with file name and size validation (25 MiB limit).
- Direct browser-to-S3 uploads with presigned POST forms; S3 rejects files that don't match the declared size.
- Upload confirmation that refuses missing, wrong-size, already completed, and expired uploads.
- Share links that show the file's name, size, and expiry, and refuse invalid or expired tokens.
- Downloads through short-lived S3 URLs, with a download counter. Downloading is a POST, so link previews in chat apps don't count as downloads.

Also in the frontend, but not tested yet:

- Upload progress bar.
- A QR code of the share link. Until the app is deployed, it encodes a `localhost` address, so scanning it from a phone doesn't work.

## Current limitations

- **Local only.** Not deployed; other devices can't open share links yet.
- **No cleanup.** Expired transfers are refused, but their files stay in S3 and their records stay in the database.
- **Single shared passcode.** No user accounts and no rate limiting.
- **No migrations.** `db.py` creates the table if it's missing but doesn't update an existing table.
- **Backend tests only.** The frontend has type checking and linting but no automated tests. There is no CI yet.

## Planned

- S3 lifecycle rule to delete old files.
- GitHub Actions to run the tests on every push.
- Deployment (Vercel, with Neon for PostgreSQL), then testing from a phone.
- Copy-link button and rate limiting.

## Tech stack

| Area | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Backend | Python, FastAPI, Pydantic, SQLAlchemy, Uvicorn |
| Storage | PostgreSQL (Neon), AWS S3 via boto3 |
| Tests | pytest, moto (mocked S3), in-memory SQLite |

## Run locally (Windows PowerShell)

### Requirements

- Python 3 and Node.js.
- A PostgreSQL database (for example, a free Neon database).
- An S3 bucket and an IAM user for the app. The app only needs `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::<your-bucket>/transfers/*`.
- A CORS rule on the bucket so the browser can upload to it:

  ```json
  [
    {
      "AllowedOrigins": ["http://localhost:5173"],
      "AllowedMethods": ["POST"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3000
    }
  ]
  ```

### Backend

From `backend/`:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in every value: `DATABASE_URL`, `UPLOAD_PASSCODE`, and the AWS settings. Never commit `.env`. To generate a passcode:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(24))"
```

Create the table, then start the API:

```powershell
.\.venv\Scripts\python.exe db.py
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

### Frontend

In a second terminal, from `frontend/`:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173`, choose a file, enter the passcode from `backend/.env`, and choose **Send file**. Open the link it shows in another browser to download the file.

## Tests and checks

From `backend/`. The tests use mocked S3 and an in-memory database, so they need no AWS account or database:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

From `frontend/`:

```powershell
npm run build
npm run lint
```

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `POST /api/transfers` | Create a pending transfer and return an S3 upload form (passcode required) |
| `POST /api/transfers/{id}/complete` | Check the upload in S3 and return a share token (passcode required) |
| `GET /api/share/{token}` | File name, size, and expiry for the download page |
| `POST /api/share/{token}/download` | Short-lived S3 download URL |

## Project files

| File | Purpose |
| --- | --- |
| `backend/main.py` | API routes, validation, passcode check, expiry checks |
| `backend/storage.py` | S3 upload forms, upload checks, and download URLs |
| `backend/db.py` | Database connection and transfer table |
| `backend/tests/test_api.py` | API tests |
| `frontend/src/api.ts` | Calls to the backend and the S3 upload |
| `frontend/src/pages/UploadPage.tsx` | File picker, upload progress, share link, and QR code |
| `frontend/src/pages/DownloadPage.tsx` | Download page for share links |
| `frontend/vite.config.ts` | Forwards `/api` requests to the backend during development |
