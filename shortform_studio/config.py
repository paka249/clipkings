import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

APP_TITLE = "ClipKings"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EXPORTS_DIR = PROJECT_ROOT / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

BG_TEMPLATES_DIR = PROJECT_ROOT / "bg_templates"
BG_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

UPLOADS_DIR = PROJECT_ROOT / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

CANVAS_W = 1080
CANVAS_H = 1920

OUTPUT_PRESETS: dict[str, dict] = {
    "9:16 Vertical 1080p": {"canvas_w": 1080, "canvas_h": 1920, "label": "1080×1920"},
    "9:16 Vertical 720p":  {"canvas_w":  720, "canvas_h": 1280, "label":  "720×1280"},
    "1:1 Square 1080p":    {"canvas_w": 1080, "canvas_h": 1080, "label": "1080×1080"},
    "16:9 Landscape 1080p":{"canvas_w": 1920, "canvas_h": 1080, "label": "1920×1080"},
}

QUALITY_PRESETS: dict[str, dict] = {
    "High (larger file)":     {"crf": 18, "audio_br": "256k"},
    "Standard":               {"crf": 23, "audio_br": "192k"},
    "Compact (smaller file)": {"crf": 28, "audio_br": "128k"},
}

TEMPLATES = {
    "Template 1 — 9:16 Vertical Center-Crop (Primary only)": "center_crop",
    "Template 2 — Split-Screen Vertical Stack (Primary + Background)": "split_screen",
}

# Supabase — set these in .env to switch from local SQLite to cloud backend
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_ANON_KEY)
