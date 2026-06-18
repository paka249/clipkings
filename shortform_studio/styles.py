APP_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

:root {
    /* Surfaces — true zinc dark, zero purple tint */
    --bg:           #0a0a0a;
    --surface:      #141414;
    --surface-2:    #1e1e1e;
    --surface-3:    #2a2a2a;

    /* Borders */
    --border:       rgba(255,255,255,0.07);
    --border-2:     rgba(255,255,255,0.12);
    --border-3:     rgba(255,255,255,0.20);

    /* Primary accent — clean blue (Vercel/Linear style) */
    --accent:       #3b82f6;
    --accent-hi:    #60a5fa;
    --accent-lo:    #1e40af;
    --accent-glow:  rgba(59,130,246,0.16);

    /* Secondary accent — teal for metadata / labels */
    --cyan:         #2dd4bf;
    --cyan-lo:      #0d9488;
    --cyan-glow:    rgba(45,212,191,0.12);

    /* Semantic */
    --danger:       #f87171;
    --danger-bg:    rgba(248,113,113,0.10);
    --success:      #4ade80;
    --success-bg:   rgba(74,222,128,0.10);
    --warn:         #fbbf24;

    /* Text hierarchy */
    --text:         #fafafa;
    --text-2:       #a1a1aa;
    --muted:        #71717a;
    --muted-2:      #52525b;

    /* Fonts */
    --mono:         'JetBrains Mono', 'Fira Code', 'Space Mono', monospace;
    --sans:         'Inter', system-ui, -apple-system, sans-serif;

    /* Radius scale */
    --r-xs:         5px;
    --r-sm:         8px;
    --r:            11px;
    --r-lg:         14px;
    --r-xl:         18px;
    --r-2xl:        24px;

    /* Transition tokens */
    --t-fast:       120ms ease;
    --t-base:       200ms ease;
}

/* ── Base ──────────────────────────────────────────────────── */
body, .stApp {
    font-family: var(--sans) !important;
    background: var(--bg) !important;
    -webkit-font-smoothing: antialiased;
}

/* ═══════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════ */

[data-testid="stSidebarHeader"]         { display: none !important; }
[data-testid="stSidebarCollapseButton"] { display: none !important; }
button[data-testid="baseButton-header"] { display: none !important; }

[data-testid="stSidebar"] {
    background: #0d0d0d !important;
    border-right: 1px solid var(--border) !important;
}
[data-testid="stSidebar"] > div:first-child { padding: 0 !important; }
section[data-testid="stSidebarContent"]     { padding: 0 16px !important; gap: 0 !important; }

/* Logo */
.lk-logo {
    display: flex; align-items: center; gap: 11px;
    padding: 22px 0 18px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 6px;
}
.lk-logo-mark {
    width: 30px; height: 30px; border-radius: 7px;
    background: var(--accent);
    display: grid; place-items: center;
    color: #fff; font-family: var(--mono); font-weight: 700; font-size: .76rem;
    flex-shrink: 0;
    letter-spacing: -0.5px;
}
.lk-logo-name {
    color: var(--text); font-family: var(--sans); font-weight: 600;
    font-size: .9rem; letter-spacing: -0.2px;
}

/* Nav section label */
.lk-nav-section {
    color: var(--muted-2); font-family: var(--sans);
    font-size: .62rem; letter-spacing: 1.8px; text-transform: uppercase;
    font-weight: 600; padding: 16px 2px 6px;
}

/* Radio-as-nav */
[data-testid="stSidebar"] .stRadio > label { display: none !important; }
[data-testid="stSidebar"] .stRadio > div   { gap: 1px !important; flex-direction: column !important; }

[data-testid="stSidebar"] .stRadio label[data-baseweb="radio"] {
    padding: 8px 10px !important;
    border-radius: var(--r-sm) !important;
    color: var(--text-2) !important;
    font-family: var(--sans) !important;
    font-size: .84rem !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: background var(--t-fast), color var(--t-fast);
    width: 100%;
}
[data-testid="stSidebar"] .stRadio label[data-baseweb="radio"]:hover {
    background: rgba(255,255,255,0.05) !important;
    color: var(--text) !important;
}
[data-testid="stSidebar"] .stRadio label[aria-checked="true"] {
    background: rgba(59,130,246,0.12) !important;
    color: #93c5fd !important;
    font-weight: 600 !important;
}
[data-testid="stSidebar"] .stRadio label[data-baseweb="radio"] > div:first-child { display: none !important; }

