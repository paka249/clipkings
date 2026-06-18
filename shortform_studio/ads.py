"""Simple ad slot renderer and placeholder helpers."""

import streamlit as st


def render_ad_slot(placement: str = "bottom", label: str | None = None) -> None:
    text = label or "Ad space reserved for future sponsor or affiliate content"
    st.markdown(
        f"""
<div class="ad-slot">
  <div class="ad-label">Sponsored Slot · {placement}</div>
  <div class="ad-copy">{text}</div>
</div>
""",
        unsafe_allow_html=True,
    )
