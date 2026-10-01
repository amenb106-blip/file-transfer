# File Transfer

A work-in-progress app for sending a file between devices through a temporary link.

## What works today

- React file picker with file details and a 25 MiB limit (labeled 25 MB in the UI).
- FastAPI health check and passcode-protected `POST /api/transfers`.
- PostgreSQL records with pending status and a one-hour expiration timestamp.
- Server validation for file names, file size, and authorization.
- Automated API tests using an isolated in-memory database; they do not use Neon.

**File upload, downloads, share links, QR codes, and deployment are not implemented yet.** Creating a record only saves metadata. Expiration is stored but no download endpoint or cleanup job exists yet. The download count field is reserved for a later step.

## Run locally (Windows PowerShell)

In a terminal at the project root:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

If you already have `.venv`, skip its creation. If you do not have `backend/.env`, copy `.env.example` to `.env`, then fill in `DATABASE_URL` with your Neon PostgreSQL connection URL and `UPLOAD_PASSCODE` with a long random value. Never put either value in frontend source code or commit `.env`.

To generate a passcode for your private `.env`:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(24))"
```

Create the database table, then start the API:

```powershell
.\.venv\Scripts\python.exe db.py
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

`db.py` creates a missing table; it does not migrate an existing table after schema changes.

In a second terminal at the project root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the local URL Vite prints. Choose a small nonempty file, enter the passcode from your private `backend/.env`, and choose **Create transfer record**. The passcode stays in component memory and is cleared after success; it is not saved in browser storage. Select another file to create another record.

## Checks

From `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

From `frontend`:

```powershell
npm run build
npm run lint
```

## Files that matter

| File | Purpose |
| --- | --- |
| `backend/main.py` | API routes, request validation, passcode check |
| `backend/db.py` | Database connection and transfer table |
| `backend/tests/test_api.py` | API and database-behavior tests |
| `backend/.env.example` | Blank list of settings for another developer |
| `frontend/src/App.tsx` | File picker and transfer form |
| `frontend/src/App.css`, `frontend/src/index.css` | Styling |
| `frontend/vite.config.ts` | Forwards local API requests to FastAPI |

## Next session

1. Review the flow: browser sends metadata and passcode, API validates, database stores a pending record.
2. Configure a private S3 bucket and direct uploads with enforced size limits.
3. Confirm uploaded objects before marking transfers ready.
4. Add expiring share links, download handling, QR codes, and cleanup.

This checkpoint is for local development. Before public deployment, add HTTPS, request/rate limits, storage quotas, and the remaining access/expiration checks. The current size check validates declared metadata only; S3 must later enforce the actual upload size. Never treat a pending record as a completed upload.