/* User row */
.lk-user-row {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 2px;
    border-top: 1px solid var(--border);
    margin-top: 14px;
}
.lk-user-avatar {
    width: 30px; height: 30px; border-radius: 50%;
    background: var(--surface-2); border: 1px solid var(--border-2);
    display: grid; place-items: center;
    color: var(--text-2); font-weight: 700; font-size: .72rem; font-family: var(--mono);
    flex-shrink: 0;
}
.lk-user-name {
    color: var(--text); font-size: .82rem; font-weight: 600; line-height: 1.3;
    display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
}
.lk-user-plan {
    display: inline-block;
    background: rgba(255,255,255,0.06); border: 1px solid var(--border-2);
    border-radius: 999px; font-size: .58rem; font-family: var(--mono);
    color: var(--muted); padding: 1px 7px;
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════════ */

.lk-greeting { margin-bottom: 28px; }
.lk-greeting h1 {
    font-size: 1.9rem !important; font-weight: 700 !important;
    margin: 0 0 6px !important; color: var(--text) !important;
    font-family: var(--sans) !important; letter-spacing: -0.6px; line-height: 1.2;
}
.lk-greeting h1 em { font-style: normal; color: var(--accent-hi); }
.lk-greeting .lk-sub { color: var(--text-2); font-size: .87rem; margin: 0; line-height: 1.5; }

.lk-credits-chip {
    display: inline-flex; align-items: center; gap: 7px;
    background: var(--surface); border: 1px solid var(--border-2);
    border-radius: 999px; padding: 5px 14px;
    color: var(--text-2); font-size: .76rem; font-weight: 500;
}
.lk-credits-chip strong { color: var(--text); font-weight: 600; }

.lk-section-hdr {
    display: flex; align-items: center; justify-content: space-between;
    margin: 0 0 14px;
}
.lk-section-hdr h2 {
    font-size: .88rem !important; font-weight: 600 !important;
    margin: 0 !important; color: var(--text) !important;
    font-family: var(--sans) !important; letter-spacing: -0.1px;
}
.lk-section-hdr .lk-see-all {
    color: var(--accent-hi); font-size: .74rem; font-weight: 500;
    cursor: pointer; opacity: 0.6; transition: opacity var(--t-fast);
}
.lk-section-hdr .lk-see-all:hover { opacity: 1; }

/* Quick tool cards */
.lk-qt-row {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px; margin-bottom: 32px;
}
.lk-qt-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-lg); padding: 16px 14px;
    transition: border-color var(--t-base), box-shadow var(--t-base), transform var(--t-base);
    cursor: pointer;
}
.lk-qt-card:hover {
    border-color: var(--border-2);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    transform: translateY(-1px);
}
.lk-qt-icon {
    width: 36px; height: 36px; border-radius: 8px;
    display: grid; place-items: center; margin-bottom: 12px;
    color: var(--text-2);
}
.lk-qt-name  { color: var(--text); font-weight: 600; font-size: .85rem; margin-bottom: 4px; }
.lk-qt-desc  { color: var(--muted); font-size: .74rem; line-height: 1.5; }

