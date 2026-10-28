# File Transfer

Send files to your paired phone or laptop, or share a temporary link or QR code. Files upload directly to AWS S3, while FastAPI handles permissions and sharing.

[Live demo](https://file-transfer-silk.vercel.app)

## Features

- Upload files up to **512 MiB** in chunks, with progress and cancellation.
- Automatically retry failed chunks without resending completed ones.
- Pair remembered devices with a QR code and send files to their private inboxes.
- Share through a link or QR code that expires **10 minutes after upload**.
- Require a passcode to upload; receive through a paired-device inbox or share link.
- Clean up expired files and abandoned uploads.

**In progress:** resuming an unfinished upload after refreshing the page.

## Built with

React · TypeScript · Vite · FastAPI · PostgreSQL · SQLAlchemy · AWS S3

Hosted on Vercel with Neon Postgres. Automated checks use pytest, Moto, and GitHub Actions.

## How it works

The browser uploads 8 MiB chunks directly to S3 using temporary upload URLs. The backend verifies and combines them, then creates the share link. Recipients get a short-lived download URL after the backend checks the link's token and expiry.

## Run locally

Requires **Python 3.14**, **Node.js 24**, PostgreSQL, and an S3 bucket.

Copy [backend/.env.example](backend/.env.example) to `backend/.env` and fill in your database URL, upload passcode, and AWS settings. Follow the [setup guide](docs/setup.md) for S3 permissions, CORS, and cleanup.

From the project root, start the backend:

```powershell
cd backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe db.py
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

In another terminal, start the frontend:

```powershell
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. See the [setup guide](docs/setup.md#checks) for check commands.
