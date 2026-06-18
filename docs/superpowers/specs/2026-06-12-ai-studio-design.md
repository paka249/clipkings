# AI Studio Template — Design Spec
**Date:** 2026-06-12
**Status:** Approved

---

## Overview

A new "AI Studio" template in Short-Form Studio that combines two AI-powered features in a single page: automatic subtitle generation (via local Whisper speech-to-text) and AI voiceover (via edge-tts neural TTS). Users provide a video by URL or file upload, enable one or both features, configure the options, and generate an export through the existing job pipeline.

---

## New Dependencies

Add to `requirements.txt`:
```
faster-whisper>=1.0
edge-tts>=6.1
```

- **faster-whisper** — runs locally, no API key, downloads the chosen model on first use (~150 MB for base, ~500 MB for small, ~1.5 GB for medium).
- **edge-tts** — free Microsoft neural TTS, requires internet access, no API key.

---

## New Storage

**`app_data/uploads/`** — user-uploaded video files.

- Each uploaded file is saved as `{uuid}{ext}` (e.g. `a1b2c3d4.mp4`).
- A JSON index at `app_data/uploads/index.json` stores metadata:
  ```json
  [{"id": "a1b2c3d4", "original_name": "myvideo.mp4", "ext": ".mp4", "size_mb": 42.1, "uploaded_at": "2026-06-12T10:00:00"}]
  ```
- Files persist until explicitly deleted by the user.
- Uploads are separate from exports and are not subject to the 30-day export retention policy.

---

## Backend

### New Pydantic Models (`server.py`)

```python
class AiStudioReq(BaseModel):
    # Source (exactly one of these must be set)
    source_url: str = ""
    upload_id: str = ""

    # Subtitles
    do_subtitles: bool = False
    sub_model: str = "base"        # "base" | "small" | "medium"
    sub_font: str = "DejaVu Sans Bold"
    sub_size: int = 48
    sub_color: str = "#FFFFFF"
    sub_style: str = "shadow"      # "shadow" | "box"
    sub_position: int = 85         # 0=top … 100=bottom (% of canvas height)

    # Voiceover
    do_voiceover: bool = False
    vo_script: str = ""
    vo_voice: str = "jenny"        # "jenny" | "guy" | "aria"
    vo_mix: str = "replace"        # "replace" | "duck" | "add"

    # Output
    codec: str = "h264"
    crf: int = 23
```

### New API Endpoints (`server.py`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Accept multipart video file. Save to `app_data/uploads/`, update index. Return `{id, original_name, size_mb}`. |
| `GET` | `/api/uploads` | Return the uploads index list. |
| `DELETE` | `/api/uploads/{id}` | Remove file and index entry. |
| `POST` | `/api/generate/ai-studio` | Validate request, create job entry, start `_run_ai_studio_job` thread, return `{job_id}`. |

Existing `GET /api/jobs/{job_id}` is reused for progress polling — no change needed.

### New Helper Modules

**`shortform_studio/whisper_utils.py`**

```python
def transcribe(video_path: str, model_size: str) -> list[dict]:
    """Returns [{start: float, end: float, text: str}, ...]"""
```

- Uses `faster_whisper.WhisperModel(model_size, device="cpu", compute_type="int8")`.
- Model is cached in `~/.cache/huggingface/` after first download.
- Logs "Downloading Whisper model…" before loading if the model isn't cached.

**`shortform_studio/tts_utils.py`**

```python
VOICES = {
    "jenny": "en-US-JennyNeural",
    "guy":   "en-US-GuyNeural",
    "aria":  "en-US-AriaNeural",
}

def synthesize(script: str, voice: str, output_path: str) -> None:
    """Generates TTS audio and saves to output_path (.mp3)."""
```

- Uses `asyncio.run(edge_tts.Communicate(script, voice_id).save(path))`.
- Raises `ValueError` if `voice` is not in `VOICES`.

**`shortform_studio/subtitle_utils.py`**

```python
def segments_to_ass(
    segments: list[dict],
    output_path: str,
    canvas_w: int,
    canvas_h: int,
    font: str,
    size: int,
    color_hex: str,
    style: str,    # "shadow" | "box"
    position: int, # 0–100
) -> None:
    """Writes an .ass subtitle file from Whisper segments."""
```

- Converts `#RRGGBB` to ASS `&H00BBGGRR&` format.
- `position` maps to ASS `MarginV`: `int((1 - position / 100) * canvas_h)`. This way position=85 (near bottom) gives a small bottom margin, position=10 (near top) gives a large bottom margin pushing the subtitle up.
- `style="shadow"` → `Shadow=2,Outline=0,BackColour=&H00000000&`.
- `style="box"` → `BorderStyle=3,BackColour=&H99000000&,Outline=0,Shadow=0`.
- Alignment is always bottom-center (ASS alignment 2); position is controlled by `MarginV`.

### Job Runner: `_run_ai_studio_job(job_id, req)`

Progress milestones:

| Step | Progress |
|------|----------|
| Acquire video (download URL or copy upload) | 5 → 20% |
| Whisper transcription (if enabled) | 20 → 50% |
| Generate .ass subtitle file | 50 → 55% |
| TTS synthesis (if enabled) | 55 → 70% |
| FFmpeg render | 70 → 95% |
| Probe output + complete | 95 → 100% |