/* Template cards — dashboard */
.lk-tmpl-row {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px; margin-bottom: 32px;
}
.lk-tmpl-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-lg); overflow: hidden;
    transition: border-color var(--t-base), box-shadow var(--t-base), transform var(--t-base);
    position: relative;
}
.lk-tmpl-card:hover:not(.lk-tmpl-soon) {
    border-color: var(--border-2);
    box-shadow: 0 8px 28px rgba(0,0,0,0.45);
    transform: translateY(-2px);
}
.lk-tmpl-soon { opacity: .3; pointer-events: none; }
.lk-tmpl-thumb {
    height: 140px; display: grid; place-items: center;
    position: relative; overflow: hidden;
}
.lk-tmpl-thumb::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(to bottom, transparent 25%, rgba(0,0,0,0.65) 100%);
}
.lk-tmpl-label {
    font-family: var(--mono); font-size: 1.4rem; font-weight: 700;
    color: rgba(255,255,255,0.35); letter-spacing: -1px;
    z-index: 1; position: relative; pointer-events: none; user-select: none;
}
.lk-tmpl-badge {
    position: absolute; top: 10px; right: 10px; z-index: 2;
    font-family: var(--mono); font-size: .52rem; font-weight: 700;
    letter-spacing: 1.5px; padding: 2px 8px; border-radius: 999px;
}
.lk-badge-ready  { background: var(--accent); color: #fff; }
.lk-badge-coming { background: var(--surface-3); border: 1px solid var(--border-2); color: var(--muted); }
.lk-tmpl-body   { padding: 12px 14px; }
.lk-tmpl-name   { color: var(--text); font-weight: 600; font-size: .85rem; margin-bottom: 4px; }
.lk-tmpl-desc   { color: var(--muted); font-size: .73rem; line-height: 1.5; }

/* Template page — full cards */
.lk-tmpl-full-row {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px; margin-bottom: 32px;
}
.lk-tmpl-full-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-xl); overflow: hidden;
    transition: border-color var(--t-base), box-shadow var(--t-base);
}
.lk-tmpl-full-card:hover {
    border-color: var(--border-2);
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}
.lk-tmpl-full-thumb {
    height: 200px; display: grid; place-items: center;
    position: relative; overflow: hidden;
}
.lk-tmpl-full-thumb::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.75) 100%);
}
.lk-tmpl-full-body   { padding: 20px 22px; }
.lk-tmpl-full-name   {
    color: var(--text); font-weight: 600; font-size: 1rem;
    margin-bottom: 8px; letter-spacing: -0.2px;
}
.lk-tmpl-full-desc   { color: var(--text-2); font-size: .83rem; line-height: 1.65; margin-bottom: 14px; }
.lk-tmpl-full-tags   { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.lk-tmpl-tag {
    background: rgba(255,255,255,0.05); border: 1px solid var(--border-2);
    color: var(--text-2); font-family: var(--mono); font-size: .6rem;
    padding: 2px 9px; border-radius: 999px;
}
.lk-tmpl-tag-cyan {
    background: rgba(45,212,191,0.07); border: 1px solid rgba(45,212,191,0.2);
    color: var(--cyan);
}

/* ═══════════════════════════════════════════════════════════
   EDITOR COMPONENTS
   ══════════════════════════════════════════════════════════ */

/* Hero Header */
.studio-header {
    position: relative; overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--r-xl);
    padding: 28px 32px; margin-bottom: 22px;
}
.studio-header::before {
    content: ''; position: absolute; top: 0; right: 0; bottom: 0; width: 40%;
    background: linear-gradient(to left, rgba(59,130,246,0.04), transparent);
    pointer-events: none;
}
.studio-header h1 {
    font-family: var(--sans) !important; font-size: 1.6rem !important;
    font-weight: 700 !important; letter-spacing: -0.5px;
    margin: 0 0 7px !important; color: var(--text) !important;
    position: relative; z-index: 1;
}
.studio-header p {
    color: var(--text-2) !important; font-size: .88rem !important;
    margin: 0 !important; position: relative; z-index: 1; line-height: 1.6;
}
.hero-subline {
    color: var(--muted) !important; font-size: .78rem !important;
    margin-top: 10px !important; position: relative; z-index: 1;
    line-height: 1.55;
    border-left: 2px solid var(--surface-3); padding-left: 10px;
}

/* Badges */
.badge {
    display: inline-block;
    background: rgba(255,255,255,0.05); border: 1px solid var(--border-2);
    color: var(--text-2); font-family: var(--mono); font-size: .6rem;
    padding: 2px 10px; border-radius: 999px;
    margin-right: 6px; margin-bottom: 10px; letter-spacing: .4px;
}

/* Card section labels */
.card-title {
    font-family: var(--sans) !important; font-size: .64rem !important;
    letter-spacing: 1.8px; text-transform: uppercase;
    color: var(--cyan) !important; margin-bottom: 14px !important;
    font-weight: 700 !important;
}

/* Project Panel */
.project-panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-lg); padding: 14px 16px; margin-bottom: 16px;
}
.project-panel-title {
    font-family: var(--sans); text-transform: uppercase;
    letter-spacing: 1.8px; font-size: .62rem; color: var(--muted);
    margin-bottom: 10px; font-weight: 700;
}

