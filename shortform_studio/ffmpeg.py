import subprocess
from pathlib import Path

from .config import CANVAS_H, CANVAS_W
from .logging_utils import log_message, render_log


def _build_audio_concat_parts(clips: list[dict]) -> tuple[list[str], list[str]]:
    """Return (extra mute filter strings, per-clip audio labels for concat).

    Non-muted clips pass [i:a] directly — no extra filters, preserving the
    original audio pipeline so we don't accidentally break stream compatibility.
    Muted clips get a volume=0 filter inserted before concat.
    """
    extra = []
    labels = []
    for i, clip in enumerate(clips):
        if clip.get("mute"):
            lbl = f"[am{i}]"
            extra.append(f"[{i}:a]volume=0{lbl}")
            labels.append(lbl)
        else:
            labels.append(f"[{i}:a]")
    return extra, labels


_CODEC_MAP = {
    "h264": ("libx264", "aac"),
    "h265": ("libx265", "aac"),
    "vp9":  ("libvpx-vp9", "libopus"),
}


def _video_codec_args(codec: str, crf: int) -> list[str]:
    vcodec, _ = _CODEC_MAP.get(codec, ("libx264", "aac"))
    args = ["-c:v", vcodec]
    if codec in ("h264", "h265"):
        args += ["-preset", "fast", "-crf", str(crf)]
    else:
        args += ["-crf", str(crf), "-b:v", "0"]
    if codec != "vp9":
        args += ["-movflags", "+faststart"]
    return args


def _codec_args(codec: str, crf: int, audio_br: str) -> list[str]:
    vcodec, acodec = _CODEC_MAP.get(codec, ("libx264", "aac"))
    args = ["-c:v", vcodec]
    if codec in ("h264", "h265"):
        args += ["-preset", "fast", "-crf", str(crf)]
    else:
        args += ["-crf", str(crf), "-b:v", "0"]
    args += ["-c:a", acodec, "-b:a", audio_br]
    if acodec == "aac":
        args += ["-ac", "2", "-ar", "44100"]
    if codec != "vp9":
        args += ["-movflags", "+faststart"]
    return args


def _add_fit_filters(filter_parts: list[str], src: str, w: int, h: int, out: str, fit: str):
    """Append video fit/crop filters to filter_parts. src is an existing labelled stream."""
    if fit == "blur":
        filter_parts.append(f"{src}split=2[_fg][_bg]")
        filter_parts.append(
            f"[_bg]scale={w}:{h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h},gblur=sigma=30[_bgb]"
        )
        filter_parts.append(
            f"[_fg]scale={w}:{h}:force_original_aspect_ratio=decrease[_fgf]"
        )
        filter_parts.append(f"[_bgb][_fgf]overlay=(W-w)/2:(H-h)/2{out}")
    else:
        filter_parts.append(
            f"{src}scale='if(gte(iw/ih,{w}/{h}),{h}*iw/ih,{w})'"
            f":'if(gte(iw/ih,{w}/{h}),{h},{w}*ih/iw)'[_vs]"
        )
        filter_parts.append(f"[_vs]crop={w}:{h}{out}")


def build_cmd_center_crop(
    primary_url: str,
    clips: list[dict],
    output_path: Path,
    canvas_w: int = CANVAS_W,
    canvas_h: int = CANVAS_H,
    crf: int = 23,
    audio_br: str = "192k",
    codec: str = "h264",
    mute: bool = False,
    fit: str = "crop",
) -> list[str]:
    n = len(clips)
    cmd = ["ffmpeg", "-y"]

    for clip in clips:
        cmd += ["-ss", str(clip["start"]), "-t", str(clip["duration"]), "-i", primary_url]

    if mute:
        concat_in = "".join(f"[{i}:v]" for i in range(n))
        filter_parts = [f"{concat_in}concat=n={n}:v=1:a=0[vc]"]
    else:
        extra_audio, audio_labels = _build_audio_concat_parts(clips)
        concat_in = "".join(f"[{i}:v]{audio_labels[i]}" for i in range(n))
        filter_parts = extra_audio + [f"{concat_in}concat=n={n}:v=1:a=1[vc][ac]"]

    _add_fit_filters(filter_parts, "[vc]", canvas_w, canvas_h, "[vout]", fit)

    cmd += ["-filter_complex", "; ".join(filter_parts), "-map", "[vout]"]
    if mute:
        cmd += ["-an", *_video_codec_args(codec, crf)]
    else:
        cmd += ["-map", "[ac]", *_codec_args(codec, crf, audio_br)]
    cmd.append(str(output_path))
    return cmd


