import asyncio

VOICES = {
    "jenny":   "en-US-JennyNeural",
    "guy":     "en-US-GuyNeural",
    "aria":    "en-US-AriaNeural",
    "sara":    "en-US-SaraNeural",
    "ryan":    "en-US-RyanNeural",
    "natasha": "en-AU-NatashaNeural",
}


def synthesize(script: str, voice: str, output_path: str) -> None:
    """Generate TTS audio from script using edge-tts, save to output_path (.mp3)."""
    try:
        import edge_tts
    except ImportError:
        import subprocess, sys
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "edge-tts>=6.1"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        import edge_tts

    voice_id = VOICES.get(voice)
    if not voice_id:
        raise ValueError(
            f"Unknown voice '{voice}'. Valid options: {', '.join(VOICES)}"
        )

    async def _run() -> None:
        communicate = edge_tts.Communicate(script, voice_id)
        await communicate.save(output_path)

    asyncio.run(_run())