/* Status Strip */
.status-strip {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px; margin: 0 0 20px 0;
}
.status-chip {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r); padding: 12px 14px;
    transition: border-color var(--t-fast);
}
.status-chip:hover { border-color: var(--border-2); }
.status-chip .label {
    display: block; color: var(--muted); font-family: var(--sans);
    font-size: .58rem; text-transform: uppercase; letter-spacing: 1.5px;
    margin-bottom: 5px; font-weight: 700;
}
.status-chip .value {
    color: var(--text); font-weight: 600; font-size: .88rem; font-family: var(--mono);
}

/* Preview Blocks */
.preview-note { color: var(--muted); font-size: .77rem; margin-top: .3rem; line-height: 1.6; }
.preview-block {
    background: rgba(45,212,191,0.04); border: 1px solid rgba(45,212,191,0.1);
    border-left: 2px solid var(--cyan); border-radius: var(--r);
    padding: 12px 14px; margin-top: 12px;
}
.preview-title {
    font-family: var(--sans); font-size: .6rem; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--cyan); margin-bottom: 5px; font-weight: 700;
}
.preview-meta { color: var(--text-2); font-size: .81rem; margin-bottom: 5px; line-height: 1.5; }

/* Timeline row */
.timeline-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: var(--r-sm);
    background: var(--surface); border: 1px solid var(--border);
    margin-bottom: 4px; transition: border-color var(--t-fast);
}
.timeline-row:hover { border-color: var(--border-2); }
.timeline-row.muted { opacity: 0.6; }
.timeline-clip-num {
    color: var(--muted); font-size: .72rem; font-weight: 700; font-family: var(--mono);
    min-width: 24px;
}
.timeline-ts {
    font-family: var(--mono); font-size: .78rem; color: var(--text-2);
}

/* Export items */
.export-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 0; border-bottom: 1px solid var(--border);
}
.export-item:last-child { border-bottom: none; }
.export-item-name { color: var(--text-2); font-family: var(--mono); font-size: .75rem; }
.export-item-meta { color: var(--muted); font-size: .72rem; margin-top: 2px; }

/* Buttons */
.stButton > button {
    background: var(--accent) !important;
    color: #fff !important; border: none !important;
    border-radius: var(--r-sm) !important; font-family: var(--sans) !important;
    font-size: .82rem !important; letter-spacing: .1px; font-weight: 600 !important;
    transition: background var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) !important;
    cursor: pointer !important;
}
.stButton > button:hover {
    background: var(--accent-hi) !important;
    box-shadow: 0 2px 12px var(--accent-glow) !important;
}
.stButton > button:active { transform: translateY(1px) !important; }

/* Danger / secondary buttons */
.stButton.danger > button {
    background: transparent !important;
    color: var(--danger) !important;
    border: 1px solid rgba(248,113,113,0.25) !important;
    box-shadow: none !important;
}
.stButton.danger > button:hover {
    background: var(--danger-bg) !important;
    box-shadow: none !important;
}

/* Sidebar button override */
[data-testid="stSidebar"] .stButton > button {
    background: transparent !important;
    color: var(--text-2) !important;
    font-family: var(--sans) !important; font-size: .85rem !important;
    letter-spacing: 0 !important; font-weight: 500 !important;
    border-radius: var(--r-sm) !important;
    box-shadow: none !important; text-align: left !important;
    justify-content: flex-start !important;
}
[data-testid="stSidebar"] .stButton > button:hover {
    background: rgba(255,255,255,0.05) !important;
    color: var(--text) !important; box-shadow: none !important;
}