def build_cmd_split_screen(
    primary_url: str,
    bg_url: str,
    clips: list[dict],
    output_path: Path,
    canvas_w: int = CANVAS_W,
    canvas_h: int = CANVAS_H,
    crf: int = 23,
    audio_br: str = "192k",
    codec: str = "h264",
    mute: bool = False,
    fit: str = "crop",
) -> list[str]:
    n = len(clips)
    total_dur = sum(clip["duration"] for clip in clips)
    half_h = canvas_h // 2
    cmd = ["ffmpeg", "-y"]

    for clip in clips:
        cmd += ["-ss", str(clip["start"]), "-t", str(clip["duration"]), "-i", primary_url]

    bg_idx = n
    cmd += ["-stream_loop", "-1", "-i", bg_url]

    if mute:
        concat_in = "".join(f"[{i}:v]" for i in range(n))
        filter_parts = [f"{concat_in}concat=n={n}:v=1:a=0[pvc]"]
    else:
        extra_audio, audio_labels = _build_audio_concat_parts(clips)
        concat_in = "".join(f"[{i}:v]{audio_labels[i]}" for i in range(n))
        filter_parts = extra_audio + [f"{concat_in}concat=n={n}:v=1:a=1[pvc][pac]"]

    _add_fit_filters(filter_parts, "[pvc]", canvas_w, half_h, "[top]", fit)
    filter_parts.append(f"[{bg_idx}:v]trim=duration={total_dur:.3f},setpts=PTS-STARTPTS[bgtrim]")
    filter_parts.append(
        f"[bgtrim]scale='if(gte(iw/ih,{canvas_w}/{half_h}),{half_h}*iw/ih,{canvas_w})'"
        f":'if(gte(iw/ih,{canvas_w}/{half_h}),{half_h},{canvas_w}*ih/iw)'[bgscaled]"
    )
    filter_parts.append(f"[bgscaled]crop={canvas_w}:{half_h}[bot]")
    filter_parts.append("[top][bot]vstack=inputs=2[vout]")

    cmd += ["-filter_complex", "; ".join(filter_parts), "-map", "[vout]"]
    if mute:
        cmd += ["-an", *_video_codec_args(codec, crf)]
    else:
        cmd += ["-map", "[pac]", *_codec_args(codec, crf, audio_br)]
    cmd += ["-t", str(total_dur), str(output_path)]
    return cmd


_BOLD_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]


def _find_bold_font() -> str | None:
    for p in _BOLD_FONTS:
        if Path(p).exists():
            return p
    return None


def _dt_esc(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
            .replace("%", "\\%")
    )


