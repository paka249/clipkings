from pathlib import Path


def transcribe(video_path: str, model_size: str, log=None) -> list[dict]:
    """Transcribe audio from video using faster-whisper.

    Returns list of {start: float, end: float, text: str}.
    """
    _log = log or (lambda msg, lvl="inf": None)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        import subprocess, sys
        _log("[INFO] Installing faster-whisper (first-time setup)…", "inf")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "faster-whisper>=1.0"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        from faster_whisper import WhisperModel

    # Heuristic cache check — warn user on first download
    cache_dir = Path.home() / ".cache" / "huggingface" / "hub"
    model_marker = f"faster-whisper-{model_size}"
    cached = any(cache_dir.rglob(f"*{model_marker}*")) if cache_dir.exists() else False
    if not cached:
        _log(
            f"[INFO] Downloading Whisper '{model_size}' model for the first time "
            f"(~150 MB for base / ~500 MB for small / ~1.5 GB for medium). "
            "This only happens once — please wait…",
            "inf",
        )

    _log(f"[INFO] Loading Whisper '{model_size}' model…", "inf")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    _log("[INFO] Transcribing audio — this may take a minute…", "inf")
    segments_iter, _ = model.transcribe(video_path, beam_size=5)

    result = []
    for seg in segments_iter:
        text = seg.text.strip()
        if text:
            result.append({"start": seg.start, "end": seg.end, "text": text})

    _log(f"[OK] Transcription complete — {len(result)} subtitle segments.", "ok")
    return result
