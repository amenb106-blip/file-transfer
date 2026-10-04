# File Transfer

[![Tests](https://github.com/amenb106-blip/file-transfer/actions/workflows/tests.yml/badge.svg)](https://github.com/amenb106-blip/file-transfer/actions/workflows/tests.yml)

A web app for sending a file from one device to another with a temporary link or QR code.

**Status: in progress.** The upload → share link → download flow works in local development. Deployment to Vercel is configured but not live yet, so share links only work on the computer running the app.

## How it works

1. The browser sends the file's name and size, plus an upload passcode, to the FastAPI backend.
2. The backend saves a `pending` transfer in PostgreSQL and returns a presigned S3 upload form that only accepts a file of exactly that size.
3. The browser uploads the file directly to S3. The file does not pass through the backend.
4. The browser asks the backend to complete the transfer. The backend checks that the file exists in S3 with the expected size, marks the transfer `ready`, and returns a random share token.
5. The page shows the share link (`/d/<token>`) and a QR code. The link opens a download page. When the user clicks **Download**, the backend checks the token and expiry, counts the download, and returns an S3 download URL that is valid for 60 seconds and keeps the original filename.

Transfers expire 10 minutes after they are created. Only a SHA-256 hash of each share token is stored in the database.

## What works

Checked with automated tests and with manual runs against a real S3 bucket and Neon PostgreSQL database:

- Passcode-protected transfer creation with file name and size validation (25 MiB limit).
- Direct browser-to-S3 uploads with presigned POST forms; S3 rejects files that don't match the declared size.
- Upload confirmation that refuses missing, wrong-size, already completed, and expired uploads.
- Share links that show the file's name, size, and expiry, and refuse invalid or expired tokens.
- Downloads through short-lived S3 URLs, with a download counter. Downloading is a POST, so link previews in chat apps don't count as downloads.
- GitHub Actions runs the backend tests and the frontend build and lint on every push.

The frontend has:

- An upload page with a file picker, upload progress bar, and a result screen with the QR code, a **Copy link** button, and **Send another file**.
- A download page with clear messages for expired and invalid links.
- Light and dark mode. It follows the device setting by default and remembers the choice from the header button.

## Current limitations

- **Not deployed yet.** Until it is, other devices can't open share links, and QR codes point to `localhost`.
- **No database cleanup.** Expired transfers are refused, but their records stay in the database. Old files are removed only if an S3 lifecycle rule is set up on the bucket.
- **Single shared passcode.** No user accounts and no rate limiting.
- **No migrations.** `db.py` creates the table if it's missing but doesn't update an existing table.
- **Backend tests only.** The frontend has type checking and linting but no automated tests.

## Planned

- Go live on Vercel, then test laptop → phone over mobile data.
- A demo GIF in this README.
- Rate limiting, and a limited guest mode so visitors can try it without the passcode.

## Tech stack

| Area | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, `qrcode` |
| Backend | Python, FastAPI, Pydantic, SQLAlchemy |
| Storage | PostgreSQL (Neon), AWS S3 via boto3 |
| Tests and CI | pytest, moto (mocked S3), in-memory SQLite, GitHub Actions |
| Hosting | Vercel (configured, not live yet) |

## Run locally (Windows PowerShell)

### Requirements

- Python 3 and Node.js.
- A PostgreSQL database (for example, a free Neon database).
- An S3 bucket and an IAM user for the app. The app only needs `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::<your-bucket>/transfers/*`.
- A CORS rule on the bucket so the browser can upload to it. Add your deployed site's address to `AllowedOrigins` too once it's live:

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

`backend/requirements.txt` installs the app's packages from the root `requirements.txt`, plus the local server and test tools.

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

## Deploying to Vercel

The repository deploys as one Vercel project:

- `app.py` is the entrypoint Vercel looks for. It loads the FastAPI app from `backend/`, which becomes a single Vercel Function.
- `requirements.txt` lists only the packages the deployed app needs.
- `vercel.json` builds the frontend into `public/` (served from Vercel's CDN), sends `/d/<token>` links to the React page, and keeps the frontend and tests out of the function.

In the Vercel project settings, add the same environment variables as `backend/.env`: `DATABASE_URL`, `UPLOAD_PASSCODE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET`.

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
| `frontend/src/components/Header.tsx` | Logo and the light/dark mode button |
| `frontend/src/index.css`, `frontend/src/App.css` | Light and dark colours, and page styles |
| `frontend/vite.config.ts` | Forwards `/api` requests to the backend during development |
| `app.py`, `vercel.json`, `requirements.txt` | Vercel deployment |
| `.github/workflows/tests.yml` | Runs the checks on every push |
