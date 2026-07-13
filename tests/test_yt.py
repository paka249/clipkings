from pathlib import Path

import pytest

from shortform_studio import yt


def test_download_video_falls_back_to_gallery_dl_when_yt_dlp_fails(monkeypatch, tmp_path):
    """yt-dlp has no Bunkr extractor, so download_video should retry via gallery-dl."""

    def raise_no_extractor(*args, **kwargs):
        raise Exception("Unsupported URL: no extractor found")

    monkeypatch.setattr(yt, "_yt_dlp_download", raise_no_extractor)

    gallery_dl_calls = []

    def fake_gallery_dl_download(url, out_path):
        gallery_dl_calls.append((url, out_path))
        out_path.with_suffix(".mp4").write_bytes(b"fake video bytes")
        return True

    monkeypatch.setattr(yt, "_gallery_dl_download", fake_gallery_dl_download)

    out_path = tmp_path / "clip.mp4"
    result = yt.download_video("https://bunkr.si/v/example", out_path)

    assert result is True
    assert gallery_dl_calls == [("https://bunkr.si/v/example", out_path)]
    assert out_path.exists()


def test_download_video_does_not_call_gallery_dl_when_yt_dlp_succeeds(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(yt, "_yt_dlp_download", lambda url, out_path: None)
    monkeypatch.setattr(
        yt, "_gallery_dl_download", lambda url, out_path: calls.append(url) or True
    )

    out_path = tmp_path / "clip.mp4"
    result = yt.download_video("https://youtube.com/watch?v=abc", out_path)

    assert result is True
    assert calls == []


def test_download_video_returns_false_when_both_backends_fail(monkeypatch, tmp_path):
    def raise_yt_dlp(*args, **kwargs):
        raise Exception("boom")

    monkeypatch.setattr(yt, "_yt_dlp_download", raise_yt_dlp)
    monkeypatch.setattr(yt, "_gallery_dl_download", lambda url, out_path: False)

    out_path = tmp_path / "clip.mp4"
    result = yt.download_video("https://bunkr.si/v/example", out_path)

    assert result is False
