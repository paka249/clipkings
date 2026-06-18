from pathlib import Path
import base64
import shutil
import subprocess

import streamlit as st
import yt_dlp

from .ads import render_ad_slot
from .auth import authenticate_user, avatar_initial, create_user, get_profile, update_avatar_url, update_profile
from .config import APP_TITLE, EXPORTS_DIR, OUTPUT_PRESETS, QUALITY_PRESETS, TEMPLATES
from .logging_utils import render_log
from .projects import delete_export, list_exports, list_jobs, list_projects
from .timestamps import parse_ts
from .yt import extract_stream_url

# ── Inline SVG icon helpers ─────────────────────────────────
def _svg(body: str, size: int = 16) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{body}</svg>'
    )

_IC_SCISSORS  = _svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>')
_IC_LAYERS    = _svg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>')
_IC_DOWNLOAD  = _svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')
_IC_CPU       = _svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>')
_IC_TRASH     = _svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>')
_IC_ARROW     = _svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>')
_IC_VOLUME    = _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>')
_IC_VOLUME_X  = _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>')

# ── Navigation constants ────────────────────────────────────
_NAV_OPTIONS = [
    "Dashboard",
    "Templates",
    "Editor",
    "Account",
]
_NAV_KEYS = ["dashboard", "templates", "editor", "account"]
_KEY_TO_OPTION = dict(zip(_NAV_KEYS, _NAV_OPTIONS))
_OPTION_TO_KEY = dict(zip(_NAV_OPTIONS, _NAV_KEYS))


def navigate_to(page: str) -> None:
    """Navigate to a page and trigger rerun."""
    st.session_state["nav_radio"] = _KEY_TO_OPTION[page]
    st.session_state["page"] = page
    st.rerun()


def render_lakai_sidebar(user, profile) -> str:
    """Renders the Lakai-style sidebar nav and returns the current page key."""
    with st.sidebar:
        display_name = (profile or {}).get("display_name") or user.username
        avatar = avatar_initial(user)

        # Logo
        st.markdown(
            f"""
<div class="lk-logo">
  <div class="lk-logo-mark">SF</div>
  <div class="lk-logo-name">{APP_TITLE}</div>
</div>
""",
            unsafe_allow_html=True,
        )

        # Nav section label
        st.markdown('<div class="lk-nav-section">Navigation</div>', unsafe_allow_html=True)

        # Navigation radio (styled as nav list via CSS)
        current_page = st.session_state.get("page", "dashboard")
        default_option = _KEY_TO_OPTION.get(current_page, _NAV_OPTIONS[0])
        default_idx = _NAV_OPTIONS.index(default_option)

        selected = st.radio(
            "nav",
            _NAV_OPTIONS,
            index=default_idx,
            label_visibility="collapsed",
            key="nav_radio",
        )
        new_page = _OPTION_TO_KEY.get(selected, "dashboard")
        if new_page != st.session_state.get("page"):
            st.session_state["page"] = new_page
            st.rerun()

        # Support link (non-interactive visual)
        st.markdown('<div class="lk-nav-section" style="margin-top:8px;">Support</div>', unsafe_allow_html=True)
        st.caption("⁉  Docs & Help")

        # User profile row at bottom
        st.markdown(
            f"""
<div class="lk-user-row">
  <div class="lk-user-avatar">{avatar}</div>
  <div>
    <div class="lk-user-name">{display_name}<span class="lk-user-plan">Free</span></div>
    <div style="color:var(--muted);font-size:.72rem;">{user.email}</div>
  </div>
</div>
""",
            unsafe_allow_html=True,
        )

    return st.session_state.get("page", "dashboard")


