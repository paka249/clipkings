import sys
from pathlib import Path

# Make relative imports work when Streamlit runs this file directly
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "shortform_studio"
    __import__("shortform_studio")

import shutil
import tempfile
from datetime import datetime

import streamlit as st
import yt_dlp

from .auth import get_or_create_local_user, get_profile, get_user
from .config import APP_TITLE, EXPORTS_DIR, OUTPUT_PRESETS, QUALITY_PRESETS, TEMPLATES
from .db import init_db
from .ffmpeg import build_cmd_center_crop, build_cmd_split_screen, run_ffmpeg
from .logging_utils import log_message, render_log
from .projects import (
    create_job,
    create_project,
    ensure_default_project,
    get_project,
    list_exports,
    list_projects,
    record_export,
    update_job,
    update_project,
)
from .state import init_state
from .styles import APP_CSS
from .timestamps import validate_clips
from .ui import (
    render_auth_screen,
    render_dashboard_home,
    render_export_dashboard,
    render_lakai_sidebar,
    render_media_ingestion,
    render_my_works,
    render_output_settings,
    render_profile_settings,
    render_render_engine,
    render_status_strip,
    render_template_gallery_page,
    render_template_selector,
    render_timeline,
)
from .yt import download_video, extract_stream_url


def _template_label_for_key(template_key: str) -> str:
    for label, key in TEMPLATES.items():
        if key == template_key:
            return label
    return next(iter(TEMPLATES.keys()))


def _template_key_for_label(template_label: str) -> str:
    return TEMPLATES.get(template_label, "center_crop")


def _clear_auth_session() -> None:
    for key in [
        "current_user_id",
        "current_user_email",
        "current_username",
        "current_profile_name",
        "current_project_id",
        "current_project_name",
    ]:
        st.session_state[key] = None if key.endswith("_id") else ""

    st.session_state["clips"] = []
    st.session_state["primary_url"] = ""
    st.session_state["bg_url"] = ""
    st.session_state["primary_stream"] = None
    st.session_state["bg_stream"] = None
    st.session_state["output_path"] = None


def _load_project_into_state(project: dict) -> None:
    st.session_state["current_project_id"] = project["id"]
    st.session_state["current_project_name"] = project["name"]
    st.session_state["primary_url"] = project.get("primary_url", "")
    st.session_state["bg_url"] = project.get("bg_url", "")
    st.session_state["template_label"] = _template_label_for_key(project.get("template_key", "center_crop"))
    st.session_state["clips"] = [{"start": clip["start"], "end": clip["end"]} for clip in project.get("clips", [])]
    st.session_state["primary_stream"] = None
    st.session_state["bg_stream"] = None


def _save_current_project(template_key: str) -> str:
    user_id = st.session_state["current_user_id"]
    project_id = st.session_state.get("current_project_id")
    project_name = st.session_state.get("current_project_name") or "Untitled Project"
    primary_url = st.session_state.get("primary_url", "")
    bg_url = st.session_state.get("bg_url", "")
    clips = st.session_state.get("clips", [])

    if project_id:
        update_project(project_id, user_id, project_name, primary_url, bg_url, template_key, clips)
    else:
        project_id = create_project(user_id, project_name, primary_url, bg_url, template_key, clips)

    st.session_state["current_project_id"] = project_id
    return project_id


def _render_project_controls() -> None:
    user_id = st.session_state.get("current_user_id")
    if not user_id:
        return

    projects = list_projects(user_id)
    if not projects:
        default_project_id = ensure_default_project(user_id)
        projects = list_projects(user_id)
        default_project = get_project(default_project_id, user_id)
        if default_project:
            _load_project_into_state(default_project)

    project_ids = [project["id"] for project in projects]
    current_project_id = st.session_state.get("current_project_id") or project_ids[0]
    if current_project_id not in project_ids:
        current_project_id = project_ids[0]
        st.session_state["current_project_id"] = current_project_id

    current_index = project_ids.index(current_project_id)
    st.markdown(
        """
<div class="project-panel">
  <div class="project-panel-title">Workspace</div>
</div>
""",
        unsafe_allow_html=True,
    )

    selected_project_id = st.selectbox(
        "Project",
        options=project_ids,
        index=current_index,
        format_func=lambda project_id: next(project["name"] for project in projects if project["id"] == project_id),
        key="project_selector",
    )

    project_name = next(project["name"] for project in projects if project["id"] == selected_project_id)
    st.caption(f"Active project: {project_name}")

    col_load, col_new, col_save = st.columns(3)
    with col_load:
        if st.button("Load", use_container_width=True):
            project = get_project(selected_project_id, user_id)
            if project:
                _load_project_into_state(project)
                st.rerun()
    with col_new:
        if st.button("New Project", use_container_width=True):
            new_id = create_project(user_id, f"Project {len(projects) + 1}")
            project = get_project(new_id, user_id)
            if project:
                _load_project_into_state(project)
                st.rerun()
    with col_save:
        if st.button("Save", use_container_width=True):
            _save_current_project(_template_key_for_label(st.session_state["template_label"]))
            st.success("Project saved.")


