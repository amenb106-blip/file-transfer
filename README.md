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

The AWS credentials need `s3:PutObject` and `s3:GetObject` access to `transfers/*` in the bucket. Configure bucket CORS to allow `POST` from `http://localhost:5173` with all headers.

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
```

GitHub Actions runs these checks on every push and pull request.