def render_dashboard_home(user, profile) -> None:
    """Renders the Lakai-style dashboard home page."""
    display_name = (profile or {}).get("display_name") or user.username
    exports_count = len(list(EXPORTS_DIR.glob("*.mp4")))

    # Greeting row
    col_greet, col_credits = st.columns([3, 1])
    with col_greet:
        st.markdown(
            f"""
<div class="lk-greeting">
  <h1>Hey, <em>{display_name}</em></h1>
  <p class="lk-sub">New here? Pick a tool below to get started.</p>
</div>
""",
            unsafe_allow_html=True,
        )
    with col_credits:
        st.markdown(
            f"""
<div style="display:flex;justify-content:flex-end;padding-top:10px;">
  <div class="lk-credits-chip"><strong>{exports_count}</strong>&nbsp;exports</div>
</div>
""",
            unsafe_allow_html=True,
        )

    # ── Quick Tools ──────────────────────────────────────────
    st.markdown(
        f"""
<div class="lk-section-hdr">
  <h2>Quick Tools</h2>
  <span class="lk-see-all">see all</span>
</div>
<div class="lk-qt-row">
  <div class="lk-qt-card">
    <div class="lk-qt-icon" style="background:rgba(59,130,246,.12);color:#60a5fa;">{_IC_SCISSORS}</div>
    <div class="lk-qt-name">Video Editor</div>
    <div class="lk-qt-desc">Clip, crop and render shorts from any yt-dlp URL</div>
  </div>
  <div class="lk-qt-card">
    <div class="lk-qt-icon" style="background:rgba(45,212,191,.10);color:#2dd4bf;">{_IC_LAYERS}</div>
    <div class="lk-qt-name">Template Gallery</div>
    <div class="lk-qt-desc">Browse and apply composition layouts</div>
  </div>
  <div class="lk-qt-card">
    <div class="lk-qt-icon" style="background:rgba(74,222,128,.09);color:#4ade80;">{_IC_DOWNLOAD}</div>
    <div class="lk-qt-name">My Exports</div>
    <div class="lk-qt-desc">Download or share your generated shorts</div>
  </div>
  <div class="lk-qt-card">
    <div class="lk-qt-icon" style="background:rgba(251,191,36,.09);color:#fbbf24;">{_IC_CPU}</div>
    <div class="lk-qt-name">System Check</div>
    <div class="lk-qt-desc">Verify FFmpeg, yt-dlp and storage health</div>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )
    q1, q2, q3, q4 = st.columns(4)
    with q1:
        if st.button("Open Editor", use_container_width=True, key="dash_editor"):
            navigate_to("editor")
    with q2:
        if st.button("Browse Templates", use_container_width=True, key="dash_templates"):
            navigate_to("templates")
    with q3:
        if st.button("My Exports", use_container_width=True, key="dash_exports"):
            navigate_to("editor")
    with q4:
        if st.button("System Info", use_container_width=True, key="dash_system"):
            navigate_to("account")

    # ── Trending Templates ────────────────────────────────────
    st.markdown(
        """
<div class="lk-section-hdr" style="margin-top:8px;">
  <h2>Trending Templates</h2>
</div>
<div class="lk-tmpl-row">
  <div class="lk-tmpl-card">
    <div class="lk-tmpl-thumb" style="background:linear-gradient(135deg,#0f172a,#1e293b);">
      <div class="lk-tmpl-label">9:16</div>
      <span class="lk-tmpl-badge lk-badge-ready">READY</span>
    </div>
    <div class="lk-tmpl-body">
      <div class="lk-tmpl-name">Vertical Crop</div>
      <div class="lk-tmpl-desc">Center-crops your primary video to clean 1080×1920. Ideal for podcasts, commentary and interviews.</div>
    </div>
  </div>
  <div class="lk-tmpl-card">
    <div class="lk-tmpl-thumb" style="background:linear-gradient(135deg,#0c1a12,#0f172a);">
      <div class="lk-tmpl-label">SPLIT</div>
      <span class="lk-tmpl-badge lk-badge-ready">READY</span>
    </div>
    <div class="lk-tmpl-body">
      <div class="lk-tmpl-name">Split Screen</div>
      <div class="lk-tmpl-desc">Primary on top, Minecraft/Subway Surfers on bottom. The viral short-form formula.</div>
    </div>
  </div>
  <div class="lk-tmpl-card lk-tmpl-soon">
    <div class="lk-tmpl-thumb" style="background:linear-gradient(135deg,#1a1200,#0f172a);">
      <div class="lk-tmpl-label">CHAT</div>
      <span class="lk-tmpl-badge lk-badge-coming">SOON</span>
    </div>
    <div class="lk-tmpl-body">
      <div class="lk-tmpl-name">Fake Text Chat</div>
      <div class="lk-tmpl-desc">Turn a conversation into an animated text-thread video with TTS voiceover.</div>
    </div>
  </div>
  <div class="lk-tmpl-card lk-tmpl-soon">
    <div class="lk-tmpl-thumb" style="background:linear-gradient(135deg,#0a1520,#0f172a);">
      <div class="lk-tmpl-label">AI</div>
      <span class="lk-tmpl-badge lk-badge-coming">SOON</span>
    </div>
    <div class="lk-tmpl-body">
      <div class="lk-tmpl-name">Faceless Video</div>
      <div class="lk-tmpl-desc">B-roll footage with AI voiceover script and word-by-word captions.</div>
    </div>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )
    t1, t2, _, _ = st.columns(4)
    with t1:
        if st.button("Use Vertical Crop →", use_container_width=True, key="dash_use_t1"):
            st.session_state["template_label"] = "Template 1 — 9:16 Vertical Center-Crop (Primary only)"
            navigate_to("editor")
    with t2:
        if st.button("Use Split Screen →", use_container_width=True, key="dash_use_t2"):
            st.session_state["template_label"] = "Template 2 — Split-Screen Vertical Stack (Primary + Background)"
            navigate_to("editor")