def generate_short(template_key: str, log_placeholder) -> None:
    st.session_state["log_lines"] = []
    st.session_state["output_path"] = None

    if not st.session_state.get("current_user_id"):
        log_message("[ERROR] Please log in first.", "err")
        return

    if not st.session_state["clips"]:
        log_message("[ERROR] No clips in timeline. Add at least one clip segment.", "err")
        return

    try:
        clips = validate_clips(st.session_state["clips"])
    except ValueError as exc:
        log_message(f"[ERROR] {exc}", "err")
        return

    total_duration = sum(clip["duration"] for clip in clips)
    log_message(f"[INFO] {len(clips)} clip(s) validated. Total duration: {total_duration:.1f}s", "inf")

    log_message("[INFO] Resolving primary video stream URL via yt-dlp...", "inf")
    primary_info = extract_stream_url(st.session_state["primary_url"])
    if not primary_info:
        log_message("[ERROR] Could not resolve primary stream URL. Check the link.", "err")
        with log_placeholder.container():
            render_log()
        return

    log_message(f"[OK] Primary: {primary_info['title'][:60]}", "ok")

    if template_key == "split_screen":
        if not st.session_state["bg_url"].strip():
            log_message("[ERROR] Template 2 requires a background video URL.", "err")
            with log_placeholder.container():
                render_log()
            return

        log_message("[INFO] Resolving background stream URL via yt-dlp...", "inf")
        bg_info = extract_stream_url(st.session_state["bg_url"])
        if not bg_info:
            log_message("[ERROR] Could not resolve background stream URL.", "err")
            with log_placeholder.container():
                render_log()
            return

        log_message(f"[OK] Background: {bg_info['title'][:60]}", "ok")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    tpl_label = "crop" if template_key == "center_crop" else "split"
    output_path = EXPORTS_DIR / f"short_{tpl_label}_{timestamp}.mp4"
    log_message(f"[INFO] Output: {output_path}", "inf")

    project_id = _save_current_project(template_key)
    job_id = create_job(st.session_state["current_user_id"], project_id)
    update_job(job_id, "running", progress=5)

    with tempfile.TemporaryDirectory() as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        primary_path = temp_dir / "primary.mp4"
        if not download_video(st.session_state["primary_url"], primary_path):
            log_message("[ERROR] Could not download primary video for rendering.", "err")
            update_job(job_id, "failed", error_message="Primary download failed")
            with log_placeholder.container():
                render_log()
            return

        bg_path = None
        if template_key == "split_screen":
            bg_path = temp_dir / "background.mp4"
            if not download_video(st.session_state["bg_url"], bg_path):
                log_message("[ERROR] Could not download background video for rendering.", "err")
                update_job(job_id, "failed", error_message="Background download failed")
                with log_placeholder.container():
                    render_log()
                return

        out_p = OUTPUT_PRESETS.get(st.session_state.get("output_preset", "9:16 Vertical 1080p"), OUTPUT_PRESETS["9:16 Vertical 1080p"])
        qual_p = QUALITY_PRESETS.get(st.session_state.get("quality_preset", "Standard"), QUALITY_PRESETS["Standard"])
        canvas_w, canvas_h = out_p["canvas_w"], out_p["canvas_h"]
        crf, audio_br = qual_p["crf"], qual_p["audio_br"]

        if template_key == "center_crop":
            cmd = build_cmd_center_crop(str(primary_path), clips, output_path, canvas_w, canvas_h, crf, audio_br)
        else:
            cmd = build_cmd_split_screen(str(primary_path), str(bg_path), clips, output_path, canvas_w, canvas_h, crf, audio_br)

        log_message("[INFO] Source videos downloaded. Starting render...", "inf")
        with log_placeholder.container():
            render_log()

        success = run_ffmpeg(cmd, log_placeholder)

        if success and Path(output_path).exists():
            st.session_state["output_path"] = output_path
            file_size_bytes = output_path.stat().st_size
            record_export(
                st.session_state["current_user_id"],
                project_id,
                output_path,
                file_size_bytes,
                total_duration,
                job_id=job_id,
            )
            update_job(job_id, "completed", progress=100)
            log_message(f"[OK] Export saved → {output_path}", "ok")
        else:
            update_job(job_id, "failed", error_message="FFmpeg render failed")
            log_message("[ERROR] Output file not found after render.", "err")

        with log_placeholder.container():
            render_log()


