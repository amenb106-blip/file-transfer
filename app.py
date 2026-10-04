"""Vercel entrypoint: loads the FastAPI app that lives in backend/."""

import sys
from pathlib import Path

# backend/ modules import each other by plain name (`import storage`), so put that folder on the path.
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from main import app  # noqa: E402