If only voiceover is enabled (no subtitles), Whisper step is skipped (progress jumps 20 → 55%).
If only subtitles are enabled (no voiceover), TTS step is skipped.

### FFmpeg Command (`shortform_studio/ffmpeg.py`)

New function: `build_cmd_ai_studio(video_path, srt_path, vo_path, opts)`.

**Video filter chain:**
- If subtitles enabled: `[0:v]subtitles='{srt_path}':fontsdir=/usr/share/fonts[vout]`
- If no subtitles: `[0:v]copy[vout]` (passthrough)
- Canvas resizing is NOT applied in AI Studio — the video keeps its original dimensions. Subtitles and voiceover are added on top of whatever the user uploaded.

**Audio:**
- `replace` — use voiceover only: `-map 1:a`
- `duck` — sidechaincompress: `[0:a][1:a]sidechaincompress=threshold=0.02:ratio=8:attack=5:release=200[aout]`
- `add` — `[0:a][1:a]amix=inputs=2:duration=first[aout]`
- No voiceover — `-map 0:a` passthrough

**Output filename:** `short_aistudio_{YYYYMMDD_HHMMSS}.mp4`

---

## Frontend

### Template Card (`page-templates`)

Added under "Specialty Templates" section — gradient card with purple/blue tones, "AI Studio" label, badge "New". `onclick="openAiStudioTemplate()"`.

### Page: `page-aistudio`

Single scrollable page, same DOM/CSS pattern as `page-ranking`.

```
┌─────────────────────────────────────────┐
│  Source                                 │
│  [URL tab] [Upload tab]                 │
│  URL: [_________________________] [Preview] │
│  — OR —                                 │
│  [Drop file here / browse]              │
│  Uploads library: (scrollable list)     │
├─────────────────────────────────────────┤
│  ☑ Subtitles                           │
│  Model: [base▾]  Font: [DejaVu▾]       │
│  Size: [——●——] 48px  Color: [■]        │
│  Style: [Shadow only] [Background box] │
│  Position: [top ——●—— bottom]           │
├─────────────────────────────────────────┤
│  ☑ Voiceover                           │
│  [Script textarea                    ] │
│  Voice: [●Jenny] [○Guy] [○Aria]        │
│  Original audio: [Replace][Duck][Mix]  │
├─────────────────────────────────────────┤
│  Codec [H.264▾]                           │
│  [Generate ⚡]                          │
│  ████████████░░░░ 60% — running        │
│  [log box]                             │
│  [export result + player]              │
└─────────────────────────────────────────┘
```

**JS state object:**
```js
const AIS = {
  sourceType: 'url',   // 'url' | 'upload'
  uploadId: '',
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
};
```

**Key JS functions:**
- `openAiStudioTemplate()` — show `page-aistudio`, set nav active
- `aisSourceTab(type)` — switch between URL/Upload tabs
- `aisUploadFile(file)` — POST to `/api/upload`, refresh uploads library
- `aisLoadUploads()` — GET `/api/uploads`, render list
- `aisDeleteUpload(id)` — DELETE `/api/uploads/{id}`, refresh list
- `aisUseUpload(id)` — set `AIS.uploadId`, update UI
- `generateAiStudio()` — read form, POST `/api/generate/ai-studio`, start polling
- `_pollAiStudioJob(jobId)` — same pattern as `_pollRankingJob`

**Validation:** Generate button disabled unless:
- Source is set (URL with non-empty value, or an upload selected)
- At least one of `do_subtitles` or `do_voiceover` is checked
- If voiceover enabled, `vo_script` is non-empty

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Whisper model download fails (no internet) | Job fails with log: `[ERROR] Could not download Whisper model. Check internet connection.` |
| edge-tts unreachable | Job fails with log: `[ERROR] TTS synthesis failed. edge-tts requires an internet connection.` |
| Upload file too large (>500 MB) | `/api/upload` returns HTTP 413 with detail message |
| Upload file not a video | `/api/upload` checks MIME type / extension, returns HTTP 400 |
| Neither subtitles nor voiceover selected | `/api/generate/ai-studio` returns HTTP 400 |
| Source URL and upload_id both empty | `/api/generate/ai-studio` returns HTTP 400 |

---

## What This Does NOT Include (out of scope for v1)

- Canvas resize / fit mode (video keeps original dimensions)
- Word-level subtitle highlighting (karaoke style)
- Custom upload retention / expiry
- Non-English subtitle languages (Whisper supports them but the UI defaults to auto-detect; language selector is a future addition)
- Subtitle animation (fade in/out per word)
- Voice speed / pitch control

---

## Success Criteria

1. A user can paste a YouTube URL, enable subtitles (base model, default style), hit Generate, and receive an exported video with burned-in subtitles within a reasonable time.
2. A user can upload a local `.mp4`, enable voiceover with a typed script and Jenny voice (replace mode), hit Generate, and receive an exported video with the AI narration.
3. A user can enable both subtitles AND voiceover in a single job.
4. The uploads library persists across page reloads and server restarts.
5. Progress bar and log box update in real time throughout the job.
6. On first Whisper use, the log clearly tells the user the model is downloading.