def build_cmd_ranking(
    items: list[dict],       # [{path, start_sec, end_sec, label, color, has_audio}]
    output_path: Path,
    title: str = "RANKING",
    title_color: str = "#FFFFFF",
    subtitle: str = "",
    subtitle_color: str = "#FFD700",
    canvas_w: int = 1080,
    canvas_h: int = 1920,
    crf: int = 23,
    codec: str = "h264",
    mute: bool = False,
    font_size: int = 0,
) -> list[str]:
    N = len(items)
    font_path = _find_bold_font()
    font_opt = f"fontfile='{font_path}'" if font_path else "fontname='DejaVu Sans Bold'"

    # Cumulative clip start times for progressive text reveal
    durations = [max(0.5, item["end_sec"] - item["start_sec"]) for item in items]
    cum_starts: list[float] = []
    total = 0.0
    for d in durations:
        cum_starts.append(total)
        total += d

    # Typography sizing
    title_fs = min(85, int(canvas_w * 0.078))
    title_block_h = title_fs + (int(title_fs * 0.9) + 10 if subtitle else 0) + 60
    available_h = canvas_h - title_block_h - 60
    item_h = min(110, int(available_h / max(N, 1)))
    item_fs = font_size if font_size > 0 else max(26, int(item_h * 0.58))
    items_y = title_block_h

    # Inputs — trim at decode level
    cmd = ["ffmpeg", "-y"]
    for item in items:
        cmd += ["-ss", f"{item['start_sec']:.3f}", "-to", f"{item['end_sec']:.3f}", "-i", item["path"]]

    fp: list[str] = []

    # Scale + fit each clip to canvas (per-clip fit mode)
    for i, item in enumerate(items):
        fit = item.get("fit", "crop")
        crop_x = max(0.0, min(1.0, float(item.get("crop_x", 0.5))))
        crop_y = max(0.0, min(1.0, float(item.get("crop_y", 0.5))))
        src = f"[{i}:v]"
        out = f"[sv{i}]"
        w, h = canvas_w, canvas_h
        if fit == "blur":
            fp.append(f"{src}split=2[_rk{i}fg][_rk{i}bg]")
            # Background: scale-to-fill, crop, blur
            fp.append(
                f"[_rk{i}bg]scale='if(gte(iw/ih,{w}/{h}),{h}*iw/ih,{w})'"
                f":'if(gte(iw/ih,{w}/{h}),{h},{w}*ih/iw)',"
                f"crop={w}:{h}:(iw-{w})*{crop_x}:(ih-{h})*{crop_y},"
                f"setsar=1,gblur=sigma=22[_rk{i}bgb]"
            )
            # Foreground: scale-to-fit, normalize SAR
            fp.append(
                f"[_rk{i}fg]scale='if(gte(iw/ih,{w}/{h}),{w},-2)'"
                f":'if(gte(iw/ih,{w}/{h}),-2,{h})',setsar=1[_rk{i}fgs]"
            )
            fp.append(f"[_rk{i}bgb][_rk{i}fgs]overlay=(W-w)/2:(H-h)/2,setsar=1{out}")
        elif fit == "letterbox":
            # Scale-to-fit, pad with black bars, normalize SAR
            fp.append(
                f"{src}scale='if(gte(iw/ih,{w}/{h}),{w},-2)'"
                f":'if(gte(iw/ih,{w}/{h}),-2,{h})',"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1{out}"
            )
        else:  # crop
            fp.append(
                f"{src}scale='if(gte(iw/ih,{w}/{h}),{h}*iw/ih,{w})'"
                f":'if(gte(iw/ih,{w}/{h}),{h},{w}*ih/iw)',"
                f"crop={w}:{h}:(iw-{w})*{crop_x}:(ih-{h})*{crop_y},setsar=1{out}"
            )

    # Video-only concat
    fp.append("".join(f"[sv{i}]" for i in range(N)) + f"concat=n={N}:v=1:a=0[base_v]")

    # Audio concat (anullsrc for clips without audio)
    if not mute:
        null_parts: list[str] = []
        audio_labels: list[str] = []
        for i, item in enumerate(items):
            dur = durations[i]
            if item.get("has_audio", True):
                audio_labels.append(f"[{i}:a]")
            else:
                lbl = f"[na{i}]"
                null_parts.append(
                    f"anullsrc=r=44100:cl=stereo,atrim=0:{dur:.3f},asetpts=PTS-STARTPTS{lbl}"
                )
                audio_labels.append(lbl)
        fp.extend(null_parts)
        fp.append("".join(audio_labels) + f"concat=n={N}:v=0:a=1[base_a]")

    # Drawtext overlay chain
    cur = "base_v"
    dt_idx = 0

    def _color(hex_c: str) -> str:
        h = hex_c.lstrip("#")
        if len(h) == 3:
            h = h[0] * 2 + h[1] * 2 + h[2] * 2
        return f"0x{h.upper()}"

    def dt(text: str, x: int, y: int, fs: int, color: str, enable: str | None = None):
        nonlocal cur, dt_idx
        en = f":enable='{enable}'" if enable else ""
        nxt = f"dv{dt_idx}"
        dt_idx += 1
        fp.append(
            f"[{cur}]drawtext={font_opt}:text='{_dt_esc(text)}'"
            f":x={x}:y={y}:fontsize={fs}:fontcolor={_color(color)}"
            f":shadowx=3:shadowy=3:shadowcolor=0x000000CC"
            f"{en}[{nxt}]"
        )
        cur = nxt

    # Title
    dt(title, x=40, y=50, fs=title_fs, color=title_color)
    if subtitle:
        dt(subtitle, x=40, y=50 + title_fs + 6, fs=int(title_fs * 0.88), color=subtitle_color)

    # Items: number-only until clip starts, then full "N. label" reveals
    for i, item in enumerate(items):
        y_pos = items_y + i * item_h
        T_k = cum_starts[i]
        color = item.get("color") or "#FFFFFF"
        label = item.get("label") or f"Item {i + 1}"

        if T_k > 0:
            # Show bare number before this clip's turn
            dt(f"{i + 1}.", x=40, y=y_pos, fs=item_fs, color=color, enable=f"lt(t,{T_k:.3f})")
        # Show full label from when this clip starts
        dt(f"{i + 1}. {label}", x=40, y=y_pos, fs=item_fs, color=color,
           enable=f"gte(t,{T_k:.3f})" if T_k > 0 else None)

    # Codec
    vcodec_map = {"h264": "libx264", "h265": "libx265", "vp9": "libvpx-vp9"}
    vcodec = vcodec_map.get(codec, "libx264")

    cmd += ["-filter_complex", "; ".join(fp), "-map", f"[{cur}]"]
    if mute:
        cmd += ["-an"]
    else:
        cmd += ["-map", "[base_a]", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "44100"]
    cmd += ["-c:v", vcodec]
    if codec in ("h264", "h265"):
        cmd += ["-preset", "fast", "-crf", str(crf)]
    else:
        cmd += ["-crf", str(crf), "-b:v", "0"]
    if codec != "vp9":
        cmd += ["-movflags", "+faststart"]
    cmd += ["-pix_fmt", "yuv420p", str(output_path)]
    return cmd