/* Log box */
.log-box {
    background: #080808; border: 1px solid var(--border); border-radius: var(--r-sm);
    padding: 14px; font-family: var(--mono); font-size: .72rem; color: var(--text-2);
    max-height: 300px; overflow-y: auto; white-space: pre-wrap;
    word-break: break-all; line-height: 1.65;
    scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent;
}
.log-ok  { color: var(--success); }
.log-err { color: var(--danger); }
.log-inf { color: #60a5fa; }

/* Ad slots */
.ad-slot {
    border: 1px dashed var(--border); border-radius: var(--r-lg);
    padding: 12px 16px; margin: 12px 0; background: transparent;
}
.ad-slot .ad-label {
    font-size: .57rem; letter-spacing: 1.8px; text-transform: uppercase;
    color: var(--muted); font-family: var(--sans); margin-bottom: 5px; font-weight: 700;
}
.ad-slot .ad-copy { color: var(--muted); font-size: .8rem; line-height: 1.5; }

/* Download button */
.stDownloadButton > button {
    background: var(--success-bg) !important;
    color: var(--success) !important;
    border: 1px solid rgba(74,222,128,0.25) !important;
    border-radius: var(--r-sm) !important; font-family: var(--sans) !important;
    font-size: .82rem !important; font-weight: 600 !important;
}
.stDownloadButton > button:hover {
    background: rgba(74,222,128,0.15) !important;
    box-shadow: 0 2px 10px rgba(74,222,128,0.15) !important;
}

/* Tabs */
.stTabs [data-baseweb="tab-list"] {
    background: var(--surface) !important; border-radius: var(--r) !important;
    padding: 3px !important; gap: 3px !important;
    border: 1px solid var(--border) !important;
}
.stTabs [data-baseweb="tab"] {
    background: transparent !important; border-radius: var(--r-sm) !important;
    color: var(--muted) !important; font-family: var(--sans) !important;
    font-size: .82rem !important; padding: 7px 22px !important; font-weight: 500 !important;
    transition: color var(--t-fast) !important;
}
.stTabs [data-baseweb="tab"]:hover { color: var(--text-2) !important; }
.stTabs [aria-selected="true"] {
    background: var(--surface-2) !important; color: var(--text) !important;
    font-weight: 600 !important;
    border: 1px solid var(--border-2) !important;
}

/* Auth Card */
.auth-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-xl); padding: 26px 30px; margin-bottom: 22px;
}

/* Top Nav */
.top-nav {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 18px; margin-bottom: 22px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-lg);
}
.brand { display: flex; align-items: center; gap: 11px; }
.brand-mark {
    width: 34px; height: 34px; border-radius: 8px;
    background: var(--accent); display: grid; place-items: center;
    color: #fff; font-family: var(--mono); font-weight: 700; font-size: .84rem;
    overflow: hidden;
}
.brand-title { color: var(--text); font-weight: 600; font-size: .92rem; letter-spacing: -0.2px; }
.brand-subtitle { color: var(--muted); font-size: .71rem; margin-top: 1px; }
.actions { display: flex; align-items: center; gap: 10px; color: var(--text-2); font-size: .81rem; }

/* Inputs */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea {
    background: var(--surface) !important;
    border: 1px solid var(--border-2) !important;
    border-radius: var(--r-sm) !important;
    color: var(--text) !important;
    font-family: var(--sans) !important;
    font-size: .88rem !important;
    transition: border-color var(--t-fast), box-shadow var(--t-fast) !important;
}
.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 2px rgba(59,130,246,0.15) !important;
    outline: none !important;
}
.stTextInput > div > div > input::placeholder,
.stTextArea > div > div > textarea::placeholder { color: var(--muted) !important; }

/* Selectbox */
.stSelectbox > div > div {
    background: var(--surface) !important;
    border: 1px solid var(--border-2) !important;
    border-radius: var(--r-sm) !important;
}

/* Metrics */
[data-testid="stMetric"] {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r); padding: 14px;
}
[data-testid="stMetricLabel"] { color: var(--text-2) !important; font-size: .8rem !important; }
[data-testid="stMetricValue"] { color: var(--text) !important; font-weight: 700 !important; }

/* Code blocks */
.stCodeBlock { border-radius: var(--r-sm) !important; }
pre {
    background: #080808 !important;
    border: 1px solid var(--border) !important;
    border-radius: var(--r-sm) !important;
    font-family: var(--mono) !important;
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted-2); }

/* Expanders */
.stExpander {
    border: 1px solid var(--border) !important;
    border-radius: var(--r) !important;
    background: var(--surface) !important;
}

/* Alerts */
[data-testid="stAlert"] {
    border-radius: var(--r-sm) !important;
    font-family: var(--sans) !important;
    font-size: .86rem !important;
}

/* Dividers */
hr { border-color: var(--border) !important; margin: 18px 0 !important; }

/* Toggle */
[data-testid="stToggle"] label { font-size: .8rem !important; color: var(--text-2) !important; }
</style>
"""
