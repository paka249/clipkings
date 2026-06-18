import streamlit as st


def init_state() -> None:
    defaults = {
        "current_user_id": None,
        "current_user_email": "",
        "current_username": "",
        "current_profile_name": "",
        "current_project_id": None,
        "current_project_name": "",
        "template_label": "Template 1 — 9:16 Vertical Center-Crop (Primary only)",
        "primary_url": "",
        "bg_url": "",
        "primary_stream": None,
        "bg_stream": None,
        "clips": [],
        "log_lines": [],
        "output_path": None,
        "generating": False,
        "page": "dashboard",
        "output_preset": "9:16 Vertical 1080p",
        "quality_preset": "Standard",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