def _render_editor_page(user, profile) -> None:
    """The full video editor view (existing functionality)."""
    st.markdown(
        """
<div class="studio-header">
  <span class="badge">FFmpeg</span>
  <span class="badge">yt-dlp</span>
  <span class="badge">Multi-format</span>
  <h1>✂️ Video Editor</h1>
  <p>Clip, crop and render vertical shorts from any yt-dlp compatible URL.</p>
</div>
""",
        unsafe_allow_html=True,
    )

    ffmpeg_ok = shutil.which("ffmpeg") is not None
    if not ffmpeg_ok:
        st.error("⚠️ **FFmpeg not found on PATH.** Install FFmpeg and restart.")

    left_col, right_col = st.columns([1.1, 0.9], gap="large")

    with left_col:
        _render_project_controls()
        render_media_ingestion()
        st.markdown("---")
        render_timeline()

    with right_col:
        render_status_strip()
        template_key = render_template_selector()
        st.markdown("---")
        render_output_settings()
        st.markdown("---")

        ready = (
            ffmpeg_ok
            and bool(st.session_state["primary_url"])
            and bool(st.session_state["clips"])
            and (template_key == "center_crop" or bool(st.session_state["bg_url"]))
        )

        render_render_engine(template_key, ready, generate_short)
        st.markdown("---")
        render_export_dashboard(list_exports(user.id), user_id=user.id)

    st.markdown("---")
    render_my_works(user.id)


def _render_account_page(user, profile) -> None:
    """Account / profile settings page."""
    st.markdown(
        """
<div class="lk-greeting">
  <h1>👤 <em>Account</em></h1>
  <p class="lk-sub">Manage your profile and system settings.</p>
</div>
""",
        unsafe_allow_html=True,
    )

    col_l, col_r = st.columns([1, 1], gap="large")
    with col_l:
        st.markdown("#### Profile")
        render_profile_settings(profile)

    with col_r:
        st.markdown("#### System")
        ffmpeg_ver = "not found"
        if shutil.which("ffmpeg"):
            try:
                import subprocess as _sp
                r = _sp.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=4)
                ffmpeg_ver = r.stdout.split("\n")[0].split("version ")[1].split(" ")[0]
            except Exception:
                ffmpeg_ver = "installed"
        st.code(f"FFmpeg:   {ffmpeg_ver}\nyt-dlp:   {yt_dlp.version.__version__}\nExports:  {EXPORTS_DIR.resolve()}\nApp:      {APP_TITLE}")
        exports_count = len(list(EXPORTS_DIR.glob("*.mp4")))
        st.caption(f"{exports_count} export file(s) on disk")


def main() -> None:
    st.set_page_config(page_title=APP_TITLE, page_icon="🎬", layout="wide", initial_sidebar_state="expanded")
    st.markdown(APP_CSS, unsafe_allow_html=True)
    init_db()
    init_state()

    # Auto-start as local user — no login required
    if not st.session_state.get("current_user_id"):
        local_user = get_or_create_local_user()
        st.session_state["current_user_id"] = local_user.id
        st.session_state["current_user_email"] = local_user.email
        st.session_state["current_username"] = local_user.username
        st.session_state["current_profile_name"] = local_user.username

    user = get_user(st.session_state["current_user_id"])
    if user is None:
        _clear_auth_session()
        st.rerun()

    profile = get_profile(user.id)
    if profile:
        st.session_state["current_profile_name"] = profile.get("display_name") or user.username

    default_project_id = ensure_default_project(user.id)
    if not st.session_state.get("current_project_id"):
        project = get_project(default_project_id, user.id)
        if project:
            _load_project_into_state(project)

    # Sidebar nav — returns current page key
    page = render_lakai_sidebar(user, profile)

    # Page routing
    if page == "dashboard":
        render_dashboard_home(user, profile)
    elif page == "templates":
        render_template_gallery_page()
    elif page == "editor":
        _render_editor_page(user, profile)
    elif page == "account":
        _render_account_page(user, profile)
