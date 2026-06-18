import re


def parse_ts(ts: str) -> float:
    ts = ts.strip()
    if re.fullmatch(r"\d+(\.\d+)?", ts):
        return float(ts)

    parts = [float(part) for part in ts.split(":")]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    raise ValueError(f"Cannot parse timestamp: {ts!r}")


def validate_clips(clips: list) -> list[dict]:
    validated = []
    for index, clip in enumerate(clips):
        try:
            start = parse_ts(clip["start"])
            end = parse_ts(clip["end"])
        except ValueError as exc:
            raise ValueError(f"Clip {index + 1}: {exc}") from exc

        if end <= start:
            raise ValueError(f"Clip {index + 1}: end time must be after start time.")

        validated.append({
            "start": start,
            "end": end,
            "duration": round(end - start, 3),
            "mute": bool(clip.get("mute", False)),
        })
    return validated
