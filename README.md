# File Transfer

A full-stack file-sharing app for quickly moving files between devices with temporary share links and QR codes.

**[Live App](https://file-transfer-silk.vercel.app)** · [![Tests](https://github.com/amenb106-blip/file-transfer/actions/workflows/tests.yml/badge.svg)](https://github.com/amenb106-blip/file-transfer/actions/workflows/tests.yml)

## Features

- Upload files directly from the browser to **AWS S3** using presigned forms
- Share files with a temporary link or **QR code**
- Enforce a **25 MiB upload limit**
- Expire share links **10 minutes after transfer creation**
- Store only **SHA-256 hashes of share tokens** in PostgreSQL
- Track upload progress in the React interface
- Support light and dark mode
- Protect uploads with a private passcode
- Run backend tests automatically with **pytest** and **GitHub Actions**

Anyone with a valid share link can download the file until the transfer expires.

## Tech Stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Backend | FastAPI, Python |
| Database | PostgreSQL, SQLAlchemy |
| File storage | AWS S3, boto3 |
| Testing | pytest, mocked S3 |
| CI | GitHub Actions |
| Hosting | Vercel |

## How It Works

1. The user selects a file and enters the upload passcode.
2. FastAPI validates the request and creates a transfer record in PostgreSQL.
3. The frontend uploads the file directly to S3 using a presigned form.
4. After the upload is confirmed, the app generates a temporary share link and QR code.
5. The recipient opens the link, and the backend validates the token and expiration before issuing a short-lived S3 download URL.

```text
Browser  <------ API requests ------>  FastAPI
   |                                    |
   | file upload/download               | transfer metadata
   v                                    v
AWS S3                              PostgreSQL
```

## Run Locally

### Requirements

- Python 3.14
- Node.js 24
- PostgreSQL database
- AWS S3 bucket

### 1. Configure environment variables

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `UPLOAD_PASSCODE` | Private passcode required for uploads |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_REGION` | AWS region containing the bucket |
| `S3_BUCKET` | S3 bucket name |

Keep `.env` private. It is ignored by Git.

The app's AWS credentials need `s3:PutObject` and `s3:GetObject` access to:

```text
arn:aws:s3:::<your-bucket>/transfers/*
```

For local browser uploads, configure the S3 bucket CORS policy:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173"],
    "AllowedMethods": ["POST"],
    "AllowedHeaders": ["*"]
  }
]
```

### 2. Start the backend

From the repository root:

```powershell
cd backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe db.py
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

### 3. Start the frontend

In a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`.

The Vite development server forwards `/api` requests to FastAPI on port `8000`.

## Tests and Checks

Backend tests:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend checks:

```powershell
cd frontend
npm run build
npm run lint
```

GitHub Actions runs the automated checks on pushes and pull requests.

## Deployment

The project is deployed as a single Vercel application.

- `vercel.json` builds the React frontend.
- `app.py` loads the FastAPI backend and serves the built frontend.
- API routes are handled by FastAPI.
- Other routes fall back to `index.html` so React can handle shared-file URLs.

For deployment:

1. Add the six environment variables to Vercel.
2. Create the database table by running `backend/db.py` against the production database.
3. Add the deployed site's origin to the S3 bucket's `AllowedOrigins`.