def build_cmd_ai_studio(
    video_path: str,
    ass_path: str | None,
    vo_path: str | None,
    output_path: Path,
    opts: dict,
) -> list[str]:
    """Build FFmpeg command for AI Studio: burn subtitles and/or mix voiceover.

    opts keys: codec, crf, vo_mix ("replace"|"duck"|"add")
    """
    codec  = opts.get("codec", "h264")
    crf    = int(opts.get("crf", 23))
    vo_mix = opts.get("vo_mix", "replace")

    cmd = ["ffmpeg", "-y", "-i", video_path]
    if vo_path:
        cmd += ["-i", vo_path]

    vcodec = {"h264": "libx264", "h265": "libx265", "vp9": "libvpx-vp9"}.get(codec, "libx264")
    _, acodec = _CODEC_MAP.get(codec, ("libx264", "aac"))

    if not ass_path and not vo_path:
        cmd += ["-c", "copy", str(output_path)]
        return cmd

    fp: list[str] = []

    # Video track
    if ass_path:
        safe = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        fp.append(f"[0:v]subtitles='{safe}'[vout]")
        v_map = "[vout]"
    else:
        v_map = "0:v"

    # Audio track
    if vo_path:
        if vo_mix == "duck":
            fp.append(
                "[0:a][1:a]sidechaincompress="
                "threshold=0.02:ratio=8:attack=5:release=200[aout]"
            )
            a_map = "[aout]"
        elif vo_mix == "add":
            fp.append("[0:a][1:a]amix=inputs=2:duration=first[aout]")
            a_map = "[aout]"
        else:  # replace — pad TTS with silence so it always fills the full video duration
            fp.append("[1:a]apad[aout]")
            a_map = "[aout]"
    else:
        # 0:a? = optional: won't error if the source video has no audio track
        a_map = "0:a?"

    cmd += ["-filter_complex", "; ".join(fp), "-map", v_map, "-map", a_map]
    cmd += ["-c:v", vcodec]
    if codec in ("h264", "h265"):
        cmd += ["-preset", "fast", "-crf", str(crf)]
    else:
        cmd += ["-crf", str(crf), "-b:v", "0"]
    cmd += ["-c:a", acodec, "-b:a", "192k", "-ac", "2", "-ar", "44100"]
    if codec != "vp9":
        cmd += ["-movflags", "+faststart"]
    cmd += ["-pix_fmt", "yuv420p", str(output_path)]
    return cmd


def run_ffmpeg(cmd: list[str], log_placeholder) -> bool:
    log_message(f"[CMD] {' '.join(cmd[:6])} ... (truncated)", "inf")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None

        for line in proc.stdout:
            line = line.rstrip()
            if line:
                level = "err" if "Error" in line or "error" in line else "inf"
                log_message(line, level)
                with log_placeholder.container():
                    render_log()

        proc.wait()
        if proc.returncode != 0:
            log_message(f"[ERROR] FFmpeg exited with code {proc.returncode}", "err")
            return False

        log_message("[OK] FFmpeg completed successfully.", "ok")
        return True
    except FileNotFoundError:
        log_message("[ERROR] FFmpeg not found. Please install FFmpeg and ensure it is on PATH.", "err")
        return False
    except Exception as exc:
        log_message(f"[ERROR] Unexpected error running FFmpeg: {exc}", "err")
        return False
