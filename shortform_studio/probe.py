import re
import shutil
import subprocess


def _ffprobe():
    return shutil.which("ffprobe")


def _ffmpeg():
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH")
    return exe


def _ffmpeg_stderr(path):
    result = subprocess.run(
        [_ffmpeg(), "-hide_banner", "-i", str(path)],
        capture_output=True, text=True,
    )
    return result.stderr


def video_dimensions(path):
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", str(path)],
            capture_output=True, text=True,
        )
        w, h = 1080, 1920
        for line in result.stdout.splitlines():
            if line.startswith("width="):
                w = int(line.split("=")[1])
            elif line.startswith("height="):
                h = int(line.split("=")[1])
        return w, h
    stderr = _ffmpeg_stderr(path)
    m = re.search(r"Stream[^,]*Video[^,]*, [^,]*, (\d{2,5})x(\d{2,5})", stderr)
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)


def has_audio(path):
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-show_streams", "-select_streams", "a",
             "-show_entries", "stream=codec_name", str(path)],
            capture_output=True, text=True,
        )
        return "codec_name" in result.stdout
    return bool(re.search(r"Stream[^:]*: Audio:", _ffmpeg_stderr(path)))


def audio_info(path):
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-show_streams", "-select_streams", "a",
             "-show_entries", "stream=codec_name,sample_rate,channels", str(path)],
            capture_output=True, text=True,
        )
        if "codec_name" not in result.stdout:
            return None
        info = {}
        for line in result.stdout.splitlines():
            if "=" in line and not line.startswith("["):
                k, v = line.split("=", 1)
                info[k] = v
        return info or None
    m = re.search(
        r"Stream[^:]*: Audio:\s+(\w+)[^,]*, (\d+) Hz, (\w+)",
        _ffmpeg_stderr(path),
    )
    if not m:
        return None
    return {
        "codec_name": m.group(1),
        "sample_rate": m.group(2),
        "channels": "2" if "stereo" in m.group(3) else "1",
    }


def file_duration(path):
    if _ffprobe():
        result = subprocess.run(
            [_ffprobe(), "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True,
        )
        try:
            return float(result.stdout.strip())
        except ValueError:
            return None
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", _ffmpeg_stderr(path))
    return (
        int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        if m else None
    )