def render_template_gallery_page() -> None:
    """Renders the full Templates page with detailed template cards."""
    st.markdown(
        """
<div class="lk-greeting">
  <h1><em>Templates</em></h1>
  <p class="lk-sub">Choose a composition layout to apply to your next short.</p>
</div>
""",
        unsafe_allow_html=True,
    )

    st.markdown(
        """
<div class="lk-tmpl-full-row">
  <div class="lk-tmpl-full-card">
    <div class="lk-tmpl-full-thumb" style="background:linear-gradient(135deg,#0f172a,#1e293b);">
      <div class="lk-tmpl-label" style="font-size:2rem;">9:16</div>
    </div>
    <div class="lk-tmpl-full-body">
      <div class="lk-tmpl-full-name">Template 1 — Vertical Center-Crop</div>
      <div class="lk-tmpl-full-desc">
        Center-crops your primary video to a clean 1080×1920 portrait canvas.
        Stitches multiple clips back-to-back with hard cuts.
        Audio comes from the primary track only.
        No background video required.
      </div>
      <div class="lk-tmpl-full-tags">
        <span class="lk-tmpl-tag">1080×1920</span>
        <span class="lk-tmpl-tag">9:16</span>
        <span class="lk-tmpl-tag">Single track</span>
        <span class="lk-tmpl-tag lk-tmpl-tag-cyan">Podcast clips</span>
        <span class="lk-tmpl-tag lk-tmpl-tag-cyan">Commentary</span>
        <span class="lk-tmpl-tag lk-tmpl-tag-cyan">Interviews</span>
      </div>
    </div>
  </div>
  <div class="lk-tmpl-full-card">
    <div class="lk-tmpl-full-thumb" style="background:linear-gradient(135deg,#0c1a12,#0f172a);">
      <div class="lk-tmpl-label" style="font-size:2rem;">SPLIT</div>
    </div>
    <div class="lk-tmpl-full-body">
      <div class="lk-tmpl-full-name">Template 2 — Split-Screen Vertical Stack</div>
      <div class="lk-tmpl-full-desc">
        Primary video fills the top half (1080×960), background loop fills the bottom.
        Background is looped and trimmed to match total clip duration.
        Audio comes from the primary track only.
        Requires a background video URL.
      </div>
      <div class="lk-tmpl-full-tags">
        <span class="lk-tmpl-tag">1080×1920</span>
        <span class="lk-tmpl-tag">9:16</span>
        <span class="lk-tmpl-tag">Dual track</span>
        <span class="lk-tmpl-tag lk-tmpl-tag-cyan">Minecraft</span>
        <span class="lk-tmpl-tag lk-tmpl-tag-cyan">Subway Surfers</span>
        <span class="lk-tmpl-tag lk-tmpl-tag-cyan">ASMR background</span>
      </div>
    </div>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )

    t1, t2 = st.columns(2)
    with t1:
        if st.button("Use Vertical Crop →", use_container_width=True, key="tmpl_use_t1"):
            st.session_state["template_label"] = "Template 1 — 9:16 Vertical Center-Crop (Primary only)"
            navigate_to("editor")
    with t2:
        if st.button("Use Split Screen →", use_container_width=True, key="tmpl_use_t2"):
            st.session_state["template_label"] = "Template 2 — Split-Screen Vertical Stack (Primary + Background)"
            navigate_to("editor")

    st.markdown("---")
    st.markdown(
        """
<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:16px 0;">
  More templates (Fake Text Chat, Faceless Video, Reaction Split) are coming soon.
</div>
""",
        unsafe_allow_html=True,
    )


def render_auth_screen() -> None:
    st.markdown(
        """
<div class="auth-card">
  <span class="badge">Private workspaces</span>
  <span class="badge">Saved projects</span>
  <span class="badge">Export history</span>
  <h2 style="margin:10px 0 6px 0;color:#fff;font-family:var(--mono);">Sign in to your workspace</h2>
  <p style="margin:0;color:#94a3b8;">Create an account or log in to keep projects private and synced to your profile.</p>
</div>
""",
        unsafe_allow_html=True,
    )

    login_tab, signup_tab = st.tabs(["Log in", "Sign up"])

    with login_tab:
        with st.form("login_form", clear_on_submit=False):
            identifier = st.text_input("Email or username", placeholder="you@example.com")
            password = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Log in", use_container_width=True)
        if submitted:
            user = authenticate_user(identifier, password)
            if user is None:
                st.error("Invalid credentials.")
            else:
                st.session_state["current_user_id"] = user.id
                st.session_state["current_user_email"] = user.email
                st.session_state["current_username"] = user.username
                st.session_state["current_profile_name"] = user.username
                st.success("Logged in.")
                st.rerun()

    with signup_tab:
        with st.form("signup_form", clear_on_submit=False):
            email = st.text_input("Email", placeholder="you@example.com", key="signup_email")
            username = st.text_input("Username", placeholder="yourname", key="signup_username")
            password = st.text_input("Password", type="password", key="signup_password")
            submitted = st.form_submit_button("Create account", use_container_width=True)
        if submitted:
            try:
                user = create_user(email, password, username=username)
                st.session_state["current_user_id"] = user.id
                st.session_state["current_user_email"] = user.email
                st.session_state["current_username"] = user.username
                st.session_state["current_profile_name"] = user.username
                st.success("Account created.")
                st.rerun()
            except Exception as exc:
                st.error(str(exc))


def render_public_top_nav() -> None:
        st.markdown(
                f"""
<div class="top-nav">
    <div class="brand">
        <div class="brand-mark">{APP_TITLE[:1]}</div>
        <div class="brand-text">
            <div class="brand-title">{APP_TITLE}</div>
            <div class="brand-subtitle">Login required to access private projects</div>
        </div>
    </div>
    <div class="actions">
        <span>Login</span>
        <span>•</span>
        <span>Sign up</span>
    </div>
</div>
""",
                unsafe_allow_html=True,
        )


def render_top_nav(user, profile) -> None:
    display_name = (profile or {}).get("display_name") or user.username
    avatar = avatar_initial(user)
    avatar_url = user.avatar_url
    avatar_markup = f'<div class="brand-mark">{avatar}</div>'
    if avatar_url:
        avatar_path = Path(avatar_url)
        if avatar_path.exists():
            encoded = base64.b64encode(avatar_path.read_bytes()).decode("ascii")
            avatar_markup = f'<div class="brand-mark"><img src="data:image/png;base64,{encoded}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" alt="avatar" /></div>'
    st.markdown(
        f"""
<div class="top-nav">
  <div class="brand">
        {avatar_markup}
    <div class="brand-text">
      <div class="brand-title">{APP_TITLE}</div>
      <div class="brand-subtitle">Signed in as {display_name}</div>
    </div>
  </div>
  <div class="actions">
    <span>⚙ Settings</span>
    <span>•</span>
    <span>{user.email}</span>
  </div>
</div>
""",
        unsafe_allow_html=True,
    )


def render_profile_settings(profile: dict | None) -> None:
    current_name = (profile or {}).get("display_name") or st.session_state.get("current_username", "")
    current_bio = (profile or {}).get("bio") or ""
    with st.form("profile_form"):
        display_name = st.text_input("Display name", value=current_name)
        bio = st.text_area("Bio", value=current_bio, height=100)
        avatar_file = st.file_uploader("Profile picture", type=["png", "jpg", "jpeg", "webp"])
        save_profile = st.form_submit_button("Save profile", use_container_width=True)
    if save_profile and st.session_state.get("current_user_id"):
        update_profile(st.session_state["current_user_id"], display_name, bio)
        if avatar_file is not None:
            avatar_dir = Path(__file__).resolve().parent.parent / "app_data" / "avatars"
            avatar_dir.mkdir(parents=True, exist_ok=True)
            avatar_path = avatar_dir / f"{st.session_state['current_user_id']}.png"
            avatar_path.write_bytes(avatar_file.getbuffer())
            update_avatar_url(st.session_state["current_user_id"], str(avatar_path))
        st.success("Profile saved.")
        st.rerun()


def render_my_works(user_id: str) -> None:
    projects = list_projects(user_id)
    exports = list_exports(user_id)
    jobs = list_jobs(user_id)

    st.markdown('<div class="project-panel"><div class="project-panel-title">My Works</div></div>', unsafe_allow_html=True)

    if projects:
        st.caption("Only your own projects are shown here.")
        for project in projects[:5]:
            st.markdown(
                f"""
<div class="preview-block">
  <div class="preview-title">{project['name']}</div>
  <div class="preview-meta">{project['template_key']} · {project['status']} · updated {project['updated_at'][:19].replace('T', ' ')}</div>
</div>
""",
                unsafe_allow_html=True,
            )
    else:
        st.caption("No saved projects yet.")

    if exports:
        with st.expander(f"Recent exports ({len(exports)})"):
            for export_row in exports[:10]:
                size_mb = export_row["file_size_bytes"] / 1_000_000
                st.caption(f"• {Path(export_row['output_path']).name} — {size_mb:.1f} MB")

    if jobs:
        with st.expander(f"Recent jobs ({len(jobs)})"):
            for job in jobs[:10]:
                st.caption(f"• {job['job_type']} — {job['status']} ({job['progress']}%)")


def render_header() -> None:
    st.markdown(
        """
<div class="studio-header">
  <span class="badge">v1.0</span>
  <span class="badge">FFmpeg</span>
  <span class="badge">yt-dlp</span>
  <span class="badge">1080×1920</span>
  <h1>🎬 Short-Form Studio</h1>
  <p>Automated multi-track vertical video composition engine &mdash;
     clone of Viblo / LAKAI-style workflows</p>
    <div class="hero-subline">The app now downloads source videos first so FFmpeg gets audio and video together, which avoids the no-audio stream issue you hit earlier.</div>
</div>
""",
        unsafe_allow_html=True,
    )


def render_status_strip() -> None:
    ffmpeg_ready = "Ready" if shutil.which("ffmpeg") else "Missing"
    clip_count = len(st.session_state["clips"])
    template_name = st.session_state.get("template_label", "Template not chosen")
    out_preset = st.session_state.get("output_preset", "9:16 Vertical 1080p")
    out_label = OUTPUT_PRESETS.get(out_preset, {}).get("label", "1080×1920")

    st.markdown(
        f"""
<div class="status-strip">
    <div class="status-chip"><span class="label">FFmpeg</span><span class="value">{ffmpeg_ready}</span></div>
    <div class="status-chip"><span class="label">Timeline</span><span class="value">{clip_count} clip(s)</span></div>
    <div class="status-chip"><span class="label">Template</span><span class="value">{template_name}</span></div>
    <div class="status-chip"><span class="label">Output</span><span class="value">{out_label}</span></div>
</div>
""",
        unsafe_allow_html=True,
    )


def render_media_ingestion() -> None:
    st.markdown('<p class="card-title">Media Ingestion</p>', unsafe_allow_html=True)
    st.caption("Preview buttons fetch a stream for checking only. The render step downloads the full MP4 so audio is preserved.")

    # ── Primary URL ──────────────────────────────────────────────
    p_col, p_btn = st.columns([4, 1])
    with p_col:
        primary_url = st.text_input(
            "🎙️ Primary Video URL",
            value=st.session_state["primary_url"],
            placeholder="https://www.youtube.com/watch?v=...",
            help="Podcast, commentary, interview, or any yt-dlp compatible URL",
            label_visibility="visible",
        )
        st.session_state["primary_url"] = primary_url.strip()
    with p_btn:
        st.markdown("<div style='margin-top:28px;'></div>", unsafe_allow_html=True)
        if st.button("Preview", key="prev_primary", use_container_width=True):
            if primary_url.strip():
                with st.spinner("Extracting..."):
                    info = extract_stream_url(primary_url.strip())
                if info:
                    st.session_state["primary_stream"] = info
                else:
                    st.error("Could not extract stream URL.")
            else:
                st.warning("Paste a primary URL first.")

    if st.session_state["primary_stream"]:
        info = st.session_state["primary_stream"]
        st.markdown(
            f'<div class="preview-block"><div class="preview-title">Primary Preview</div>'
            f'<div class="preview-meta">{info["title"][:80]} · {info["duration"]}s</div></div>',
            unsafe_allow_html=True,
        )
        if info.get("url"):
            try:
                st.video(info["url"])
            except Exception:
                st.info("Preview unavailable for this stream format.")

    st.markdown("---")

    # ── Background URL (Template 2 only) ────────────────────────
    b_col, b_btn = st.columns([4, 1])
    with b_col:
        bg_url = st.text_input(
            "🎮 Background Video URL (Template 2 only)",
            value=st.session_state["bg_url"],
            placeholder="https://www.youtube.com/watch?v=...",
            help="Minecraft parkour, ASMR, satisfying loops — anything works",
            label_visibility="visible",
        )
        st.session_state["bg_url"] = bg_url.strip()
    with b_btn:
        st.markdown("<div style='margin-top:28px;'></div>", unsafe_allow_html=True)
        if st.button("Preview", key="prev_bg", use_container_width=True):
            if bg_url.strip():
                with st.spinner("Extracting..."):
                    info = extract_stream_url(bg_url.strip())
                if info:
                    st.session_state["bg_stream"] = info
                else:
                    st.error("Could not extract background stream URL.")
            else:
                st.warning("Paste a background URL first.")

    if st.session_state["bg_stream"]:
        info = st.session_state["bg_stream"]
        st.markdown(
            f'<div class="preview-block"><div class="preview-title">Background Preview</div>'
            f'<div class="preview-meta">{info["title"][:80]} · {info["duration"]}s</div></div>',
            unsafe_allow_html=True,
        )
        if info.get("url"):
            try:
                st.video(info["url"])
            except Exception:
                st.info("Preview unavailable for this stream format.")


def render_timeline() -> None:
    st.markdown('<p class="card-title">Timeline</p>', unsafe_allow_html=True)
    st.caption("Add start/end timestamps for each segment of the primary video to splice together.")

    with st.container():
        fc1, fc2, fc3 = st.columns([2, 2, 1])
        with fc1:
            st.text_input("Start Time", placeholder="00:01:30", key="new_start", label_visibility="collapsed")
        with fc2:
            st.text_input("End Time", placeholder="00:03:45", key="new_end", label_visibility="collapsed")
        with fc3:
            if st.button("＋ Add", use_container_width=True):
                ns = st.session_state.get("new_start", "").strip()
                ne = st.session_state.get("new_end", "").strip()
                if ns and ne:
                    try:
                        start = parse_ts(ns)
                        end = parse_ts(ne)
                        if end <= start:
                            st.error("End must be after start.")
                        else:
                            st.session_state["clips"].append({"start": ns, "end": ne})
                    except ValueError as exc:
                        st.error(str(exc))
                else:
                    st.warning("Fill both start and end times.")

    if st.session_state["clips"]:
        st.markdown("**Queued Segments:**")
        to_delete = None
        for index, clip in enumerate(st.session_state["clips"]):
            is_muted = clip.get("mute", False)
            col1, col2, col3, col4, col5 = st.columns([0.4, 2, 2, 1.4, 0.8])
            with col1:
                st.markdown(f"<span style='color:var(--muted);font-size:.78rem;font-weight:700;font-family:var(--mono);'>#{index + 1}</span>", unsafe_allow_html=True)
            with col2:
                st.markdown(f"`▶ {clip['start']}`")
            with col3:
                st.markdown(f"`■ {clip['end']}`")
            with col4:
                new_mute = st.toggle(
                    "Mute audio",
                    value=is_muted,
                    key=f"clip_mute_{index}",
                    help="Silence this clip's audio in the final render",
                )
                if new_mute != is_muted:
                    st.session_state["clips"][index]["mute"] = new_mute
                    st.rerun()
            with col5:
                if st.button("×", key=f"del_{index}", use_container_width=True):
                    to_delete = index
        if to_delete is not None:
            st.session_state["clips"].pop(to_delete)
            st.rerun()

        total_s = sum(parse_ts(clip["end"]) - parse_ts(clip["start"]) for clip in st.session_state["clips"])
        st.info(f"📐 {len(st.session_state['clips'])} clip(s) queued — total ≈ **{total_s:.1f}s** ({total_s / 60:.1f}m)")

        if st.button("Clear Timeline", use_container_width=True):
            st.session_state["clips"] = []
            st.rerun()
    else:
        st.caption("_No clips queued. Add at least one segment above._")


def render_template_selector() -> str:
    st.markdown('<p class="card-title">Template</p>', unsafe_allow_html=True)

    tmpl_keys = list(TEMPLATES.keys())
    saved_label = st.session_state.get("template_label", tmpl_keys[0])
    try:
        default_idx = tmpl_keys.index(saved_label)
    except ValueError:
        default_idx = 0

    selected_template_label = st.selectbox(
        "Composition Layout",
        options=tmpl_keys,
        index=default_idx,
        help="Choose the visual composition for the 1080×1920 output",
    )
    st.session_state["template_label"] = selected_template_label
    template_key = TEMPLATES[selected_template_label]

    if template_key == "center_crop":
        st.markdown(
            """
**Template 1 — Vertical Center-Crop**
- Stitches primary clips back-to-back
- Center-crops horizontal frame into clean 1080×1920 canvas
- Audio from primary track
- *No background video required*
"""
        )
    else:
        st.markdown(
            """
**Template 2 — Split-Screen Vertical Stack**
- **TOP half (1080×960):** Primary clips scaled + cropped
- **BOT half (1080×960):** Background video looped + scaled + cropped
- Durations synchronized to total primary length
- Audio from primary track
- *Background URL required*
"""
        )

    return template_key


def render_output_settings() -> None:
    """Selectboxes for output dimensions and quality preset. Writes to session_state."""
    st.markdown('<p class="card-title">Output Settings</p>', unsafe_allow_html=True)
    col_dim, col_qual = st.columns(2)
    with col_dim:
        preset_names = list(OUTPUT_PRESETS.keys())
        cur_out = st.session_state.get("output_preset", preset_names[0])
        idx = preset_names.index(cur_out) if cur_out in preset_names else 0
        chosen_out = st.selectbox("Dimensions", preset_names, index=idx, key="output_preset_select")
        st.session_state["output_preset"] = chosen_out
        st.caption(OUTPUT_PRESETS[chosen_out]["label"])
    with col_qual:
        qual_names = list(QUALITY_PRESETS.keys())
        cur_qual = st.session_state.get("quality_preset", qual_names[1])
        qdx = qual_names.index(cur_qual) if cur_qual in qual_names else 1
        chosen_qual = st.selectbox("Quality", qual_names, index=qdx, key="quality_preset_select")
        st.session_state["quality_preset"] = chosen_qual
        q = QUALITY_PRESETS[chosen_qual]
        st.caption(f"CRF {q['crf']} · {q['audio_br']} audio")


def render_render_engine(template_key: str, ready: bool, generate_short) -> None:
    st.markdown('<p class="card-title">Render Engine</p>', unsafe_allow_html=True)

    if not ready:
        missing = []
        if not shutil.which("ffmpeg"):
            missing.append("FFmpeg on PATH")
        if not st.session_state["primary_url"]:
            missing.append("Primary URL")
        if not st.session_state["clips"]:
            missing.append("At least one clip")
        if template_key == "split_screen" and not st.session_state["bg_url"]:
            missing.append("Background URL (Template 2)")
        st.warning("**Missing:** " + " · ".join(missing))
    else:
        st.success("Ready to render. Source videos will be downloaded before FFmpeg starts.")

    gen_btn = st.button("Generate Short", disabled=not ready, use_container_width=True)
    log_ph = st.empty()

    if gen_btn and ready:
        generate_short(template_key, log_ph)
        with log_ph.container():
            render_log()
    elif st.session_state["log_lines"]:
        with log_ph.container():
            render_log()


_EXPORT_LIBRARY_LIMIT = 5


def render_export_dashboard(user_exports: list[dict] | None = None, user_id: str | None = None) -> None:
    st.markdown('<p class="card-title">Export Dashboard</p>', unsafe_allow_html=True)

    out = st.session_state.get("output_path")
    if out and Path(out).exists():
        st.success(f"Short generated: `{Path(out).name}`")

        file_size_mb = Path(out).stat().st_size / 1_000_000
        meta1, meta2 = st.columns(2)
        meta1.metric("File Size", f"{file_size_mb:.1f} MB")
        meta2.metric("Canvas", "1080 × 1920 (9:16)")

        st.markdown("**Preview:**")
        st.video(str(out))

        with open(out, "rb") as fh:
            st.download_button(
                label="Download MP4",
                data=fh,
                file_name=Path(out).name,
                mime="video/mp4",
                use_container_width=True,
            )

        st.markdown("<div class='preview-note'>This export is private to your account and saved in your export history.</div>", unsafe_allow_html=True)
    else:
        st.caption("_Output will appear here after generation completes._")

    # ── Export history with delete + library cap ──────────────
    if user_exports:
        total = len(user_exports)
        shown = user_exports[:_EXPORT_LIBRARY_LIMIT]
        overflow = total - _EXPORT_LIBRARY_LIMIT

        with st.expander(f"Export History ({total} file{'s' if total != 1 else ''})", expanded=True):
            for export_row in shown:
                size_mb = export_row["file_size_bytes"] / 1_000_000
                fname = Path(export_row["output_path"]).name
                col_info, col_del = st.columns([5, 1])
                with col_info:
                    st.markdown(
                        f"<div class='export-item-name'>{fname}</div>"
                        f"<div class='export-item-meta'>{size_mb:.1f} MB</div>",
                        unsafe_allow_html=True,
                    )
                with col_del:
                    if st.button("Delete", key=f"del_exp_{export_row['id']}", use_container_width=True):
                        file_path = delete_export(export_row["id"], user_id or "")
                        if file_path:
                            p = Path(file_path)
                            if p.exists():
                                p.unlink()
                        st.rerun()

            if overflow > 0:
                st.markdown("---")
                st.caption(f"{overflow} older export{'s' if overflow != 1 else ''} not shown.")
                if st.button(f"View all {total} exports in Library", use_container_width=True, key="view_export_library"):
                    navigate_to("account")

    render_ad_slot("after-export", "Sponsored space reserved after successful generation.")


def render_sidebar(profile: dict | None = None) -> None:
    with st.sidebar:
        if profile:
            st.markdown(
                f"""
<div class="project-panel">
  <div class="project-panel-title">Account</div>
  <div style="color:#fff;font-family:var(--mono);font-size:.9rem;">{profile.get('display_name') or st.session_state.get('current_username', '')}</div>
  <div style="color:#94a3b8;font-size:.8rem;">{st.session_state.get('current_user_email', '')}</div>
</div>
""",
                unsafe_allow_html=True,
            )
            render_profile_settings(profile)

        st.markdown("### 📋 Quick Reference")
        st.markdown(
            """
**Timestamp formats accepted:**
- `HH:MM:SS` → e.g. `01:23:45`
- `MM:SS` → e.g. `03:45`
- Raw seconds → e.g. `225.5`

---
**Supported sources (yt-dlp):**
YouTube · Twitch · TikTok · Twitter/X  
Instagram · Vimeo · Reddit · 1000+ more

---
**FFmpeg filter chain (T1):**
```
[inputs] concat → scale → crop → [vout]
```

**FFmpeg filter chain (T2):**
```
[primary] concat → scale → crop → [top]
[bg]      trim   → scale → crop → [bot]
[top][bot] vstack → [vout]
```

---
**Output spec:**
- Codec: H.264 (libx264)
- Audio: AAC 192k
- CRF: 23 (high quality)
- Preset: fast
- Container: MP4 (faststart)
"""
        )

        st.markdown("---")
        st.markdown("### ⚙️ System")
        ffmpeg_ver = "—"
        if shutil.which("ffmpeg"):
            try:
                result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=4)
                ffmpeg_ver = result.stdout.split("\n")[0].split("version ")[1].split(" ")[0]
            except Exception:
                ffmpeg_ver = "installed"

        st.caption(f"FFmpeg: `{ffmpeg_ver}`")
        st.caption(f"yt-dlp: `{yt_dlp.version.__version__}`")
        st.caption(f"Exports dir: `{EXPORTS_DIR.resolve()}`")
        st.caption(f"App: `{APP_TITLE}`")
        exports_count = len(list(EXPORTS_DIR.glob("*.mp4")))
        st.caption(f"Exports on disk: `{exports_count}` file(s)")

        render_ad_slot("bottom", "Affiliate or sponsor banner can live here later.")
