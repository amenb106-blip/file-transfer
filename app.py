"""Vercel entrypoint: loads the FastAPI app that lives in backend/ and serves the built frontend."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# backend/ modules import each other by plain name (`import storage`), so put that folder on the path.
sys.path.insert(0, str(ROOT / "backend"))

from main import app  # noqa: E402

# Vercel copies this build to its CDN. API routes always win; any other page address,
# such as a /d/<token> share link, gets index.html so React can show the right page.
# check_dir=False keeps the API running even if the frontend build is missing.
app.frontend("/", directory=ROOT / "frontend" / "dist", fallback="index.html", check_dir=False)
