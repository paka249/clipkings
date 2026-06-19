'use strict';

// ── Auth ──────────────────────────────────────────────────────
function authToken() { return localStorage.getItem('sf-auth-token') || ''; }

async function checkAuth() {
  const token = authToken();
  if (!token) return; // Guest mode — no redirect, app works without login
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) {
      // Token expired — clear it silently
      localStorage.removeItem('sf-auth-token');
      localStorage.removeItem('sf-auth-user');
      return;
    }
    const user = await res.json();
    localStorage.setItem('sf-profile-name',  user.username);
    localStorage.setItem('sf-profile-email', user.email);
  } catch { /* offline — continue with cached profile */ }
}

async function logout() {
  const token = authToken();
  if (token) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).catch(() => {});
  }
  localStorage.removeItem('sf-auth-token');
  localStorage.removeItem('sf-auth-user');
  window.location.replace('/auth');
}

// ── App state ────────────────────────────────────────────────
const S = {
  clips: [],          // [{start, end, startSec, endSec}]
  template: 'center_crop',
  bgTemplate: '',     // name of pre-baked gaming bg, e.g. 'subway_surfers'
  mute: false,
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
  primaryDuration: 0,
  edSourceMode: 'url',   // 'url' | 'upload'
  edUploadId: null,
  edUploadName: null,
  bgSourceMode: 'url',   // 'url' | 'upload'
  bgUploadId: null,
  bgUploadName: null,
};

// ── Helpers ───────────────────────────────────────────────────
function fmtTS(secs) {
  secs = Math.floor(Math.max(0, secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// ── Navigation ───────────────────────────────────────────────
const _VALID_PAGES = new Set(['dashboard','templates','splitscreen','editor','clipstudio','exports','account','upgrade','ranking','aistudio','docs']);

const _TOOL_PAGES = new Set(['editor','clipstudio','templates','splitscreen','ranking','aistudio','exports']);
const _TOOL_NAMES = { editor:'Video Editor', clipstudio:'Clip Studio', templates:'Templates', ranking:'Ranking', aistudio:'AI Studio', exports:'Exports' };
const _TOOL_ICONS = { editor:'#i-film', clipstudio:'#i-edit', templates:'#i-tmpl', ranking:'#i-ranking', aistudio:'#i-aistudio', exports:'#i-folder' };

function showPage(name, _fromHistory = false) {
  if (!_VALID_PAGES.has(name)) name = 'templates';

  // Stop editor preview playback when leaving
  const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (currentPage === 'editor' && name !== 'editor') {
    const prevVideo = document.getElementById('ved-preview-video');
    const prevAudio = document.getElementById('ved-preview-audio');
    if (prevVideo) { prevVideo.pause(); }
    if (prevAudio) { prevAudio.pause(); }
    VED.seqPlaying = false;
    _vedSetPlayIcon(false);
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + name);
  if (!pageEl) return;
  pageEl.classList.add('active');
  document.querySelector('.main')?.classList.toggle('is-editor', name === 'editor');
  const navEl = document.querySelector('[data-page="' + name + '"]');
  if (navEl) navEl.classList.add('active');
  if (!_fromHistory) history.pushState({ page: name }, '', '#' + name);

  // Track last-used tool for dashboard recent section
  if (_TOOL_PAGES.has(name)) localStorage.setItem('sf-last-tool', name);

  if (name === 'clipstudio') loadExportsList();
  if (name === 'exports')    loadExportsPage();
  if (name === 'account')    loadAccountPage();
  if (name === 'templates')  loadGamingTemplateStatus();
  if (name === 'ranking')  { if (RKS.items.length === 0) { addRankingItem(); addRankingItem(); addRankingItem(); } else { _renderRankingItems(); } }
  if (name === 'aistudio')   aisLoadUploads();
  if (name === 'editor')     { vedRenderPhotoTrack(); vedRenderAudioTrack(); }
  if (name === 'dashboard')  _updateDashboardRecent();
}

function _updateDashboardRecent() {
  const last = localStorage.getItem('sf-last-tool');
  const wrap = document.getElementById('dash-recent');
  if (!wrap) return;
  if (!last || !_TOOL_NAMES[last]) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  wrap.innerHTML = `<div class="dash-recent-card" onclick="showPage('${last}')">
    <svg class="icon" style="color:var(--accent)"><use href="${_TOOL_ICONS[last]}"/></svg>
    <div class="dash-recent-body">
      <div class="dash-recent-lbl">Continue where you left off</div>
      <div class="dash-recent-tool">${_TOOL_NAMES[last]}</div>
    </div>
    <svg class="icon icon-sm" style="color:var(--text-3);transform:rotate(180deg)"><use href="#i-chevron-left"/></svg>
  </div>`;
}

// Browser back / forward
window.addEventListener('popstate', e => {
  const page = (e.state && e.state.page) || location.hash.slice(1) || 'dashboard';
  showPage(page, true);
});

function useTemplate(key) {
  S.template = key;
  S.bgTemplate = '';
  document.getElementById('template-select').value = key;
  _hideBgTemplateBadge();
  onTemplateChange();
  showPage('clipstudio');
}

function useGamingTemplate(name) {
  const labels = {
    subway_surfers: 'Subway Surfers',
    minecraft_parkour: 'Minecraft Parkour',
    gta: 'GTA Gameplay',
  };
  S.template = 'split_screen';
  S.bgTemplate = name;
  // Gaming templates: primary keeps audio, background is always video-only.
  setMute(false);
  document.getElementById('template-select').value = 'split_screen';
  // Show badge, hide URL/Upload tabs
  const badge  = document.getElementById('bg-template-badge');
  const nameEl = document.getElementById('bg-template-name');
  const tabs   = document.getElementById('bg-source-tabs');
  if (badge)  { badge.style.display = 'flex'; }
  if (nameEl) { nameEl.textContent = labels[name] || name; }
  if (tabs)   { tabs.style.display = 'none'; }
  onTemplateChange();
  showPage('editor');
}

function clearGamingTemplate() {
  S.bgTemplate = '';
  _hideBgTemplateBadge();
  checkReady();
}

function _hideBgTemplateBadge() {
  const badge = document.getElementById('bg-template-badge');
  const tabs  = document.getElementById('bg-source-tabs');
  if (badge) { badge.style.display = 'none'; }
  if (tabs)  { tabs.style.display = ''; }
}

function setMute(val) {
  S.mute = val;
  const cb = document.getElementById('opt-audio');
  if (cb) cb.checked = !val;  // checked = include audio = not muted
}

// ── Template description ─────────────────────────────────────
const TMPL_DESC = {
  center_crop: `
    <strong>Vertical Center-Crop</strong><br>
    · Stitches primary clips back-to-back<br>
    · Center-crops to 1080×1920 canvas<br>
    · Audio from primary track<br>
    · <em>No background video required</em>`,
  split_screen: `
    <strong>Split-Screen Vertical Stack</strong><br>
    · TOP half: your primary clips (audio on)<br>
    · BOT half: background loop (always muted)<br>
    · <em>Provide a background URL — or use a Gaming Template from the Templates page</em>`,
};

function onTemplateChange() {
  const val = document.getElementById('template-select').value;
  if (val !== 'split_screen' && S.bgTemplate) {
    S.bgTemplate = '';
    _hideBgTemplateBadge();
  }
  S.template = val;
  document.getElementById('template-desc').innerHTML = TMPL_DESC[val] || '';
  checkReady();
}

// ── URL preview ──────────────────────────────────────────────
async function previewURL(type) {
  const inputId = type === 'primary' ? 'primary-url' : 'bg-url';
  const infoId  = type === 'primary' ? 'primary-preview' : 'bg-preview';
  const url = document.getElementById(inputId).value.trim();
  const info = document.getElementById(infoId);

  info.style.display = 'block';
  if (!url) {
    info.textContent = 'Paste a URL first.';
    info.className = 'preview-info error';
    return;
  }

  info.textContent = 'Extracting stream info…';
  info.className = 'preview-info';

  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    const data = await res.json();
    info.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> <strong>${esc(data.title)}</strong> · ${fmtTS(data.duration)}`;
    info.className = 'preview-info ok';
    if (type === 'primary') initTimelineSlider(data.duration);
  } catch (e) {
    info.textContent = 'Error: ' + (e.message || 'Could not extract stream');
    info.className = 'preview-info error';
  }
}

// ── Timeline slider ───────────────────────────────────────────
function initTimelineSlider(duration) {
  S.primaryDuration = duration;
  const dur = Math.floor(duration) || 600; // default 10 min if unknown
  document.getElementById('clip-dur-label').textContent = duration
    ? `Video length: ${fmtTS(duration)} · drag the handles to pick a segment`
    : 'Drag handles to set start/end (type timestamps below for precision)';
  const rs = document.getElementById('range-start');
  const re = document.getElementById('range-end');
  rs.max = dur;
  re.max = dur;
  rs.value = 0;
  re.value = dur;
  document.getElementById('clip-start').value = fmtTS(0);
  document.getElementById('clip-end').value   = fmtTS(dur);
  updateDualFill();
}

function onRangeStart(val) {
  const dur   = parseInt(document.getElementById('range-end').max) || 600;
  const endV  = parseInt(document.getElementById('range-end').value);
  val = Math.min(parseInt(val), endV - 1, dur - 1);
  document.getElementById('range-start').value = val;
  document.getElementById('clip-start').value  = fmtTS(val);
  updateDualFill();
}

function onRangeEnd(val) {
  const dur    = parseInt(document.getElementById('range-end').max) || 600;
  const startV = parseInt(document.getElementById('range-start').value);
  val = Math.max(parseInt(val), startV + 1);
  val = Math.min(val, dur);
  document.getElementById('range-end').value = val;
  document.getElementById('clip-end').value  = fmtTS(val);
  updateDualFill();
}

function updateDualFill() {
  const dur = parseInt(document.getElementById('range-end').max) || 600;
  const start   = parseInt(document.getElementById('range-start').value) || 0;
  const end     = parseInt(document.getElementById('range-end').value)   || dur;
  const leftPct = (start / dur) * 100;
  const wPct    = Math.max(0, (end / dur) * 100 - leftPct);
  const fill    = document.getElementById('dual-fill');
  fill.style.left  = leftPct + '%';
  fill.style.width = wPct + '%';
  document.getElementById('rng-start-lbl').textContent = fmtTS(start);
  document.getElementById('rng-end-lbl').textContent   = fmtTS(end);
}

function syncInputToSlider(type) {
  if (!S.primaryDuration) return;
  const inputId = type === 'start' ? 'clip-start' : 'clip-end';
  const rangeId = type === 'start' ? 'range-start' : 'range-end';
  const secs = parseTS(document.getElementById(inputId).value);
  if (secs !== null) {
    document.getElementById(rangeId).value = Math.min(Math.floor(secs), Math.floor(S.primaryDuration));
    updateDualFill();
  }
}

function addClipFromSlider() {
  addClip();
}

// ── Timeline ─────────────────────────────────────────────────
function parseTS(ts) {
  ts = ts.trim();
  if (/^\d+(\.\d+)?$/.test(ts)) return parseFloat(ts);
  const parts = ts.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function addClip() {
  const start = document.getElementById('clip-start').value.trim();
  const end   = document.getElementById('clip-end').value.trim();
  const errEl = document.getElementById('clip-error');

  const startSec = parseTS(start);
  const endSec   = parseTS(end);

  if (!start || !end) { showClipErr('Fill both start and end times.'); return; }
  if (startSec === null) { showClipErr(`Cannot parse start: "${start}"`); return; }
  if (endSec === null)   { showClipErr(`Cannot parse end: "${end}"`); return; }
  if (endSec <= startSec) { showClipErr('End must be after start.'); return; }

  const maxDur = S.primaryDuration;
  if (maxDur > 0 && startSec >= maxDur) {
    showClipErr(`Start ${fmtTS(startSec)} is past the end of the video (${fmtTS(maxDur)}).`);
    return;
  }
  // Silently clamp end to video length if slightly over
  const clampedEnd   = maxDur > 0 ? Math.min(endSec, maxDur) : endSec;
  const clampedLabel = maxDur > 0 ? fmtTS(clampedEnd) : end;

  errEl.style.display = 'none';
  S.clips.push({ start, end: clampedLabel, startSec, endSec: clampedEnd });
  document.getElementById('clip-start').value = '';
  document.getElementById('clip-end').value   = '';
  renderClips();
  checkReady();
}

function showClipErr(msg) {
  const el = document.getElementById('clip-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function deleteClip(i) {
  S.clips.splice(i, 1);
  renderClips();
  checkReady();
}

function clearTimeline() {
  S.clips = [];
  renderClips();
  checkReady();
}

function renderClips() {
  const list    = document.getElementById('clip-list');
  const total   = document.getElementById('clip-total');
  const clearBtn = document.getElementById('clear-timeline-btn');

  if (S.clips.length === 0) {
    list.innerHTML = '<p class="muted-text" style="margin-top:8px">No clips queued. Add at least one segment above.</p>';
    total.style.display = 'none';
    clearBtn.style.display = 'none';
    return;
  }

  let totalSec = 0;
  list.innerHTML = S.clips.map((c, i) => {
    const dur = c.endSec - c.startSec;
    totalSec += dur;
    return `<div class="clip-row">
      <span class="clip-num">#${i + 1}</span>
      <span class="clip-ts">▶ ${esc(c.start)}</span>
      <span class="clip-ts">■ ${esc(c.end)}</span>
      <span class="clip-dur">${dur.toFixed(1)}s</span>
      <button class="btn-icon" title="Remove clip" onclick="deleteClip(${i})">✕</button>
    </div>`;
  }).join('');

  total.textContent = `📐 ${S.clips.length} clip(s) — total ≈ ${totalSec.toFixed(1)}s (${(totalSec / 60).toFixed(1)}m)`;
  total.style.display = 'block';
  clearBtn.style.display = 'block';
}

// ── Ready check ──────────────────────────────────────────────
// ── Editor source tabs ────────────────────────────────────────
function edSourceTab(mode) {
  S.edSourceMode = mode;
  document.getElementById('ed-tab-url').classList.toggle('active', mode === 'url');
  document.getElementById('ed-tab-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('ed-url-section').style.display    = mode === 'url'    ? '' : 'none';
  document.getElementById('ed-upload-section').style.display = mode === 'upload' ? '' : 'none';
  if (mode === 'url') { S.edUploadId = null; S.edUploadName = null; }
  checkReady();
}

function edDropFile(event) {
  event.preventDefault();
  event.stopPropagation();
  const file = event.dataTransfer?.files[0];
  if (file) edFileChosen(file);
}

async function edFileChosen(file) {
  if (!file) return;
  const statusEl = document.getElementById('ed-upload-status');
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<svg class="icon icon-sm"><use href="#i-cpu"/></svg> Uploading…';
  statusEl.className = 'preview-info';

  const fd = new FormData();
  fd.append('file', file);
  document.getElementById('ed-file-input').value = '';
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Upload failed');
    }
    const data = await res.json();
    S.edUploadId   = data.id;
    S.edUploadName = data.name;
    const durLabel = data.duration ? ` · ${fmtTS(Math.floor(data.duration))}` : '';
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> <strong>${data.name}</strong> (${data.size_mb} MB${durLabel}) — ready`;
    statusEl.className = 'preview-info ok';
    if (data.duration) initTimelineSlider(data.duration);
    // Update dropzone label
    document.getElementById('ed-dropzone').querySelector('div').textContent = data.name;
  } catch (e) {
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-warn"/></svg> ${e.message}`;
    statusEl.className = 'preview-info error';
    S.edUploadId = null;
    S.edUploadName = null;
  }
  checkReady();
}

// ── Background source tabs ────────────────────────────────────
function bgSourceTab(mode) {
  S.bgSourceMode = mode;
  document.getElementById('bg-tab-url').classList.toggle('active', mode === 'url');
  document.getElementById('bg-tab-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('bg-url-input-area').style.display    = mode === 'url'    ? '' : 'none';
  document.getElementById('bg-upload-area').style.display       = mode === 'upload' ? '' : 'none';
  if (mode === 'url') { S.bgUploadId = null; S.bgUploadName = null; }
  checkReady();
}

function bgDropFile(event) {
  event.preventDefault();
  event.stopPropagation();
  const file = event.dataTransfer?.files[0];
  if (file) bgFileChosen(file);
}

async function bgFileChosen(file) {
  if (!file) return;
  const statusEl = document.getElementById('bg-upload-status');
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<svg class="icon icon-sm"><use href="#i-cpu"/></svg> Uploading…';
  statusEl.className = 'preview-info';

  const fd = new FormData();
  fd.append('file', file);
  document.getElementById('bg-file-input').value = '';
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Upload failed');
    }
    const data = await res.json();
    S.bgUploadId   = data.id;
    S.bgUploadName = data.name;
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> <strong>${data.name}</strong> (${data.size_mb} MB)`;
    statusEl.className = 'preview-info ok';
    document.getElementById('bg-dropzone').querySelector('div').textContent = data.name;
  } catch (e) {
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-warn"/></svg> ${e.message}`;
    statusEl.className = 'preview-info error';
    S.bgUploadId = null;
    S.bgUploadName = null;
  }
  checkReady();
}

function checkReady() {
  const primaryURL = document.getElementById('primary-url').value.trim();
  const bgURL      = document.getElementById('bg-url').value.trim();
  const isSplit    = S.template === 'split_screen';
  const hasSource  = S.edSourceMode === 'upload' ? !!S.edUploadId : !!primaryURL;

  const missing = [];
  if (!hasSource)                         missing.push(S.edSourceMode === 'upload' ? 'Upload a video file' : 'Primary URL');
  if (S.clips.length === 0)               missing.push('At least one clip');
  const hasBg = bgURL || S.bgTemplate || (S.bgSourceMode === 'upload' && S.bgUploadId);
  if (isSplit && !hasBg) missing.push('Background video, URL, or Gaming Template');

  const statusEl = document.getElementById('ready-status');
  const genBtn   = document.getElementById('gen-btn');

  if (missing.length > 0) {
    statusEl.className   = 'status-missing';
    statusEl.innerHTML   = `<svg class="icon icon-sm"><use href="#i-warn"/></svg> Missing: ${missing.join(' · ')}`;
    genBtn.disabled = true;
  } else {
    statusEl.className   = 'status-ready';
    statusEl.innerHTML   = `<svg class="icon icon-sm"><use href="#i-check"/></svg> Ready — source videos will download when you generate.`;
    genBtn.disabled = false;
  }
}

// ── Generate ─────────────────────────────────────────────────
async function generate() {
  const primaryURL = document.getElementById('primary-url').value.trim();
  const bgURL      = document.getElementById('bg-url').value.trim();

  // Reset UI
  document.getElementById('gen-btn').disabled = true;
  const logBox = document.getElementById('log-box');
  logBox.innerHTML = '';
  logBox.style.display = 'block';
  document.getElementById('progress-wrap').style.display = 'block';
  setProgress(0, 'Starting…');
  document.getElementById('export-card').style.display = 'none';

  S.lastLogCount = 0;

  try {
    const resolution = document.getElementById('opt-resolution').value;
    const codec      = document.getElementById('opt-codec').value;
    const fit        = document.getElementById('opt-fit').value;

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_url: S.edSourceMode === 'url' ? primaryURL : '',
        primary_upload_id: S.edSourceMode === 'upload' ? (S.edUploadId || '') : '',
        bg_url: S.bgSourceMode === 'url' ? bgURL : '',
        bg_upload_id: S.bgSourceMode === 'upload' ? (S.bgUploadId || '') : '',
        bg_template: S.bgTemplate,
        template: S.template,
        clips: S.clips.map(c => ({ start: c.start, end: c.end })),
        resolution,
        codec,
        mute: S.mute,
        fit,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Server error');
    }
    const { job_id } = await res.json();
    S.jobId = job_id;
    startPolling(job_id);
  } catch (e) {
    appendLog({ ts: '--:--:--', msg: '[ERROR] ' + e.message, level: 'err' });
    document.getElementById('gen-btn').disabled = false;
  }
}

function startPolling(jobId) {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = setInterval(() => pollJob(jobId), 1000);
}

async function pollJob(jobId) {
  try {
    const res = await fetch('/api/jobs/' + jobId);
    if (!res.ok) return;
    const job = await res.json();

    // Append only new log lines
    job.logs.slice(S.lastLogCount).forEach(appendLog);
    S.lastLogCount = job.logs.length;

    setProgress(job.progress, job.progress + '% — ' + job.status);

    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(S.pollTimer);
      S.pollTimer = null;
      document.getElementById('gen-btn').disabled = false;

      if (job.status === 'completed' && job.output) {
        showExportResult(job.output, job.has_audio !== false);
        loadExportsList();
      }
    }
  } catch (e) {
    // network glitch — keep polling
  }
}

function setProgress(pct, label) {
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = label;
}

function appendLog(entry) {
  const box  = document.getElementById('log-box');
  const line = document.createElement('span');
  line.className = 'log-line log-' + entry.level;
  line.textContent = `[${entry.ts}] ${entry.msg}`;
  box.appendChild(line);
  box.appendChild(document.createElement('br'));
  box.scrollTop = box.scrollHeight;
}

// ── Export result — custom player ────────────────────────────
function showExportResult(filename, hasAudio = true, cardId = 'export-card', resultId = 'export-result') {
  const card = document.getElementById(cardId);
  if (card) card.style.display = 'block';
  const safeFile = esc(filename);
  const mime = filename.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
  // unique per-player prefix so multiple players can coexist in the DOM
  const pid = 'sfsp' + Date.now();
  const audioNote = hasAudio
    ? `<span class="audio-badge audio-on"><svg class="icon icon-sm"><use href="#i-vol"/></svg> Audio</span>`
    : `<span class="audio-badge audio-off"><svg class="icon icon-sm"><use href="#i-vol-off"/></svg> Silent</span>`;
  document.getElementById(resultId).innerHTML = `
    <p class="success-msg">
      <svg class="icon icon-sm"><use href="#i-check"/></svg>
      <strong>${safeFile}</strong>
      ${audioNote}
    </p>
    <div class="sfs-player" id="${pid}">
      <video id="${pid}_v" muted preload="auto" playsinline>
        <source src="/api/video/${encodeURIComponent(filename)}" type="${mime}">
      </video>
      <div class="sfs-overlay" onclick="_sfsPP('${pid}')">
        <div class="sfs-big-play" id="${pid}_bp">&#9654;</div>
      </div>
      <div class="sfs-controls">
        <div class="sfs-seekbar" id="${pid}_sb">
          <div class="sfs-seekbar-fill" id="${pid}_sf"></div>
          <div class="sfs-seekbar-thumb" id="${pid}_st"></div>
        </div>
        <div class="sfs-ctrl-row">
          <button class="sfs-btn" id="${pid}_pb" onclick="_sfsPP('${pid}')" title="Play/Pause">&#9654;</button>
          <button class="sfs-btn sfs-btn-skip" onclick="_sfsSkip('${pid}',-5)" title="-5 seconds">&#8617;5s</button>
          <button class="sfs-btn sfs-btn-skip" onclick="_sfsSkip('${pid}',5)" title="+5 seconds">5s&#8618;</button>
          <span class="sfs-time" id="${pid}_tm">0:00 / 0:00</span>
          <span style="flex:1"></span>
          ${hasAudio ? `
          <button class="sfs-btn sfs-btn-vol" id="${pid}_vb" onclick="_sfsMute('${pid}')" title="Muted — click for audio">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325L6.188 3.61a.5.5 0 0 1 .529-.06zm7.083 4.45a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.707-.707l4-4a.5.5 0 0 1 .707 0zm-4.707 0a.5.5 0 0 1 .707 0l4 4a.5.5 0 0 1-.707.707l-4-4a.5.5 0 0 1 0-.707z"/>
            </svg>
          </button>
          <input type="range" class="sfs-vol-slider" id="${pid}_vs" min="0" max="1" step="0.05" value="1"
            oninput="_sfsVol('${pid}',this.value)" title="Volume">
          ` : ''}
          <button class="sfs-btn" onclick="_sfsFs('${pid}')" title="Fullscreen">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1h4a.5.5 0 0 1 0 1H2v3.5a.5.5 0 0 1-1 0V1.5A.5.5 0 0 1 1.5 1zm13 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V2h-3.5a.5.5 0 0 1 0-1h4zm0 13h-4a.5.5 0 0 1 0-1H14v-3.5a.5.5 0 0 1 1 0v4a.5.5 0 0 1-.5.5zM1 10.5a.5.5 0 0 1 1 0V14h3.5a.5.5 0 0 1 0 1H1.5a.5.5 0 0 1-.5-.5v-4z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <button class="btn-outline" style="margin-top:10px;display:flex;width:100%;justify-content:center;gap:6px"
       onclick="downloadExport('${safeFile}')">
      <svg class="icon icon-sm"><use href="#i-dl"/></svg> Download
    </button>
  `;
  requestAnimationFrame(() => _sfsSetup(pid));
}

// ── Player internals ──────────────────────────────────────────
function _sfsSetup(pid) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.addEventListener('timeupdate', () => _sfsProgress(pid, v));
  v.addEventListener('loadedmetadata', () => _sfsProgress(pid, v));
  v.addEventListener('play', () => {
    const pb = document.getElementById(pid + '_pb');
    const bp = document.getElementById(pid + '_bp');
    if (pb) pb.innerHTML = '&#9646;&#9646;';
    if (bp) bp.style.opacity = '0';
  });
  v.addEventListener('pause', () => {
    const pb = document.getElementById(pid + '_pb');
    const bp = document.getElementById(pid + '_bp');
    if (pb) pb.innerHTML = '&#9654;';
    if (bp) { bp.innerHTML = '&#9654;'; bp.style.opacity = '1'; }
  });
  v.addEventListener('ended', () => {
    const pb = document.getElementById(pid + '_pb');
    const bp = document.getElementById(pid + '_bp');
    if (pb) pb.innerHTML = '&#8635;';
    if (bp) { bp.innerHTML = '&#8635;'; bp.style.opacity = '1'; }
  });
  // Seekbar drag
  const sb = document.getElementById(pid + '_sb');
  if (sb) {
    let dragging = false;
    const seek = (clientX) => {
      if (!v.duration) return;
      const r = sb.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      v.currentTime = pct * v.duration;
    };
    sb.addEventListener('mousedown', e => { dragging = true; seek(e.clientX); });
    document.addEventListener('mousemove', e => { if (dragging) seek(e.clientX); });
    document.addEventListener('mouseup', () => { dragging = false; });
    sb.addEventListener('touchstart', e => seek(e.touches[0].clientX), { passive: true });
    sb.addEventListener('touchmove', e => seek(e.touches[0].clientX), { passive: true });
  }
  v.play().catch(() => {});
}

function _sfsProgress(pid, v) {
  if (!v.duration) return;
  const pct = (v.currentTime / v.duration) * 100;
  const sf = document.getElementById(pid + '_sf');
  const st = document.getElementById(pid + '_st');
  const tm = document.getElementById(pid + '_tm');
  if (sf) sf.style.width = pct + '%';
  if (st) st.style.left = pct + '%';
  if (tm) tm.textContent = fmtTS(Math.floor(v.currentTime)) + ' / ' + fmtTS(Math.floor(v.duration));
}

function _sfsPP(pid) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
}

function _sfsSkip(pid, sec) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + sec));
}

function _sfsMute(pid) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.muted = !v.muted;
  if (!v.muted && v.volume === 0) v.volume = 1;
  const sl = document.getElementById(pid + '_vs');
  if (sl) sl.value = v.muted ? 0 : v.volume;
  _sfsVolIcon(pid, v);
}

function _sfsVol(pid, val) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.volume = parseFloat(val);
  v.muted = (v.volume === 0);
  _sfsVolIcon(pid, v);
}

function _sfsVolIcon(pid, v) {
  const btn = document.getElementById(pid + '_vb');
  if (!btn) return;
  if (v.muted || v.volume === 0) {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325L6.188 3.61a.5.5 0 0 1 .529-.06zm7.083 4.45a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.707-.707l4-4a.5.5 0 0 1 .707 0zm-4.707 0a.5.5 0 0 1 .707 0l4 4a.5.5 0 0 1-.707.707l-4-4a.5.5 0 0 1 0-.707z"/>
    </svg>`;
    btn.title = 'Muted — click for audio';
  } else {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
      <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
      <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325L6.188 3.61a.5.5 0 0 1 .529-.06z"/>
    </svg>`;
    btn.title = 'Mute';
  }
}

function _sfsFs(pid) {
  const player = document.getElementById(pid);
  if (!player) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    player.requestFullscreen().catch(() => {
      const v = document.getElementById(pid + '_v');
      if (v && v.requestFullscreen) v.requestFullscreen().catch(() => {});
    });
  }
}

// ── Download with rename modal ────────────────────────────────
function downloadExport(filename, withPrompt = true) {
  const ext = filename.match(/\.(mp4|webm)$/i)?.[0] ?? '.mp4';
  if (!withPrompt) {
    _triggerDownload(filename, filename);
    return;
  }
  const suggested = filename
    .replace(/^short_(crop|split|ranking|aistudio)_\d{8}_\d{6}/, 'my-short')
    .replace(/\.(mp4|webm)$/i, '');
  _modal({
    icon: 'dl', iconColor: 'info',
    title: 'Save as',
    msg: 'Give your video a descriptive name — the file extension is added automatically.',
    input: { label: 'Filename (no extension needed)', value: suggested },
    confirm: { label: 'Download' },
    cancel: { label: 'Cancel' },
    onConfirm: (val) => {
      _triggerDownload(filename, (val.trim() || suggested) + ext);
    },
  });
}

function _triggerDownload(filename, saveName) {
  const a = document.createElement('a');
  a.href = '/api/download/' + encodeURIComponent(filename);
  a.download = saveName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Export helpers (compact rows for editor / account) ────────
function _exportRowHtml(f) {
  const safeAttr = esc(f.name).replace(/'/g, '&#39;');
  return `<div class="export-row">
    <span class="export-name">${esc(f.name)}</span>
    <span class="export-size">${f.size_mb} MB</span>
    <button class="btn-sm" title="Watch" onclick="openWatchModal('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-film"/></svg>
    </button>
    <button class="btn-sm" title="Download" onclick="downloadExport('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-dl"/></svg>
    </button>
    <button class="btn-del btn-icon" title="Delete" onclick="deleteExport('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-trash"/></svg>
    </button>
  </div>`;
}

// ── Full rows for Exports page (with checkbox) ────────────────
let _selectedExports = new Set();

function _exportFullRowHtml(f) {
  const ext      = f.name.endsWith('.webm') ? 'WebM' : 'MP4';
  const date     = _parseExportDate(f.name);
  const checked  = _selectedExports.has(f.name) ? 'checked' : '';
  const safeAttr = esc(f.name).replace(/'/g, '&#39;');
  return `<div class="export-full-row" id="erow-${btoa(encodeURIComponent(f.name)).replace(/[^a-z0-9]/gi,'')}">
    <input type="checkbox" class="export-checkbox" ${checked}
           onchange="toggleExportSelect('${safeAttr}', this.checked)">
    <span class="export-name" style="flex:1">${esc(f.name)}</span>
    <span class="export-ext-badge">${ext}</span>
    <span class="export-size">${f.size_mb} MB</span>
    <span class="export-date">${date}</span>
    <button class="btn-sm" title="Watch" onclick="openWatchModal('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-film"/></svg>
    </button>
    <button class="btn-sm" title="Download" onclick="downloadExport('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-dl"/></svg>
    </button>
    <button class="btn-del btn-icon" title="Delete" onclick="deleteExport('${safeAttr}', true)">
      <svg class="icon icon-sm"><use href="#i-trash"/></svg>
    </button>
  </div>`;
}

function openWatchModal(filename) {
  const modal = document.getElementById('watch-modal');
  if (!modal) return;
  // Reset content
  document.getElementById('watch-modal-result').innerHTML = '';
  document.getElementById('watch-modal-card').style.display = 'none';
  modal.style.display = 'flex';
  showExportResult(filename, true, 'watch-modal-card', 'watch-modal-result');
}

function closeWatchModal() {
  const modal = document.getElementById('watch-modal');
  if (modal) modal.style.display = 'none';
  // Stop any playing video
  const vid = modal?.querySelector('video');
  if (vid) { vid.pause(); vid.src = ''; }
  document.getElementById('watch-modal-result').innerHTML = '';
}

function toggleExportSelect(name, checked) {
  if (checked) _selectedExports.add(name);
  else         _selectedExports.delete(name);
  _updateSelectionBar();
}

function toggleSelectAll(checked) {
  const boxes = document.querySelectorAll('.export-checkbox');
  boxes.forEach(cb => {
    cb.checked = checked;
    const row = cb.closest('.export-full-row');
    if (row) {
      const nameEl = row.querySelector('.export-name');
      if (nameEl) {
        if (checked) _selectedExports.add(nameEl.textContent.trim());
        else         _selectedExports.delete(nameEl.textContent.trim());
      }
    }
  });
  _updateSelectionBar();
}

function _updateSelectionBar() {
  const bar   = document.getElementById('export-select-bar');
  const label = document.getElementById('select-count-label');
  const allCb = document.getElementById('select-all-cb');
  const n = _selectedExports.size;
  if (bar)   bar.style.display  = n > 0 ? 'flex' : 'none';
  if (label) label.textContent  = `${n} selected`;
  // Sync select-all checkbox state
  if (allCb) {
    const total = document.querySelectorAll('.export-checkbox').length;
    allCb.checked       = total > 0 && n === total;
    allCb.indeterminate = n > 0 && n < total;
  }
}

function clearSelection() {
  _selectedExports.clear();
  document.querySelectorAll('.export-checkbox').forEach(cb => { cb.checked = false; });
  const allCb = document.getElementById('select-all-cb');
  if (allCb) { allCb.checked = false; allCb.indeterminate = false; }
  _updateSelectionBar();
}

async function bulkDownload() {
  if (!_selectedExports.size) return;
  for (const name of _selectedExports) {
    await downloadExport(name, false);
    await new Promise(r => setTimeout(r, 200)); // small gap so browser doesn't block
  }
}

function bulkDelete() {
  if (!_selectedExports.size) return;
  const n = _selectedExports.size;
  _modal({
    icon: 'trash', iconColor: 'danger',
    title: `Delete ${n} export${n > 1 ? 's' : ''}`,
    msg: `${n} export${n > 1 ? 's' : ''} will be permanently removed. This cannot be undone.`,
    confirm: { label: `Delete ${n > 1 ? `all ${n}` : 'export'}`, danger: true },
    cancel: { label: 'Cancel' },
    onConfirm: async () => {
      const names = [..._selectedExports];
      _selectedExports.clear();
      let failed = 0;
      for (const name of names) {
        try {
          const res = await fetch('/api/exports/' + encodeURIComponent(name), { method: 'DELETE' });
          if (!res.ok) failed++;
        } catch { failed++; }
      }
      loadExportsPage();
      if (failed) {
        _modal({ icon: 'warn', iconColor: 'warn', title: 'Partial failure',
          msg: `${failed} file${failed > 1 ? 's' : ''} could not be deleted.`,
          confirm: { label: 'OK' } });
      }
    },
  });
}

function _parseExportDate(filename) {
  const m = filename.match(/(\d{8})_(\d{6})/);
  if (!m) return '';
  const d = m[1];
  try {
    return new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch { return ''; }
}

// ── Editor exports list (capped at 4) ────────────────────────
async function loadExportsList() {
  const div = document.getElementById('exports-list');
  try {
    const files = await fetchExports();
    if (!files.length) { div.innerHTML = '<p class="muted-text">No exports yet.</p>'; return; }
    const preview = files.slice(0, 4);
    let html = preview.map(_exportRowHtml).join('');
    if (files.length > 4) {
      html += `<div class="exports-view-all">
        <a class="btn-sm" style="cursor:pointer" onclick="showPage('exports')">
          View all ${files.length} exports
          <svg class="icon icon-sm"><use href="#i-dl"/></svg>
        </a>
      </div>`;
    }
    div.innerHTML = html;
  } catch {
    div.innerHTML = '<p class="muted-text">Could not load exports.</p>';
  }
}

// ── Exports page ──────────────────────────────────────────────
let _allExports = [];

async function loadExportsPage() {
  const div = document.getElementById('exports-page-list');
  div.innerHTML = '<p class="muted-text">Loading…</p>';
  _selectedExports.clear();
  _updateSelectionBar();
  try {
    _allExports = await fetchExports();
    _renderExportsPage(_allExports);
    const chip = document.getElementById('exports-count-chip');
    if (chip) chip.textContent = _allExports.length;
  } catch {
    div.innerHTML = '<p class="muted-text">Could not load exports.</p>';
  }
}

function _renderExportsPage(files) {
  const div = document.getElementById('exports-page-list');
  if (!files.length) {
    div.innerHTML = '<p class="muted-text">No exports yet. Generate a short in the Editor.</p>';
    _updateSelectionBar();
    return;
  }
  div.innerHTML = `
    <div class="export-select-all-row">
      <input type="checkbox" id="select-all-cb" onchange="toggleSelectAll(this.checked)">
      <label for="select-all-cb" class="muted" style="font-size:.78rem;cursor:pointer">Select all</label>
    </div>
    ${files.map(_exportFullRowHtml).join('')}
  `;
  _updateSelectionBar();
}

function filterExports(query) {
  const q = query.toLowerCase();
  const filtered = q ? _allExports.filter(f => f.name.toLowerCase().includes(q)) : _allExports;
  _selectedExports.clear();
  _renderExportsPage(filtered);
}

function deleteExport(filename, fromExportsPage = false) {
  _modal({
    icon: 'trash', iconColor: 'danger',
    title: 'Delete export',
    msg: `<strong>${esc(filename)}</strong><br><br>This export will be permanently removed and cannot be recovered.`,
    confirm: { label: 'Delete', danger: true },
    cancel: { label: 'Cancel' },
    onConfirm: async () => {
      try {
        const res = await fetch('/api/exports/' + encodeURIComponent(filename), { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');
        if (fromExportsPage) loadExportsPage();
        else { loadExportsList(); loadAccountPage(); }
      } catch (e) {
        _modal({ icon: 'warn', iconColor: 'danger', title: 'Could not delete', msg: e.message, confirm: { label: 'OK' } });
      }
    },
  });
}

async function fetchExports() {
  const res = await fetch('/api/exports');
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}

// ── Account page ──────────────────────────────────────────────
async function loadAccountPage() {
  loadProfile();
  const div = document.getElementById('account-exports');
  try {
    const files = await fetchExports();
    if (!files.length) { div.innerHTML = '<p class="muted-text">No exports yet.</p>'; return; }
    div.innerHTML = files.slice(0, 5).map(_exportRowHtml).join('');
    if (files.length > 5) {
      div.innerHTML += `<div class="exports-view-all">
        <a class="btn-sm" style="cursor:pointer" onclick="showPage('exports')">View all ${files.length} exports</a>
      </div>`;
    }
  } catch {
    div.innerHTML = '<p class="muted-text">Could not load exports.</p>';
  }
}

// ── Profile ───────────────────────────────────────────────────
function loadProfile() {
  const name  = localStorage.getItem('sf-profile-name')  || 'Guest';
  const email = localStorage.getItem('sf-profile-email') || '';
  const nameEl  = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const avatarEl = document.getElementById('profile-avatar');
  if (nameEl)  nameEl.value  = name;
  if (emailEl) emailEl.value = email;
  if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
  _applySidebarProfile(name, email);
}

function saveProfile() {
  const name  = (document.getElementById('profile-name').value.trim()  || 'Guest');
  const email = (document.getElementById('profile-email').value.trim() || '');
  localStorage.setItem('sf-profile-name',  name);
  localStorage.setItem('sf-profile-email', email);
  document.getElementById('profile-avatar').textContent = name[0].toUpperCase();
  _applySidebarProfile(name, email);
  const btn = document.getElementById('save-profile-btn');
  const orig = btn.textContent;
  btn.textContent = 'Saved';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

function _applySidebarProfile(name, email) {
  const avatarEl  = document.getElementById('sidebar-avatar');
  const nameEl    = document.getElementById('sidebar-name');
  const emailEl   = document.getElementById('sidebar-email');
  const greetEl   = document.getElementById('greeting-name');
  const signinEl  = document.getElementById('sidebar-signin-link');
  const isGuest   = !authToken();

  if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
  if (nameEl)   nameEl.innerHTML = `${esc(name)} <span class="user-plan">Free</span>`;
  if (emailEl)  emailEl.textContent = isGuest ? 'Not signed in' : (email || 'Signed in');
  if (greetEl)  greetEl.textContent = isGuest ? 'there' : name;
  if (signinEl) signinEl.style.display = isGuest ? 'block' : 'none';
}

// ── Ranking template editor ──────────────────────────────────
const RK_DEFAULT_COLORS = [
  '#FFFFFF','#44FF88','#FFD700','#FF8C00','#4488FF',
  '#FF44FF','#00FFFF','#FF4444','#AAFF44','#FF44AA',
  '#AA88FF','#44FFCC',
];

const RKS = {
  items: [],     // [{url,start,end,label,color,fit}]
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
};

function openRankingTemplate() {
  if (RKS.items.length === 0) {
    addRankingItem(); addRankingItem(); addRankingItem();
  }
  showPage('ranking');
}

function addRankingItem() {
  const idx = RKS.items.length;
  if (idx >= 20) return;
  const color = RK_DEFAULT_COLORS[idx % RK_DEFAULT_COLORS.length];
  RKS.items.push({ url: '', start: '0:00', end: '', label: '', color, fit: 'crop', crop_x: 0.5, crop_y: 0.5, _thumb: '', _thumbW: 0, _thumbH: 0 });
  _renderRankingItems();
  _checkRankingReady();
}

function removeRankingItem(idx) {
  RKS.items.splice(idx, 1);
  _renderRankingItems();
  _checkRankingReady();
}

function moveRankingItem(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= RKS.items.length) return;
  [RKS.items[idx], RKS.items[j]] = [RKS.items[j], RKS.items[idx]];
  _renderRankingItems();
}

function _readRankingItemsFromDOM() {
  RKS.items = Array.from(document.querySelectorAll('.rk-item-row')).map((row, i) => {
    const existing = RKS.items[i] || {};
    const cropBox  = row.querySelector('.rk-cropbox');
    return {
      url:    row.querySelector('.rk-url').value.trim(),
      start:  row.querySelector('.rk-start').value.trim() || '0:00',
      end:    row.querySelector('.rk-end').value.trim(),
      label:  row.querySelector('.rk-label').value.trim(),
      color:  row.querySelector('.rk-color').value,
      fit:    row.querySelector('.rk-fit').value,
      crop_x: cropBox ? parseFloat(cropBox.dataset.cropx || 0.5) : (existing.crop_x ?? 0.5),
      crop_y: cropBox ? parseFloat(cropBox.dataset.cropy || 0.5) : (existing.crop_y ?? 0.5),
      _thumb: existing._thumb || '',
      _thumbW: existing._thumbW || 0,
      _thumbH: existing._thumbH || 0,
    };
  });
}

function _renderRankingItems() {
  const container = document.getElementById('rk-items-list');
  if (!container) return;
  container.innerHTML = RKS.items.map((item, i) => `
    <div class="rk-item-row" id="rk-item-${i}">
      <div class="rk-num">${i + 1}</div>
      <div class="rk-fields">
        <div class="rk-row-top">
          <input class="text-input rk-url" type="url" placeholder="Video URL (YouTube, etc.)"
            value="${esc(item.url)}" oninput="RKS.items[${i}].url=this.value;_checkRankingReady()">
          <button class="btn-sm" onclick="_previewRankingUrl(${i})">Preview</button>
          <input type="color" class="rk-color" value="${esc(item.color)}"
            oninput="RKS.items[${i}].color=this.value" title="Item color">
        </div>
        <div class="rk-row-mid">
          <input class="text-input rk-label" type="text" placeholder="Label (e.g. Trash can karen)"
            value="${esc(item.label)}" oninput="RKS.items[${i}].label=this.value">
        </div>
        <div class="rk-row-bot">
          <span class="field-label" style="margin:0">Clip from</span>
          <input class="text-input rk-start" type="text" placeholder="0:00"
            value="${esc(item.start)}" oninput="RKS.items[${i}].start=this.value">
          <span class="field-label" style="margin:0">to</span>
          <input class="text-input rk-end" type="text" placeholder="0:10"
            value="${esc(item.end)}" oninput="RKS.items[${i}].end=this.value;_checkRankingReady()">
          <select class="text-input rk-fit" title="Fit mode for this clip"
            onchange="RKS.items[${i}].fit=this.value;_rkToggleCropUI(${i})">
            <option value="crop"${item.fit==='crop'?' selected':''}>Crop</option>
            <option value="blur"${item.fit==='blur'?' selected':''}>Blur bg</option>
            <option value="letterbox"${item.fit==='letterbox'?' selected':''}>Letterbox</option>
          </select>
          <div class="rk-preview-info" id="rk-prev-${i}"></div>
        </div>
        ${item._thumb ? `
        <div class="rk-crop-wrap${item.fit==='letterbox'?' rk-crop-hidden':''}" id="rk-crop-${i}">
          <div class="rk-cropbox" id="rk-cropbox-${i}"
               data-cropx="${item.crop_x ?? 0.5}" data-cropy="${item.crop_y ?? 0.5}"
               onclick="rkCropClick(event,${i})">
            <img class="rk-crop-img" id="rk-crop-img-${i}" src="${esc(item._thumb)}" alt="frame"
                 onload="_updateCropIndicator(${i})">
            <div class="rk-crop-ind" id="rk-crop-ind-${i}"></div>
          </div>
          <span class="rk-crop-hint">Click to reposition the crop area</span>
        </div>` : `<div class="rk-crop-wrap rk-crop-hidden" id="rk-crop-${i}"></div>`}
      </div>
      <div class="rk-item-actions">
        <button class="btn-icon" onclick="moveRankingItem(${i},-1)" ${i===0?'disabled':''} title="Move up">↑</button>
        <button class="btn-icon" onclick="moveRankingItem(${i},1)" ${i===RKS.items.length-1?'disabled':''} title="Move down">↓</button>
        <button class="btn-icon btn-danger-icon" onclick="removeRankingItem(${i})" title="Remove">×</button>
      </div>
    </div>
  `).join('');

  const addBtn = document.getElementById('rk-add-btn');
  if (addBtn) addBtn.disabled = RKS.items.length >= 20;
}

function _checkRankingReady() {
  const btn = document.getElementById('rk-generate-btn');
  if (!btn) return;
  const ready = RKS.items.length > 0 && RKS.items.every(it => it.url && it.end);
  btn.disabled = !ready;
}

async function _previewRankingUrl(idx) {
  const row = document.getElementById(`rk-item-${idx}`);
  if (!row) return;
  const url = row.querySelector('.rk-url').value.trim();
  const info = document.getElementById(`rk-prev-${idx}`);
  if (!url || !info) return;
  info.textContent = 'Checking…';
  info.className = 'rk-preview-info';
  try {
    const res = await fetch('/api/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const d = await res.json();
    info.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> ${esc(d.title)} · ${fmtTS(d.duration)}`;
    info.className = 'rk-preview-info rk-prev-ok';
    // Auto-populate end time if empty
    if (!RKS.items[idx].end) {
      const endInput = row.querySelector('.rk-end');
      const autoEnd = fmtTS(Math.min(10, d.duration));
      endInput.value = autoEnd;
      RKS.items[idx].end = autoEnd;
      _checkRankingReady();
    }
    // Save thumbnail data and show crop UI
    if (d.thumbnail) {
      RKS.items[idx]._thumb  = d.thumbnail;
      RKS.items[idx]._thumbW = d.width  || 0;
      RKS.items[idx]._thumbH = d.height || 0;
      _rkShowCropUI(idx, d.thumbnail);
    }
  } catch (e) {
    info.textContent = 'Error: ' + e.message;
    info.className = 'rk-preview-info rk-prev-err';
  }
}

function _rkShowCropUI(idx, thumbUrl) {
  const wrap = document.getElementById(`rk-crop-${idx}`);
  if (!wrap) return;
  const fit = RKS.items[idx]?.fit || 'crop';
  wrap.className = 'rk-crop-wrap' + (fit === 'letterbox' ? ' rk-crop-hidden' : '');
  const cx = RKS.items[idx]?.crop_x ?? 0.5;
  const cy = RKS.items[idx]?.crop_y ?? 0.5;
  wrap.innerHTML = `
    <div class="rk-cropbox" id="rk-cropbox-${idx}"
         data-cropx="${cx}" data-cropy="${cy}" onclick="rkCropClick(event,${idx})">
      <img class="rk-crop-img" id="rk-crop-img-${idx}" src="${esc(thumbUrl)}" alt="frame"
           onload="_updateCropIndicator(${idx})" crossorigin="anonymous">
      <div class="rk-crop-ind" id="rk-crop-ind-${idx}"></div>
    </div>
    <span class="rk-crop-hint">Click to reposition the crop area</span>
  `;
}

function _rkToggleCropUI(idx) {
  const fit  = RKS.items[idx]?.fit || 'crop';
  const wrap = document.getElementById(`rk-crop-${idx}`);
  if (!wrap) return;
  if (fit === 'letterbox' || !RKS.items[idx]?._thumb) {
    wrap.classList.add('rk-crop-hidden');
  } else {
    wrap.classList.remove('rk-crop-hidden');
  }
}

function rkCropClick(event, idx) {
  const box  = event.currentTarget;
  const rect = box.getBoundingClientRect();
  const px   = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const py   = Math.max(0, Math.min(1, (event.clientY - rect.top)  / rect.height));
  box.dataset.cropx = px;
  box.dataset.cropy = py;
  RKS.items[idx].crop_x = px;
  RKS.items[idx].crop_y = py;
  _updateCropIndicator(idx);
}

function _updateCropIndicator(idx) {
  const item = RKS.items[idx];
  if (!item) return;
  const img  = document.getElementById(`rk-crop-img-${idx}`);
  const ind  = document.getElementById(`rk-crop-ind-${idx}`);
  if (!img || !ind) return;

  // Use stored dims first, fall back to thumbnail natural size
  const iw = item._thumbW || img.naturalWidth  || 16;
  const ih = item._thumbH || img.naturalHeight || 9;

  // Canvas target AR from resolution selector
  const res = document.getElementById('rk-resolution')?.value || '1080x1920';
  const [cw, ch] = res.split('x').map(Number);

  // Fill-scale: scale factor to fill the canvas
  const sf        = Math.max(cw / iw, ch / ih);
  const scaledW   = iw * sf;
  const scaledH   = ih * sf;

  // Fraction of scaled image that is visible (the crop window)
  const fracW = Math.min(1, cw / scaledW);
  const fracH = Math.min(1, ch / scaledH);

  // Top-left of the indicator as a fraction of the image
  const cx     = item.crop_x ?? 0.5;
  const cy     = item.crop_y ?? 0.5;
  const leftPct = cx * (1 - fracW) * 100;
  const topPct  = cy * (1 - fracH) * 100;

  ind.style.left   = leftPct + '%';
  ind.style.top    = topPct  + '%';
  ind.style.width  = (fracW * 100) + '%';
  ind.style.height = (fracH * 100) + '%';
}

async function generateRanking() {
  _readRankingItemsFromDOM();
  const title        = (document.getElementById('rk-title').value.trim()) || 'RANKING';
  const titleColor   = document.getElementById('rk-title-color').value;
  const subtitle     = document.getElementById('rk-subtitle').value.trim();
  const subtitleColor= document.getElementById('rk-subtitle-color').value;
  const resolution   = document.getElementById('rk-resolution').value;
  const codec        = document.getElementById('rk-codec').value;
  const mute         = document.getElementById('rk-mute').checked;
  const fontSize     = parseInt(document.getElementById('rk-font-size').value) || 0;

  const btn = document.getElementById('rk-generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="rk-spinner"></span>Generating…';

  const logBox = document.getElementById('rk-log-box');
  const logWrap = document.getElementById('rk-log-wrap');
  logWrap.style.display = 'block';
  logBox.innerHTML = '';
  document.getElementById('rk-export-card').style.display = 'none';
  document.getElementById('rk-progress-fill').style.width = '0%';
  RKS.lastLogCount = 0;

  try {
    const res = await fetch('/api/generate/ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, title_color: titleColor,
        subtitle, subtitle_color: subtitleColor,
        items: RKS.items,
        resolution, codec, mute, font_size: fontSize,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const { job_id } = await res.json();
    RKS.jobId = job_id;
    if (RKS.pollTimer) clearInterval(RKS.pollTimer);
    RKS.pollTimer = setInterval(() => _pollRankingJob(job_id), 1000);
  } catch (e) {
    _appendRkLog({ ts: '--:--:--', msg: '[ERROR] ' + e.message, level: 'err' });
    btn.disabled = false;
    btn.innerHTML = '<svg class="icon"><use href="#i-zap"/></svg> Generate Ranking Video';
  }
}

async function _pollRankingJob(jobId) {
  try {
    const res = await fetch('/api/jobs/' + jobId);
    if (!res.ok) return;
    const job = await res.json();

    job.logs.slice(RKS.lastLogCount).forEach(_appendRkLog);
    RKS.lastLogCount = job.logs.length;
    document.getElementById('rk-progress-fill').style.width = job.progress + '%';
    document.getElementById('rk-progress-label').textContent = job.progress + '% — ' + job.status;

    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(RKS.pollTimer);
      RKS.pollTimer = null;
      const btn = document.getElementById('rk-generate-btn');
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-zap"/></svg> Generate Ranking Video';
      if (job.status === 'completed' && job.output) {
        showExportResult(job.output, job.has_audio !== false, 'rk-export-card', 'rk-export-result');
        document.getElementById('rk-export-card').style.display = 'block';
      }
    }
  } catch { /* keep polling */ }
}

function _appendRkLog(entry) {
  const box = document.getElementById('rk-log-box');
  if (!box) return;
  const line = document.createElement('span');
  line.className = 'log-line log-' + entry.level;
  line.textContent = `[${entry.ts}] ${entry.msg}`;
  box.appendChild(line);
  box.appendChild(document.createElement('br'));
  box.scrollTop = box.scrollHeight;
}

// ── Gaming template status ────────────────────────────────────
async function loadGamingTemplateStatus() {
  try {
    const list = await fetch('/api/bg-templates').then(r => r.json());
    list.forEach(({ name, ready }) => {
      const chip = document.getElementById('gstatus-' + name);
      const card = document.getElementById('gtmpl-' + name);
      if (chip) {
        chip.textContent = ready ? 'Ready' : 'Setup';
        chip.className = 'gaming-status-chip ' + (ready ? 'gstatus-ready' : 'gstatus-needed');
      }
      if (card) card.classList.toggle('not-ready', !ready);
    });
  } catch { /* non-critical */ }
}

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── App Modal (replaces alert / confirm / prompt) ────────────
let _sfmOk = null;

function _modal({ icon = 'warn', iconColor = 'warn', title = '', msg = '',
                  input = null, confirm: cfm = null, cancel: cnl = null, onConfirm = null }) {
  _sfmOk = onConfirm || null;

  const wrap = document.getElementById('sfm-icon-wrap');
  const ico  = document.getElementById('sfm-icon');
  if (wrap) wrap.className = 'sfm-icon-wrap sfm-icon-' + iconColor;
  if (ico)  ico.innerHTML  = `<use href="#i-${icon}"/>`;

  const titleEl = document.getElementById('sfm-title');
  const msgEl   = document.getElementById('sfm-msg');
  if (titleEl) titleEl.textContent = title;
  if (msgEl)   msgEl.innerHTML = msg;

  const inpWrap = document.getElementById('sfm-input-wrap');
  const inpEl   = document.getElementById('sfm-input');
  const inpLbl  = document.getElementById('sfm-input-label');
  if (input) {
    if (inpWrap) inpWrap.style.display = '';
    if (inpLbl)  inpLbl.textContent    = input.label || '';
    if (inpEl) {
      inpEl.value = input.value || '';
      setTimeout(() => { inpEl.focus(); inpEl.select(); }, 80);
    }
  } else {
    if (inpWrap) inpWrap.style.display = 'none';
  }

  const btns = document.getElementById('sfm-btns');
  if (btns) {
    btns.innerHTML = '';
    if (cnl) {
      const b = document.createElement('button');
      b.className = 'sfm-btn sfm-btn-cancel';
      b.textContent = (typeof cnl === 'string') ? cnl : (cnl.label || 'Cancel');
      b.onclick = _sfModalClose;
      btns.appendChild(b);
    }
    if (cfm) {
      const b = document.createElement('button');
      b.className = 'sfm-btn ' + (cfm.danger ? 'sfm-btn-danger' : 'sfm-btn-confirm');
      b.textContent = (typeof cfm === 'string') ? cfm : (cfm.label || 'OK');
      b.onclick = _sfModalConfirm;
      btns.appendChild(b);
    }
  }

  const modal = document.getElementById('sf-modal');
  if (modal) modal.style.display = 'flex';
}

function _sfModalConfirm() {
  const val = document.getElementById('sfm-input')?.value ?? '';
  _sfModalClose();
  if (_sfmOk) _sfmOk(val);
}

function _sfModalClose() {
  const modal = document.getElementById('sf-modal');
  if (modal) modal.style.display = 'none';
  _sfmOk = null;
}

function _sfModalBgClick(e) {
  if (e.target === document.getElementById('sf-modal')) _sfModalClose();
}

function showUpgradeComingSoon() {
  _modal({
    icon: 'zap', iconColor: 'info',
    title: 'Coming soon',
    msg: 'Paid plans aren\'t live yet — ClipKings is completely free during beta.',
    confirm: { label: 'Got it' },
  });
}

// ── Theme ─────────────────────────────────────────────────────
function setBase(base) {
  document.documentElement.setAttribute('data-theme', base === 'light' ? 'light' : '');
  document.getElementById('btn-dark')?.classList.toggle('active', base !== 'light');
  document.getElementById('btn-light')?.classList.toggle('active', base === 'light');
  localStorage.setItem('sf-theme-base', base);
  _syncProfileTheme(base);
}

function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-hover',
    color === '#3B82F6' ? '#2563EB' : shiftColor(color, -20));
  localStorage.setItem('sf-theme-accent', color);
  syncAccentUI(color);
}

function shiftColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ── AI Studio ────────────────────────────────────────────────
const AIS = {
  sourceType: 'url',
  uploadId: '',
  jobId: null,
  pollTimer: null,
  lastLogCount: 0,
};

function openAiStudioTemplate() {
  showPage('aistudio');
}

function aisSourceTab(type) {
  AIS.sourceType = type;
  AIS.uploadId   = '';
  document.getElementById('ais-tab-url').classList.toggle('active', type === 'url');
  document.getElementById('ais-tab-upload').classList.toggle('active', type === 'upload');
  document.getElementById('ais-url-panel').style.display    = type === 'url'    ? '' : 'none';
  document.getElementById('ais-upload-panel').style.display = type === 'upload' ? '' : 'none';
  aisCheckReady();
}

function aisToggleSection(section, enabled) {
  const card = document.getElementById(`ais-${section}-card`);
  if (!card) return;
  card.style.opacity      = enabled ? '1' : '.45';
  card.style.pointerEvents = enabled ? '' : 'none';
}

async function aisPreviewUrl() {
  const url  = document.getElementById('ais-url').value.trim();
  const info = document.getElementById('ais-url-preview');
  if (!url || !info) return;
  info.textContent = 'Checking…';
  info.className = 'rk-preview-info';
  try {
    const res = await fetch('/api/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const d = await res.json();
    info.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> ${esc(d.title)} · ${fmtTS(d.duration)}`;
    info.className = 'rk-preview-info rk-prev-ok';
  } catch (e) {
    info.textContent = 'Error: ' + e.message;
    info.className = 'rk-preview-info rk-prev-err';
  }
  aisCheckReady();
}

function aisDropFile(event) {
  event.preventDefault();
  event.stopPropagation(); // prevent label from opening the picker after a drag-drop
  const file = event.dataTransfer?.files?.[0];
  if (file) aisUploadFile(file);
}

function aisFileChosen(file) {
  if (file) aisUploadFile(file);
}

async function aisUploadFile(file) {
  // Reset input so the same file can be re-selected if needed
  const fileInput = document.getElementById('ais-file-input');
  if (fileInput) fileInput.value = '';

  const status = document.getElementById('ais-upload-status');
  if (status) status.textContent = `Uploading ${file.name}…`;

  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
    const entry = await res.json();
    if (status) status.textContent = '';
    await aisLoadUploads();
    aisUseUpload(entry.id);
  } catch (e) {
    if (status) status.textContent = '';
    _modal({
      icon: 'warn', iconColor: 'danger',
      title: 'Upload failed',
      msg: e.message,
      confirm: { label: 'OK' },
    });
  }
}

async function aisLoadUploads() {
  const list = document.getElementById('ais-uploads-list');
  if (!list) return;
  try {
    const uploads = await fetch('/api/uploads').then(r => r.json());
    if (!uploads.length) {
      list.innerHTML = '<p class="muted-text" style="font-size:.78rem">No uploads yet.</p>';
      return;
    }
    list.innerHTML = uploads.map(u => `
      <div class="ais-upload-row${AIS.uploadId === u.id ? ' ais-upload-selected' : ''}" id="ais-urow-${u.id}">
        <div class="ais-upload-name" title="${esc(u.original_name)}">${esc(u.original_name)}</div>
        <div class="ais-upload-meta">${u.size_mb} MB</div>
        <button class="btn-sm" onclick="aisUseUpload('${u.id}')">Use</button>
        <button class="btn-icon btn-danger-icon" onclick="aisDeleteUpload('${u.id}')" title="Delete">×</button>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<p class="muted-text" style="font-size:.78rem">Could not load uploads.</p>';
  }
}

function aisUseUpload(id) {
  AIS.uploadId = id;
  document.querySelectorAll('.ais-upload-row').forEach(r => r.classList.remove('ais-upload-selected'));
  const row = document.getElementById(`ais-urow-${id}`);
  if (row) row.classList.add('ais-upload-selected');
  aisCheckReady();
}

function aisDeleteUpload(id) {
  const name = document.getElementById(`ais-urow-${id}`)
    ?.querySelector('.ais-upload-name')?.textContent || id;
  _modal({
    icon: 'trash', iconColor: 'danger',
    title: 'Delete upload',
    msg: `<strong>${esc(name)}</strong> will be removed from your uploads library.`,
    confirm: { label: 'Delete', danger: true },
    cancel: { label: 'Cancel' },
    onConfirm: async () => {
      try {
        const res = await fetch('/api/uploads/' + id, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');
        if (AIS.uploadId === id) { AIS.uploadId = ''; aisCheckReady(); }
        await aisLoadUploads();
      } catch (e) {
        _modal({ icon: 'warn', iconColor: 'danger', title: 'Could not delete', msg: e.message, confirm: { label: 'OK' } });
      }
    },
  });
}

function aisCheckReady() {
  const btn = document.getElementById('ais-generate-btn');
  if (!btn) return;

  const hasSource = AIS.sourceType === 'url'
    ? (document.getElementById('ais-url')?.value.trim() || '')
    : AIS.uploadId;

  const doSubs = document.getElementById('ais-do-subs')?.checked;
  const doVo   = document.getElementById('ais-do-vo')?.checked;
  const script = document.getElementById('ais-vo-script')?.value.trim() || '';

  const ready = hasSource && (doSubs || doVo) && (!doVo || script);
  btn.disabled = !ready;
}

async function generateAiStudio() {
  const doSubs = document.getElementById('ais-do-subs').checked;
  const doVo   = document.getElementById('ais-do-vo').checked;

  const body = {
    source_url:   AIS.sourceType === 'url' ? document.getElementById('ais-url').value.trim() : '',
    upload_id:    AIS.sourceType === 'upload' ? AIS.uploadId : '',
    do_subtitles: doSubs,
    sub_model:    document.getElementById('ais-sub-model').value,
    sub_font:     document.getElementById('ais-sub-font').value,
    sub_size:     parseInt(document.getElementById('ais-sub-size').value),
    sub_color:    document.getElementById('ais-sub-color').value,
    sub_style:    document.querySelector('input[name="ais-sub-style"]:checked')?.value || 'shadow',
    sub_position: parseInt(document.getElementById('ais-sub-pos').value),
    do_voiceover: doVo,
    vo_script:    document.getElementById('ais-vo-script').value.trim(),
    vo_voice:     document.getElementById('ais-voice')?.value || 'jenny',
    vo_mix:       document.querySelector('input[name="ais-mix"]:checked')?.value || 'replace',
    codec:        document.getElementById('ais-codec').value,
    crf:          parseInt(document.getElementById('ais-crf').value),
  };

  const btn = document.getElementById('ais-generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="rk-spinner"></span>Generating…';

  const logBox  = document.getElementById('ais-log-box');
  const logWrap = document.getElementById('ais-log-wrap');
  logWrap.style.display = 'block';
  logBox.innerHTML = '';
  document.getElementById('ais-export-card').style.display = 'none';
  document.getElementById('ais-progress-fill').style.width = '0%';
  AIS.lastLogCount = 0;

  try {
    const res = await fetch('/api/generate/ai-studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const { job_id } = await res.json();
    AIS.jobId = job_id;
    if (AIS.pollTimer) clearInterval(AIS.pollTimer);
    AIS.pollTimer = setInterval(() => _pollAisJob(job_id), 1000);
  } catch (e) {
    _appendAisLog({ ts: '--:--:--', msg: '[ERROR] ' + e.message, level: 'err' });
    btn.disabled = false;
    btn.innerHTML = '<svg class="icon"><use href="#i-zap"/></svg> Generate';
  }
}

async function _pollAisJob(jobId) {
  try {
    const res = await fetch('/api/jobs/' + jobId);
    if (!res.ok) return;
    const job = await res.json();

    job.logs.slice(AIS.lastLogCount).forEach(_appendAisLog);
    AIS.lastLogCount = job.logs.length;
    document.getElementById('ais-progress-fill').style.width = job.progress + '%';
    document.getElementById('ais-progress-label').textContent = job.progress + '% — ' + job.status;

    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(AIS.pollTimer);
      AIS.pollTimer = null;
      const btn = document.getElementById('ais-generate-btn');
      btn.disabled = false;
      btn.innerHTML = '<svg class="icon"><use href="#i-zap"/></svg> Generate';
      if (job.status === 'completed' && job.output) {
        showExportResult(job.output, job.has_audio !== false, 'ais-export-card', 'ais-export-result');
        document.getElementById('ais-export-card').style.display = 'block';
      }
    }
  } catch { /* keep polling */ }
}

function _appendAisLog(entry) {
  const box = document.getElementById('ais-log-box');
  if (!box) return;
  const line = document.createElement('span');
  line.className = 'log-line log-' + entry.level;
  line.textContent = `[${entry.ts}] ${entry.msg}`;
  box.appendChild(line);
  box.appendChild(document.createElement('br'));
  box.scrollTop = box.scrollHeight;
}

// ── Init ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// Video Editor (VED)
// ══════════════════════════════════════════════════════════════

const VED = {
  library:      [],    // upload entries from /api/uploads
  sequence:     [],    // video clips: [{uid, uploadId, name, duration, start, end, crop_x, crop_y}]
  photoClips:   [],    // photo clips: [{uid, uploadId, name, start, end, duration}]
  audioClips:   [],    // audio clips: [{uid, uploadId, name, duration, start, end}]
  selectedClip: null,  // uid of selected clip (from either track)
  selectedTrack: 'video', // 'video' | 'photo' | 'audio'
  seqPlaying:   false,  // whether sequence auto-advance is active
  seqIdx:       0,      // index in VED.sequence currently playing
  audioIdx:     0,      // index in VED.audioClips currently playing
  dragUid:      null,
  dragTrack:    null,
  jobId:        null,
  pollTimer:    null,
  lastOutput:   null,
  _lastLogCount: 0,
  zoom:         1,      // timeline zoom multiplier
};

// ── Timeline zoom ─────────────────────────────────────────────
const _VED_ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4, 8];
const _VED_BASE_PPS    = 60; // pixels per second at zoom 1

function _vedPPS() { return _VED_BASE_PPS * (VED.zoom || 1); }

function _vedClipDur(item) {
  return Math.max(0.05, (item.end != null ? item.end : (item.duration || 0)) - (item.start || 0));
}

function vedZoom(dir) {
  const cur = VED.zoom || 1;
  const idx = _VED_ZOOM_LEVELS.reduce((best, z, i) =>
    Math.abs(z - cur) < Math.abs(_VED_ZOOM_LEVELS[best] - cur) ? i : best, 0);
  const ni  = Math.max(0, Math.min(_VED_ZOOM_LEVELS.length - 1, idx + dir));
  VED.zoom  = _VED_ZOOM_LEVELS[ni];
  const lbl = document.getElementById('ved-tl-zoom-lbl');
  if (lbl) lbl.textContent = VED.zoom + '×';
  _vedRenderRuler();
  vedRenderSequence();
  vedRenderAudioTrack();
  _vedUpdateSeekbar();
}

// ── Ruler ─────────────────────────────────────────────────────
function _vedRenderRuler() {
  const ruler = document.getElementById('ved-tl-ruler');
  if (!ruler) return;
  const pps   = _vedPPS();
  const total = Math.max(30, _vedSeqTotal() + 15);
  const w     = Math.ceil(total * pps) + 120;
  ruler.style.width = w + 'px';

  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const majorSec  = intervals.find(s => s * pps >= 55) || 300;
  const minorSec  = majorSec / 5;

  ruler.innerHTML = '';
  for (let t = 0; t <= total + majorSec; t += minorSec) {
    const isMajor = Math.abs(Math.round(t / minorSec) % 5) === 0;
    const tick = document.createElement('div');
    tick.className = 'ved-tl-tick' + (isMajor ? ' ved-tl-tick--major' : '');
    tick.style.left = (t * pps) + 'px';
    tick.style.height = isMajor ? '13px' : '6px';
    if (isMajor) {
      const span = document.createElement('span');
      span.className = 'ved-tl-tick-label';
      span.textContent = fmtTS(Math.round(t));
      tick.appendChild(span);
    }
    ruler.appendChild(tick);
  }

  const inner = document.getElementById('ved-tl-inner');
  if (inner) inner.style.width = w + 'px';
}

// ── Filmstrip thumbnails (async) ──────────────────────────────
const _vedVidCache = {};

async function _vedDrawFilmstrip(canvas, item) {
  if (!canvas || !item.uploadId) return;
  const pps    = _vedPPS();
  const clipW  = Math.max(10, _vedClipDur(item) * pps);
  const clipH  = canvas.height;
  const frameW = Math.max(20, clipH);
  const nFrames = Math.max(1, Math.ceil(clipW / frameW));
  const dur    = _vedClipDur(item);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = '#0f1f35';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!_vedVidCache[item.uploadId]) {
    const v = document.createElement('video');
    v.src  = `/api/uploads/stream/${item.uploadId}`;
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    _vedVidCache[item.uploadId] = v;
  }
  const v = _vedVidCache[item.uploadId];

  try {
    if (v.readyState < 1) {
      await new Promise((res, rej) => {
        v.addEventListener('loadedmetadata', res, { once: true });
        v.addEventListener('error', rej, { once: true });
        setTimeout(rej, 8000);
      });
    }
    for (let i = 0; i < nFrames; i++) {
      if (!document.body.contains(canvas)) return;
      v.currentTime = (item.start || 0) + (dur * i / Math.max(nFrames, 1));
      await new Promise(res => {
        v.addEventListener('seeked', res, { once: true });
        setTimeout(res, 1500);
      });
      const x = i * frameW;
      ctx.drawImage(v, x, 0, frameW, clipH);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.fillRect(x + frameW - 1, 0, 1, clipH);
    }
  } catch { /* keep dark */ }
}

// ── Library ───────────────────────────────────────────────────

async function vedLoadLibrary() {
  try {
    const res  = await fetch('/api/uploads');
    VED.library = await res.json();
  } catch (_) {
    VED.library = [];
  }
  vedRenderLibrary();
}

function vedRenderLibrary() {
  const grid = document.getElementById('ved-library');
  if (!grid) return;
  if (!VED.library.length) {
    grid.innerHTML = '<div style="font-size:.78rem;color:var(--text-3);text-align:center;padding:8px 0">No files uploaded yet</div>';
    return;
  }
  grid.innerHTML = '';
  const g = document.createElement('div');
  g.className = 'ved-lib-grid';
  VED.library.forEach(file => {
    const dur  = file.duration ? fmtTS(Math.floor(file.duration)) : '';
    const isAudio = file.is_audio || ['.mp3','.aac','.wav','.m4a','.ogg','.flac'].includes(file.ext);
    const displayName = file.name || file.original_name || file.id;
    const safeName = displayName.replace(/'/g, "\\'");
    const card = document.createElement('div');
    card.className = 'ved-lib-card';
    card.innerHTML = `
      <div class="ved-lib-thumb" id="vedthumb-${file.id}">
        ${isAudio
          ? `<svg class="icon icon-xl" style="color:var(--accent)"><use href="#i-vol"/></svg>`
          : `<video muted playsinline preload="metadata" src="/api/uploads/stream/${file.id}"
               style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
               onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>
             <svg class="icon" style="color:rgba(255,255,255,.5);position:relative;z-index:1"><use href="#i-film"/></svg>`
        }
      </div>
      <div class="ved-lib-name" title="${displayName}">${displayName}</div>
      <div class="ved-lib-meta">${file.size_mb} MB${dur ? ' · ' + dur : ''}</div>
      <div class="ved-lib-btns">
        <button class="ved-lib-btn" onclick="${isAudio ? `vedAddAudioToSeq` : `vedAddToSeq`}('${file.id}')">+ Add</button>
        <button class="ved-lib-btn ved-lib-btn-danger" onclick="vedDeleteFile('${file.id}')">×</button>
      </div>`;
    g.appendChild(card);
  });
  grid.appendChild(g);
}

async function vedDropFiles(event) {
  event.preventDefault();
  event.stopPropagation();
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) await _vedUpload(files);
}

function vedAddVideoFiles(rawList) { return _vedUpload(Array.from(rawList || [])); }
function vedAddAudioFiles(rawList) { return _vedUpload(Array.from(rawList || [])); }

async function _vedUpload(files, isPhoto = false) {
  if (!files.length) return;
  const wrap = document.getElementById('ved-uploading');
  if (wrap) wrap.style.display = 'block';

  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        _modal({ icon: 'warn', iconColor: 'danger', title: 'Upload failed',
                 msg: err.detail || 'Unknown error' });
        continue;
      }
      const data = await res.json();
      VED.library.unshift(data);
      // Auto-add to the appropriate track
      if (isPhoto) vedAddPhotoToSeq(data.id);
      else if (data.is_audio || ['.mp3','.aac','.wav','.m4a','.ogg','.flac'].includes(data.ext)) vedAddAudioToSeq(data.id);
      else vedAddToSeq(data.id);
    } catch (e) {
      _modal({ icon: 'warn', iconColor: 'danger', title: 'Upload failed', msg: e.message });
    }
  }

  ['ved-video-input','ved-audio-input','ved-photo-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  if (wrap) wrap.style.display = 'none';
}

async function vedDeleteFile(id) {
  const entry = VED.library.find(f => f.id === id);
  const name = entry?.name || id;
  if (!window.confirm(`Remove "${name}" from the library?\nThis cannot be undone.`)) return;
  await fetch(`/api/uploads/${id}`, { method: 'DELETE' }).catch(() => {});
  VED.library    = VED.library.filter(f => f.id !== id);
  VED.sequence   = VED.sequence.filter(s => s.uploadId !== id);
  VED.photoClips = VED.photoClips.filter(s => s.uploadId !== id);
  VED.audioClips = VED.audioClips.filter(s => s.uploadId !== id);
  const allClips = [...VED.sequence, ...VED.photoClips, ...VED.audioClips];
  if (VED.selectedClip && !allClips.find(s => s.uid === VED.selectedClip)) vedCloseInspector();
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
}

// ── Audio track (clip-based) ──────────────────────────────────

// ── Photo track ───────────────────────────────────────────────

const _VED_PHOTO_DEFAULT_DUR = 3; // seconds for a still image

function vedAddPhotoFiles(rawList) { return _vedUpload(Array.from(rawList || []), true); }

function vedAddPhotoToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  const newUid = Math.random().toString(36).slice(2, 8);
  const dur = entry.duration || _VED_PHOTO_DEFAULT_DUR;
  VED.photoClips.push({
    uid:      newUid,
    uploadId: entry.id,
    name:     entry.name || entry.original_name || entry.id,
    duration: dur,
    start:    0,
    end:      dur,
    is_image: true,
  });
  vedRenderPhotoTrack();
  vedSelectClip(newUid, 'photo');
}

function vedRemoveFromPhotoSeq(uid) {
  VED.photoClips = VED.photoClips.filter(c => c.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  vedRenderPhotoTrack();
}

function vedMovePhotoClip(uid, dir) {
  const idx = VED.photoClips.findIndex(c => c.uid === uid);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= VED.photoClips.length) return;
  [VED.photoClips[idx], VED.photoClips[swap]] = [VED.photoClips[swap], VED.photoClips[idx]];
  vedRenderPhotoTrack();
}

function vedRenderPhotoTrack() {
  const row = document.getElementById('ved-tl-photo-row');
  if (!row) return;
  row.innerHTML = '';

  if (!VED.photoClips.length) {
    const hint = document.createElement('span');
    hint.className = 'ved-tl-empty-hint';
    hint.textContent = 'Add photos from the library';
    row.appendChild(hint);
    return;
  }

  const pps = _vedPPS();
  let cumSec = 0;
  VED.photoClips.forEach((item, i) => {
    const dur    = _vedClipDur(item);
    const isSel  = item.uid === VED.selectedClip;
    const block  = document.createElement('div');
    block.className = 'ved-tl-clip ved-tl-clip--photo' + (isSel ? ' ved-tl-clip--sel' : '');
    block.style.cssText = `left:${cumSec * pps}px;width:${dur * pps}px`;
    block.draggable = true;

    // Show the actual image as thumbnail
    const img = document.createElement('img');
    img.src = `/api/uploads/stream/${item.uploadId}`;
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;border-radius:4px;';
    block.appendChild(img);

    const info = document.createElement('div');
    info.className = 'ved-tl-clip-info';
    info.innerHTML = `
      <div class="ved-tl-clip-info-top">
        <span class="ved-tl-clip-idx">${i + 1}</span>
        <span class="ved-tl-clip-nm">${item.name || ''}</span>
      </div>
      <div class="ved-tl-clip-info-bot">
        <span class="ved-tl-clip-dur">${fmtTS(Math.floor(dur))}</span>
      </div>`;
    block.appendChild(info);

    block.appendChild(_vedMakeTrimHandle(item, 'photo', 'l', block));
    block.appendChild(_vedMakeTrimHandle(item, 'photo', 'r', block));

    block.onclick = (e) => { e.stopPropagation(); vedSelectClip(item.uid, 'photo'); };
    block.ondragstart = (e) => {
      VED.dragUid = item.uid; VED.dragTrack = 'photo';
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => block.classList.add('ved-tl-clip--dragging'), 0);
    };
    block.ondragend = () => {
      VED.dragUid = null; VED.dragTrack = null;
      block.classList.remove('ved-tl-clip--dragging');
      document.querySelectorAll('.ved-tl-clip--drag-over')
        .forEach(el => el.classList.remove('ved-tl-clip--drag-over'));
    };
    block.ondragover = (e) => {
      if (VED.dragUid && VED.dragTrack === 'photo' && VED.dragUid !== item.uid) {
        e.preventDefault(); block.classList.add('ved-tl-clip--drag-over');
      }
    };
    block.ondragleave = () => block.classList.remove('ved-tl-clip--drag-over');
    block.ondrop = (e) => {
      e.preventDefault(); block.classList.remove('ved-tl-clip--drag-over');
      if (!VED.dragUid || VED.dragTrack !== 'photo' || VED.dragUid === item.uid) return;
      const fi = VED.photoClips.findIndex(c => c.uid === VED.dragUid);
      const ti = VED.photoClips.findIndex(c => c.uid === item.uid);
      if (fi < 0 || ti < 0) return;
      const [moved] = VED.photoClips.splice(fi, 1);
      VED.photoClips.splice(ti, 0, moved);
      vedRenderPhotoTrack();
    };
    row.appendChild(block);
    cumSec += dur;
  });
}

// ── Audio track (clip-based) ──────────────────────────────────

function vedAddAudioToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  const newUid = Math.random().toString(36).slice(2, 8);
  VED.audioClips.push({
    uid:      newUid,
    uploadId: entry.id,
    name:     entry.name || entry.original_name || entry.id,
    duration: entry.duration,
    start:    0,
    end:      entry.duration || null,
  });
  vedRenderAudioTrack();
  vedSelectClip(newUid, 'audio');
}

function vedRemoveFromAudioSeq(uid) {
  VED.audioClips = VED.audioClips.filter(s => s.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  vedRenderAudioTrack();
}

function vedMoveAudioClip(uid, dir) {
  const idx = VED.audioClips.findIndex(s => s.uid === uid);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= VED.audioClips.length) return;
  [VED.audioClips[idx], VED.audioClips[swap]] = [VED.audioClips[swap], VED.audioClips[idx]];
  vedRenderAudioTrack();
}

function vedRenderAudioTrack() {
  const row = document.getElementById('ved-tl-audio-row');
  if (!row) return;

  row.innerHTML = '';

  if (!VED.audioClips.length) {
    const hint = document.createElement('span');
    hint.className = 'ved-tl-empty-hint';
    hint.textContent = 'Add audio from the library';
    row.appendChild(hint);
    return;
  }

  const pps = _vedPPS();
  let cumSec = 0;
  VED.audioClips.forEach((item, i) => {
    const dur       = _vedClipDur(item);
    const isSel     = item.uid === VED.selectedClip;
    const isPlaying = VED.seqPlaying && i === VED.audioIdx;
    const leftPx    = cumSec * pps;
    const widPx     = dur * pps;

    const block = document.createElement('div');
    block.className = 'ved-tl-clip ved-tl-clip--audio'
      + (isSel ? ' ved-tl-clip--sel' : '')
      + (isPlaying ? ' ved-tl-clip--playing' : '');
    block.style.cssText = `left:${leftPx}px;width:${widPx}px`;
    block.draggable = true;

    const info = document.createElement('div');
    info.className = 'ved-tl-clip-info';
    info.innerHTML = `
      <div class="ved-tl-clip-info-top">
        <span class="ved-tl-clip-idx">${i + 1}</span>
        <span class="ved-tl-clip-nm">${item.name || ''}</span>
      </div>
      <div class="ved-tl-clip-info-bot">
        <span class="ved-tl-clip-dur">${fmtTS(Math.floor(dur))}</span>
      </div>`;
    block.appendChild(info);

    block.appendChild(_vedMakeTrimHandle(item, 'audio', 'l', block));
    block.appendChild(_vedMakeTrimHandle(item, 'audio', 'r', block));

    block.onclick = (e) => { e.stopPropagation(); vedSelectClip(item.uid, 'audio'); };
    block.ondragstart = (e) => {
      VED.dragUid = item.uid; VED.dragTrack = 'audio';
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => block.classList.add('ved-tl-clip--dragging'), 0);
    };
    block.ondragend = () => {
      VED.dragUid = null; VED.dragTrack = null;
      block.classList.remove('ved-tl-clip--dragging');
      document.querySelectorAll('.ved-tl-clip--drag-over')
        .forEach(el => el.classList.remove('ved-tl-clip--drag-over'));
    };
    block.ondragover = (e) => {
      if (VED.dragUid && VED.dragTrack === 'audio' && VED.dragUid !== item.uid) {
        e.preventDefault(); block.classList.add('ved-tl-clip--drag-over');
      }
    };
    block.ondragleave = () => block.classList.remove('ved-tl-clip--drag-over');
    block.ondrop = (e) => {
      e.preventDefault(); block.classList.remove('ved-tl-clip--drag-over');
      if (!VED.dragUid || VED.dragTrack !== 'audio' || VED.dragUid === item.uid) return;
      const fi = VED.audioClips.findIndex(s => s.uid === VED.dragUid);
      const ti = VED.audioClips.findIndex(s => s.uid === item.uid);
      if (fi < 0 || ti < 0) return;
      const [moved] = VED.audioClips.splice(fi, 1);
      VED.audioClips.splice(ti, 0, moved);
      vedRenderAudioTrack();
    };
    row.appendChild(block);
    cumSec += dur;
  });
}

// ── Sequence ──────────────────────────────────────────────────

function vedAddToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  const newUid = Math.random().toString(36).slice(2, 8);
  VED.sequence.push({
    uid:      newUid,
    uploadId: entry.id,
    name:     entry.name || entry.original_name || entry.id,
    duration: entry.duration,
    start:    0,
    end:      entry.duration || null,
    crop_x:   0.5,
    crop_y:   0.5,
  });
  vedRenderSequence();
  vedSelectClip(newUid);
}

function vedRemoveFromSeq(uid) {
  VED.sequence = VED.sequence.filter(s => s.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  vedRenderSequence();
}

function vedMoveSeq(uid, dir) {
  const idx = VED.sequence.findIndex(s => s.uid === uid);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= VED.sequence.length) return;
  [VED.sequence[idx], VED.sequence[swap]] = [VED.sequence[swap], VED.sequence[idx]];
  vedRenderSequence();
}

function vedSyncTrim(uid, field, value) {
  const item = VED.sequence.find(s => s.uid === uid) || VED.photoClips.find(s => s.uid === uid) || VED.audioClips.find(s => s.uid === uid);
  if (!item) return;
  const secs = _parseTS(value);
  if (!isNaN(secs)) item[field] = secs;
}

function vedSyncVal(uid, field, value) {
  const item = VED.sequence.find(s => s.uid === uid) || VED.photoClips.find(s => s.uid === uid) || VED.audioClips.find(s => s.uid === uid);
  if (item) item[field] = value;
}

function _parseTS(str) {
  str = (str || '').trim();
  if (!str) return NaN;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function _vedMakeTrimHandle(item, track, side, block) {
  const handle = document.createElement('div');
  handle.className = `ved-tl-clip-handle ved-tl-clip-handle-${side}`;
  const bar = document.createElement('div');
  bar.className = 'ved-tl-clip-handle-bar';
  handle.appendChild(bar);

  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    vedSelectClip(item.uid, track);

    const startX    = e.pageX;
    const initLeft  = parseFloat(block.style.left) || 0;
    const initStart = item.start || 0;
    const initTime  = side === 'l' ? initStart : (item.end != null ? item.end : (item.duration || 9999));

    const onMove = (ev) => {
      const pps   = _vedPPS();
      const delta = (ev.pageX - startX) / pps;
      if (side === 'l') {
        const maxIn  = (item.end != null ? item.end : (item.duration || 9999)) - 0.1;
        item.start   = Math.max(0, Math.min(maxIn, initTime + delta));
        const leftDelta = (item.start - initStart) * pps;
        block.style.left  = (initLeft + leftDelta) + 'px';
        block.style.width = (_vedClipDur(item) * pps) + 'px';
      } else {
        item.end   = Math.max((item.start || 0) + 0.1,
                              Math.min(item.duration || 9999, initTime + delta));
        block.style.width = (_vedClipDur(item) * pps) + 'px';
      }
      vedRenderInspector();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (track === 'video') vedRenderSequence();
      else vedRenderAudioTrack();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  return handle;
}

function vedRenderSequence() {
  const list   = document.getElementById('ved-sequence-list');
  const btn    = document.getElementById('ved-render-btn');
  const status = document.getElementById('ved-ready-status');
  if (!list) return;

  const pps = _vedPPS();
  const n   = VED.sequence.length;
  list.innerHTML = '';

  if (n === 0) {
    const hint = document.createElement('span');
    hint.className = 'ved-tl-empty-hint';
    hint.textContent = 'Add video clips from the library';
    list.appendChild(hint);
  } else {
    let cumSec = 0;
    VED.sequence.forEach((item, i) => {
      const dur    = _vedClipDur(item);
      const isSel  = item.uid === VED.selectedClip;
      const leftPx = cumSec * pps;
      const widPx  = dur * pps;

      const block = document.createElement('div');
      block.className = 'ved-tl-clip' + (isSel ? ' ved-tl-clip--sel' : '');
      block.style.cssText = `left:${leftPx}px;width:${widPx}px`;
      block.draggable = true;

      // Canvas for filmstrip (filled async)
      const canvas = document.createElement('canvas');
      canvas.width  = Math.ceil(widPx);
      canvas.height = 56;
      block.appendChild(canvas);
      _vedDrawFilmstrip(canvas, item);

      // Overlay text
      const info = document.createElement('div');
      info.className = 'ved-tl-clip-info';
      info.innerHTML = `
        <div class="ved-tl-clip-info-top">
          <span class="ved-tl-clip-idx">${i + 1}</span>
          <span class="ved-tl-clip-nm">${item.name || ''}</span>
        </div>
        <div class="ved-tl-clip-info-bot">
          <span class="ved-tl-clip-dur">${fmtTS(Math.floor(dur))}</span>
        </div>`;
      block.appendChild(info);

      block.appendChild(_vedMakeTrimHandle(item, 'video', 'l', block));
      block.appendChild(_vedMakeTrimHandle(item, 'video', 'r', block));

      block.onclick = (e) => { e.stopPropagation(); vedSelectClip(item.uid, 'video'); };
      block.ondragstart = (e) => {
        VED.dragUid = item.uid; VED.dragTrack = 'video';
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => block.classList.add('ved-tl-clip--dragging'), 0);
      };
      block.ondragend = () => {
        VED.dragUid = null; VED.dragTrack = null;
        block.classList.remove('ved-tl-clip--dragging');
        document.querySelectorAll('.ved-tl-clip--drag-over')
          .forEach(el => el.classList.remove('ved-tl-clip--drag-over'));
      };
      block.ondragover = (e) => {
        if (VED.dragUid && VED.dragTrack === 'video' && VED.dragUid !== item.uid) {
          e.preventDefault(); block.classList.add('ved-tl-clip--drag-over');
        }
      };
      block.ondragleave = () => block.classList.remove('ved-tl-clip--drag-over');
      block.ondrop = (e) => {
        e.preventDefault(); block.classList.remove('ved-tl-clip--drag-over');
        if (!VED.dragUid || VED.dragUid === item.uid) return;
        const fi = VED.sequence.findIndex(s => s.uid === VED.dragUid);
        const ti = VED.sequence.findIndex(s => s.uid === item.uid);
        if (fi < 0 || ti < 0) return;
        const [moved] = VED.sequence.splice(fi, 1);
        VED.sequence.splice(ti, 0, moved);
        vedRenderSequence();
      };
      list.appendChild(block);
      cumSec += dur;
    });
  }

  // Status + render button
  if (n === 0) {
    if (status) { status.className = 'status-missing'; status.innerHTML = '<svg class="icon icon-sm"><use href="#i-warn"/></svg> Add at least one clip'; }
    if (btn) btn.disabled = true;
  } else {
    const totalSec = VED.sequence.reduce((a, s) => a + _vedClipDur(s), 0);
    if (status) { status.className = 'status-ready'; status.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> ${n} clip${n>1?'s':''} · ~${fmtTS(Math.floor(totalSec))}`; }
    if (btn) btn.disabled = false;
  }

  _vedRenderRuler();
  _vedUpdateSeekbar();
  vedRenderInspector();
}

// ── Clip inspector ────────────────────────────────────────────

function vedSelectClip(uid, track) {
  VED.seqPlaying    = false;
  VED.selectedClip  = uid;
  VED.selectedTrack = track || (
    VED.audioClips.find(s => s.uid === uid)  ? 'audio' :
    VED.photoClips.find(s => s.uid === uid)  ? 'photo' : 'video'
  );
  const idx = VED.sequence.findIndex(s => s.uid === uid);
  if (idx >= 0) VED.seqIdx = idx;
  vedPreviewClip(uid);
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
}

function vedCloseInspector() {
  VED.selectedClip  = null;
  VED.selectedTrack = 'video';
  vedPreviewClip(null);
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
  vedRenderInspector();
}

// ── Preview playback ──────────────────────────────────────────

function vedPreviewClip(uid) {
  const video       = document.getElementById('ved-preview-video');
  const placeholder = document.getElementById('ved-canvas-placeholder');
  if (!video) return;

  const item = VED.sequence.find(s => s.uid === uid) || VED.photoClips.find(s => s.uid === uid) || VED.audioClips.find(s => s.uid === uid);
  if (!item) {
    video.pause();
    video.style.display = 'none';
    const hint = document.getElementById('ved-canvas-hint');
    if (placeholder) {
      placeholder.style.display = 'flex';
      const hasClips = VED.sequence.length > 0 || VED.audioClips.length > 0;
      if (hint) hint.textContent = hasClips ? 'Click a clip to preview' : 'Add media to get started';
    }
    _vedSetPlayIcon(false);
    return;
  }

  const src = `/api/uploads/stream/${item.uploadId}`;
  video.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';

  if (video.dataset.src !== src) {
    video.dataset.src = src;
    video.src = src;
    const startAt = item.start || 0;
    if (startAt > 0) {
      const seekOnce = () => { video.currentTime = startAt; video.removeEventListener('loadedmetadata', seekOnce); };
      video.addEventListener('loadedmetadata', seekOnce);
    }
  }
  _vedSetPlayIcon(!video.paused);
}

// ── Sequence playback ─────────────────────────────────────────

let _vedAdvancing = false;

function _vedSeqTotal() {
  return VED.sequence.reduce((t, s) =>
    t + Math.max(0, (s.end != null ? s.end : (s.duration || 0)) - (s.start || 0)), 0);
}

function _vedSeqElapsed() {
  const video = document.getElementById('ved-preview-video');
  if (!video || !VED.sequence.length) return 0;
  let e = 0;
  for (let i = 0; i < VED.sequence.length; i++) {
    const s = VED.sequence[i];
    const dur = Math.max(0, (s.end != null ? s.end : (s.duration || 0)) - (s.start || 0));
    if (i < VED.seqIdx) { e += dur; continue; }
    if (i === VED.seqIdx) { e += Math.max(0, video.currentTime - (s.start || 0)); break; }
  }
  return e;
}

function _vedUpdateSeekbar() {
  const playhead = document.getElementById('ved-tl-playhead');
  const curEl    = document.getElementById('ved-tl-cur');
  const totEl    = document.getElementById('ved-tl-total');
  const pps      = _vedPPS();
  const elapsed  = _vedSeqElapsed();
  const total    = _vedSeqTotal();
  if (playhead) playhead.style.left = (elapsed * pps) + 'px';
  if (curEl)    curEl.textContent   = fmtTS(Math.floor(elapsed));
  if (totEl)    totEl.textContent   = fmtTS(Math.floor(total));
  // Auto-scroll to keep playhead visible during playback
  if (VED.seqPlaying) {
    const scroll = document.getElementById('ved-tl-scroll');
    if (scroll) {
      const x = elapsed * pps;
      const { scrollLeft, clientWidth } = scroll;
      if (x > scrollLeft + clientWidth - 80 || x < scrollLeft + 20) {
        scroll.scrollLeft = Math.max(0, x - clientWidth / 3);
      }
    }
  }
}

function _vedLoadClipAndRun(idx, onReady) {
  const item  = VED.sequence[idx];
  const video = document.getElementById('ved-preview-video');
  if (!item || !video) return;
  VED.seqIdx        = idx;
  VED.selectedClip  = item.uid;
  VED.selectedTrack = 'video';
  const src     = `/api/uploads/stream/${item.uploadId}`;
  const startAt = item.start || 0;
  video.style.display = 'block';
  const placeholder = document.getElementById('ved-canvas-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  const _seekAndRun = () => {
    if (Math.abs((video.currentTime || 0) - startAt) < 0.05) {
      onReady();
    } else {
      video.addEventListener('seeked', function once() {
        video.removeEventListener('seeked', once);
        onReady();
      });
      video.currentTime = startAt;
    }
  };

  if (video.dataset.src !== src) {
    video.dataset.src = src;
    video.src = src;
    video.addEventListener('loadedmetadata', function once() {
      video.removeEventListener('loadedmetadata', once);
      _seekAndRun();
    });
  } else {
    _seekAndRun();
  }
}

// ── Audio track preview playback ──────────────────────────────

let _audAdvancing = false;

function _vedLoadAudioClipAndRun(idx, onReady) {
  const item  = VED.audioClips[idx];
  const audio = document.getElementById('ved-preview-audio');
  if (!item || !audio) return;
  VED.audioIdx  = idx;
  const src     = `/api/uploads/stream/${item.uploadId}`;
  const startAt = item.start || 0;

  const _seekAudio = () => {
    if (Math.abs((audio.currentTime || 0) - startAt) < 0.05) {
      onReady();
    } else {
      audio.addEventListener('seeked', function once() {
        audio.removeEventListener('seeked', once);
        onReady();
      });
      audio.currentTime = startAt;
    }
  };

  if (audio.dataset.src !== src) {
    audio.dataset.src = src;
    audio.src = src;
    audio.addEventListener('loadedmetadata', function once() {
      audio.removeEventListener('loadedmetadata', once);
      _seekAudio();
    });
  } else {
    _seekAudio();
  }
}

function _vedStartAudioSeq() {
  if (!VED.audioClips.length) return;
  _audAdvancing = false;
  VED.audioIdx  = 0;
  _vedLoadAudioClipAndRun(0, () => {
    document.getElementById('ved-preview-audio')?.play().catch(() => {});
    vedRenderAudioTrack();
  });
}

function vedPreviewAudioEnded() {
  if (!VED.seqPlaying || _audAdvancing) return;
  const next = VED.audioIdx + 1;
  if (next >= VED.audioClips.length) return;
  _audAdvancing = true;
  _vedLoadAudioClipAndRun(next, () => {
    _audAdvancing = false;
    document.getElementById('ved-preview-audio')?.play().catch(() => {});
    vedRenderAudioTrack();
  });
}

// ── Video sequence playback ────────────────────────────────────

function vedPlaySeq(startIdx) {
  if (!VED.sequence.length) return;
  startIdx = Math.max(0, Math.min(startIdx ?? 0, VED.sequence.length - 1));
  VED.seqPlaying = true;
  _vedAdvancing  = false;
  _vedLoadClipAndRun(startIdx, () => {
    const video = document.getElementById('ved-preview-video');
    video?.play().catch(() => {});
    _vedSetPlayIcon(true);
    _vedStartAudioSeq();
    vedRenderSequence();
    vedRenderInspector();
  });
}

function vedAdvanceSeq() {
  if (_vedAdvancing) return;
  const next = VED.seqIdx + 1;
  if (next >= VED.sequence.length) {
    VED.seqPlaying = false;
    _vedAdvancing  = false;
    document.getElementById('ved-preview-audio')?.pause();
    _vedSetPlayIcon(false);
    vedRenderSequence();
    vedRenderAudioTrack();
    vedRenderInspector();
    return;
  }
  _vedAdvancing = true;
  _vedLoadClipAndRun(next, () => {
    _vedAdvancing = false;
    const video = document.getElementById('ved-preview-video');
    video?.play().catch(() => {});
    _vedSetPlayIcon(true);
    vedRenderSequence();
    vedRenderInspector();
  });
}

function vedPreviewTimeUpdate() {
  const video = document.getElementById('ved-preview-video');
  if (!video) return;
  _vedUpdateSeekbar();

  if (VED.seqPlaying && !_vedAdvancing && !video.paused && !video.seeking) {
    const item = VED.sequence[VED.seqIdx];
    if (item && item.end != null && video.currentTime >= item.end - 0.05) {
      vedAdvanceSeq();
    }
  }
}

function vedPreviewEnded() {
  if (VED.seqPlaying) {
    vedAdvanceSeq();
  } else {
    _vedSetPlayIcon(false);
  }
}

function vedTlPlayPause() {
  const video = document.getElementById('ved-preview-video');
  const audio = document.getElementById('ved-preview-audio');
  if (!video) return;
  if (!video.paused) {
    video.pause();
    audio?.pause();
    _vedSetPlayIcon(false);
    // seqPlaying stays true — pressing play again will resume
    return;
  }
  if (!VED.sequence.length) return;
  if (VED.seqPlaying) {
    video.play().catch(() => {});
    audio?.play().catch(() => {});
    _vedSetPlayIcon(true);
  } else {
    vedPlaySeq(0);
  }
}

function vedTlSeek(secs) {
  const video = document.getElementById('ved-preview-video');
  if (!video || !video.dataset.src) return;
  const item  = VED.sequence.find(s => s.uid === VED.selectedClip)
             || VED.audioClips.find(s => s.uid === VED.selectedClip);
  const minT  = item?.start ?? 0;
  const maxT  = item?.end   ?? (video.duration || 9999);
  video.currentTime = Math.max(minT, Math.min(maxT, video.currentTime + secs));
  _vedUpdateSeekbar();
}

function vedTlPointerDown(e) {
  // Ignore clicks that land on a clip — those are handled by the clip's onclick
  if (e.target.closest('.ved-tl-clip')) return;
  if (!VED.sequence.length) return;

  const _doSeek = (ev) => {
    const inner = document.getElementById('ved-tl-inner');
    if (!inner) return;
    const rect   = inner.getBoundingClientRect();
    const target = Math.max(0, (ev.clientX - rect.left) / _vedPPS());
    let elapsed = 0;
    for (let i = 0; i < VED.sequence.length; i++) {
      const item = VED.sequence[i];
      const dur  = _vedClipDur(item);
      if (target <= elapsed + dur || i === VED.sequence.length - 1) {
        const offset  = Math.min(target - elapsed, dur);
        const seekTo  = (item.start || 0) + offset;
        const wasPlay = !document.getElementById('ved-preview-video')?.paused && VED.seqPlaying;
        VED.seqPlaying = wasPlay;
        _vedLoadClipAndRun(i, () => {
          const v = document.getElementById('ved-preview-video');
          if (v) v.currentTime = seekTo;
          if (wasPlay) v?.play().catch(() => {});
          _vedSetPlayIcon(wasPlay);
          _vedUpdateSeekbar();
          vedRenderSequence();
          vedRenderInspector();
        });
        break;
      }
      elapsed += dur;
    }
  };

  const onUp = () => {
    document.removeEventListener('mousemove', _doSeek);
    document.removeEventListener('mouseup',   onUp);
  };
  document.addEventListener('mousemove', _doSeek);
  document.addEventListener('mouseup',   onUp);
  _doSeek(e);
}

function _vedSetPlayIcon(playing) {
  const icon = document.getElementById('ved-tl-play-icon');
  if (!icon) return;
  icon.innerHTML = playing ? '<use href="#i-pause"/>' : '<use href="#i-play"/>';
}

function vedRenderInspector() {
  const body  = document.getElementById('ved-inspector-body');
  const title = document.getElementById('ved-inspector-title');
  if (!body) return;

  const track = VED.selectedTrack;
  const arr   = track === 'audio' ? VED.audioClips
              : track === 'photo' ? VED.photoClips
              : VED.sequence;
  const item = arr.find(s => s.uid === VED.selectedClip);

  if (!item) {
    if (title) title.textContent = 'Properties';
    body.innerHTML = `
      <div class="ved-insp-empty">
        <svg class="icon icon-lg" style="color:var(--text-3)"><use href="#i-film"/></svg>
        <div>Select a clip<br>to edit its properties</div>
      </div>`;
    return;
  }

  const i = arr.indexOf(item);
  const n = arr.length;
  if (title) title.textContent = `${track === 'audio' ? 'Audio ' : track === 'photo' ? 'Photo ' : ''}Clip ${i + 1} of ${n}`;

  const reRenderFn = track === 'audio' ? 'vedRenderAudioTrack()' : track === 'photo' ? 'vedRenderPhotoTrack()' : 'vedRenderSequence()';
  const removeFn   = track === 'audio' ? 'vedRemoveFromAudioSeq' : track === 'photo' ? 'vedRemoveFromPhotoSeq' : 'vedRemoveFromSeq';
  const moveFn     = track === 'audio' ? 'vedMoveAudioClip'      : track === 'photo' ? 'vedMovePhotoClip'      : 'vedMoveSeq';
  const trackIcon  = track === 'audio' ? '#i-vol' : track === 'photo' ? '#i-img' : '#i-film';
  const isAudioClip = track === 'audio';

  const startVal = item.start || 0;
  const maxDur   = item.duration || 100;
  const endVal   = item.end != null ? item.end : maxDur;
  const cropX    = item.crop_x ?? 0.5;
  const cropY    = item.crop_y ?? 0.5;

  const cropSection = isAudioClip ? '' : `
    <div class="ved-insp-row" style="flex-direction:column;gap:6px;margin-top:4px">
      <div class="ved-insp-field">
        <label class="ved-insp-lbl">Crop X (pan left/right) — <span id="insp-cx-lbl">${Math.round(cropX*100)}%</span></label>
        <input type="range" class="ved-insp-range" min="0" max="1" step="0.01" value="${cropX}"
          oninput="vedSyncVal('${item.uid}','crop_x',+this.value);document.getElementById('insp-cx-lbl').textContent=Math.round(+this.value*100)+'%'">
      </div>
      <div class="ved-insp-field">
        <label class="ved-insp-lbl">Crop Y (pan up/down) — <span id="insp-cy-lbl">${Math.round(cropY*100)}%</span></label>
        <input type="range" class="ved-insp-range" min="0" max="1" step="0.01" value="${cropY}"
          oninput="vedSyncVal('${item.uid}','crop_y',+this.value);document.getElementById('insp-cy-lbl').textContent=Math.round(+this.value*100)+'%'">
      </div>
    </div>`;

  body.innerHTML = `
    <div class="ved-insp-track-tag">
      <svg class="icon icon-sm"><use href="${trackIcon}"/></svg>
      ${isAudioClip ? 'Audio track' : 'Video track'}
    </div>
    <div class="ved-insp-name" title="${item.name || ''}">${item.name || item.uploadId}</div>
    <div class="ved-insp-row" style="flex-direction:column;gap:6px">
      <div class="ved-insp-field">
        <label class="ved-insp-lbl">Trim In — <span id="insp-in-lbl">${fmtTS(startVal)}</span></label>
        <input type="range" class="ved-insp-range" min="0" max="${Math.max(0, endVal - 0.1).toFixed(1)}" step="0.1" value="${startVal}"
          oninput="vedSyncVal('${item.uid}','start',+this.value);document.getElementById('insp-in-lbl').textContent=fmtTS(+this.value);${reRenderFn}">
      </div>
      <div class="ved-insp-field">
        <label class="ved-insp-lbl">Trim Out — <span id="insp-out-lbl">${fmtTS(endVal)}</span></label>
        <input type="range" class="ved-insp-range" min="${(startVal + 0.1).toFixed(1)}" max="${maxDur.toFixed(1)}" step="0.1" value="${endVal}"
          oninput="vedSyncVal('${item.uid}','end',+this.value);document.getElementById('insp-out-lbl').textContent=fmtTS(+this.value);${reRenderFn}">
      </div>
    </div>
    ${cropSection}
    <div class="ved-insp-dur-hint" style="margin-top:8px">Full clip: ${item.duration ? fmtTS(item.duration) : '—'}</div>
    <div class="ved-insp-actions">
      <button class="btn-icon" title="Move left" onclick="${moveFn}('${item.uid}',-1)" ${i === 0 ? 'disabled' : ''}>
        <svg class="icon icon-sm" style="transform:rotate(90deg)"><use href="#i-dl"/></svg>
      </button>
      <button class="btn-icon" title="Move right" onclick="${moveFn}('${item.uid}',1)" ${i === n-1 ? 'disabled' : ''}>
        <svg class="icon icon-sm" style="transform:rotate(-90deg)"><use href="#i-dl"/></svg>
      </button>
      <button class="btn-icon" title="Remove from timeline" onclick="${removeFn}('${item.uid}')">
        <svg class="icon icon-sm" style="color:var(--danger)"><use href="#i-trash"/></svg>
      </button>
    </div>`;
}

// ── Render ────────────────────────────────────────────────────

async function vedRender() {
  if (!VED.sequence.length) return;
  document.getElementById('ved-render-btn').disabled = true;
  const logBox = document.getElementById('ved-log-box');
  logBox.innerHTML = '';
  logBox.style.display = 'block';
  document.getElementById('ved-progress-wrap').style.display = 'block';
  _vedSetProgress(0, 'Starting…');
  document.getElementById('ved-export-card').style.display = 'none';
  VED.lastOutput = null;

  try {
    const resolution = document.getElementById('ved-resolution').value;
    const codec      = document.getElementById('ved-codec').value;
    const fit        = document.getElementById('ved-fit').value;

    const payload = {
      sequence: VED.sequence.map(s => ({
        upload_id: s.uploadId,
        start:     s.start  || 0,
        end:       s.end    || null,
        crop_x:    s.crop_x ?? 0.5,
        crop_y:    s.crop_y ?? 0.5,
      })),
      photo_clips: VED.photoClips.map(p => ({
        upload_id: p.uploadId,
        start:     p.start || 0,
        end:       p.end   || _VED_PHOTO_DEFAULT_DUR,
        is_image:  true,
      })),
      audio_clips: VED.audioClips.map(c => ({
        upload_id: c.uploadId,
        start:     c.start  || 0,
        end:       c.end    || null,
      })),
      resolution, codec, fit,
    };

    const res = await fetch('/api/edit/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Server error');
    }
    const { job_id } = await res.json();
    VED.jobId = job_id;
    VED._lastLogCount = 0;
    VED.pollTimer = setInterval(() => _vedPollJob(job_id), 1000);
  } catch (e) {
    _vedAppendLog({ ts: '--:--:--', msg: '[ERROR] ' + e.message, level: 'err' });
    document.getElementById('ved-render-btn').disabled = false;
  }
}

async function _vedPollJob(jobId) {
  try {
    const res  = await fetch(`/api/jobs/${jobId}`);
    const data = await res.json();

    _vedSetProgress(data.progress || 0, data.status);

    const logs = data.logs || [];
    while (VED._lastLogCount < logs.length) {
      _vedAppendLog(logs[VED._lastLogCount++]);
    }

    if (data.status === 'completed') {
      clearInterval(VED.pollTimer);
      VED.lastOutput = data.output;
      const card = document.getElementById('ved-export-card');
      const link = document.getElementById('ved-download-link');
      if (card) card.style.display = 'flex';
      document.getElementById('ved-export-name').textContent = data.output || '';
      if (link && data.output) {
        link.href     = '/api/download/' + encodeURIComponent(data.output);
        link.download = data.output;
      }
      document.getElementById('ved-render-btn').disabled = false;
      _vedSetProgress(100, 'Done');
    } else if (data.status === 'failed') {
      clearInterval(VED.pollTimer);
      document.getElementById('ved-render-btn').disabled = false;
    }
  } catch (_) {}
}

VED._lastLogCount = 0;

function _vedSetProgress(pct, label) {
  const fill  = document.getElementById('ved-progress-fill');
  const lbl   = document.getElementById('ved-progress-label');
  if (fill) fill.style.width = pct + '%';
  if (lbl)  lbl.textContent  = label;
}

function _vedAppendLog(entry) {
  const box = document.getElementById('ved-log-box');
  if (!box) return;
  const line = document.createElement('span');
  line.className = entry.level === 'err' ? 'log-err' : entry.level === 'ok' ? 'log-ok' : 'log-inf';
  line.textContent = `[${entry.ts}] ${entry.msg}`;
  box.appendChild(line);
  box.appendChild(document.createElement('br'));
  box.scrollTop = box.scrollHeight;
}

function vedDownload() {
  if (!VED.lastOutput) return;
  const suggested = VED.lastOutput.replace(/^short_edit_\d{8}_\d{6}/, 'my_edit') || VED.lastOutput;
  _modal({
    icon: 'dl', iconColor: 'info',
    title: 'Save as…',
    msg: 'Choose a filename for the download:',
    input: { label: 'Filename', value: suggested },
    confirm: 'Download', cancel: 'Cancel',
    onConfirm: (name) => {
      if (!name.trim()) name = VED.lastOutput;
      _triggerDownload(VED.lastOutput, name.trim());
    },
  });
}

// ── Upload stream endpoint (for video preview in library) ──────
// served by /api/uploads/stream/<id> — needs server endpoint added

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('sidebar--collapsed');
  localStorage.setItem('sf-sidebar-collapsed', collapsed ? '1' : '');
}

// Sync accent color UI in profile page (swatches + picker)
function syncAccentUI(color) {
  const c = (color || '').toUpperCase();
  document.querySelectorAll('.accent-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color.toUpperCase() === c);
  });
  const picker = document.getElementById('profile-accent-picker');
  if (picker && picker.value.toUpperCase() !== c) picker.value = color;
  const sidebarPicker = document.getElementById('accent-picker');
  if (sidebarPicker && sidebarPicker.value.toUpperCase() !== c) sidebarPicker.value = color;
}

// Sync profile theme buttons with current base
function _syncProfileTheme(base) {
  const dark  = document.getElementById('prof-btn-dark');
  const light = document.getElementById('prof-btn-light');
  if (dark)  dark.classList.toggle('active', base === 'dark');
  if (light) light.classList.toggle('active', base === 'light');
}

// Sidebar drag resize
function _initSidebarResize() {
  const handle  = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const w = Math.max(160, Math.min(340, startW + e2.clientX - startX));
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// Editor timeline drag resize (drag up to expand)
function _initTimelineResize() {
  const handle   = document.getElementById('ved-tl-resize-handle');
  const timeline = document.getElementById('ved-timeline');
  if (!handle || !timeline) return;
  let startY, startH;
  handle.addEventListener('mousedown', e => {
    startY = e.clientY;
    startH = timeline.getBoundingClientRect().height;
    handle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const h = Math.max(140, Math.min(480, startH - (e2.clientY - startY)));
      timeline.style.height = h + 'px';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// Editor properties panel drag resize
function _initPropsResize() {
  const handle = document.getElementById('ved-props-resize-handle');
  const panel  = document.querySelector('.ved-side-panel');
  if (!handle || !panel) return;
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const w = Math.max(200, Math.min(420, startW - (e2.clientX - startX)));
      panel.style.width = w + 'px';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Restore theme
  const savedBase   = localStorage.getItem('sf-theme-base')   || 'dark';
  const savedAccent = localStorage.getItem('sf-theme-accent')  || '#3B82F6';
  setBase(savedBase);
  const picker = document.getElementById('accent-picker');
  if (picker) { picker.value = savedAccent; setAccent(savedAccent); }
  const profPicker = document.getElementById('profile-accent-picker');
  if (profPicker) profPicker.value = savedAccent;
  syncAccentUI(savedAccent);

  // Restore sidebar collapsed state
  if (localStorage.getItem('sf-sidebar-collapsed')) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('sidebar--collapsed');
  }

  // Init resize handles
  _initSidebarResize();
  _initTimelineResize();
  _initPropsResize();

  // Restore page from URL hash (back/forward support)
  const hashPage = location.hash.slice(1);
  const startPage = _VALID_PAGES.has(hashPage) ? hashPage : 'templates';
  history.replaceState({ page: startPage }, '', '#' + startPage);
  showPage(startPage, true);

  checkAuth().then(loadProfile);
  onTemplateChange();
  renderClips();
  checkReady();
  initTimelineSlider(0);
  vedRenderPhotoTrack();
  vedRenderAudioTrack();
  vedRenderInspector();

  // Close app modal on Escape; Backspace/Delete to remove selected timeline clip
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _sfModalClose();
    if ((e.key === 'Backspace' || e.key === 'Delete') && VED.selectedClip) {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if      (VED.selectedTrack === 'audio') vedRemoveFromAudioSeq(VED.selectedClip);
      else if (VED.selectedTrack === 'photo') vedRemoveFromPhotoSeq(VED.selectedClip);
      else                                    vedRemoveFromSeq(VED.selectedClip);
    }
  });
})();

// ── Dashboard inline workspace ────────────────────────────────

const DASH = {
  template: null,
  primaryUploadId: null,
  primaryUrl: '',
  bgTemplate: '',
  clips: [],
  rkItems: [],
  jobId: null,
};

const _TMPL_NAMES = { cs: 'Clip Studio', split: 'Splitscreen', ai: 'AI Studio', rk: 'Ranking' };

function dashSelectTemplate(name) {
  const pg = document.getElementById('page-templates');
  if (!pg) return;

  if (DASH.template !== name) {
    DASH.primaryUploadId = null; DASH.primaryUrl = ''; DASH.bgTemplate = '';
    DASH.clips = []; DASH.rkItems = [];
    if (typeof DCS !== 'undefined') { DCS.clips = []; DCS.uploadId = null; DCS.primaryUrl = ''; }
    const cl = document.getElementById('ds-clip-list');  if (cl) cl.innerHTML = '';
    const dc = document.getElementById('dcs-clip-list'); if (dc) dc.innerHTML = '';
    const rk = document.getElementById('drk-item-list'); if (rk) rk.innerHTML = '';
  }
  DASH.template = name;

  // CSS class drives visibility — no style.display juggling
  pg.classList.add('tmpl-ws-open');

  const titleEl = document.getElementById('tmpl-ws-title');
  if (titleEl) titleEl.textContent = _TMPL_NAMES[name] || name;

  document.querySelectorAll('.tmpl-picker-card').forEach(c =>
    c.classList.toggle('active', c.dataset.tmpl === name));

  ['cs', 'split', 'ai', 'rk'].forEach(p => {
    const el = document.getElementById('dash-panel-' + p);
    if (el) el.style.display = p === name ? '' : 'none';
  });
  dashResetPreview();
  document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function dashUpdateSplitPreview() {
  const res = (document.getElementById('ds-resolution') || {}).value || '1080x1920';
  const ratio = parseInt((document.getElementById('ds-split-ratio') || {}).value || '50', 10);
  const [w, h] = res.split('x').map(Number);
  const topH = Math.round(h * ratio / 100);
  const botH = h - topH;
  const topEl = document.getElementById('ds-preview-top');
  const botEl = document.getElementById('ds-preview-bot');
  const dimTop = document.getElementById('ds-dim-top');
  const dimBot = document.getElementById('ds-dim-bot');
  const outLabel = document.getElementById('ds-output-label');
  if (topEl) topEl.style.flex = ratio + '';
  if (botEl) botEl.style.flex = (100 - ratio) + '';
  if (dimTop) dimTop.textContent = w + ' × ' + topH;
  if (dimBot) dimBot.textContent = w + ' × ' + botH;
  if (outLabel) outLabel.textContent = 'Output: ' + w + ' × ' + h;
}

function dashBackToPicker() {
  const pg = document.getElementById('page-templates');
  if (pg) pg.classList.remove('tmpl-ws-open');
  DASH.template = null;
  dashResetPreview();
  document.querySelectorAll('.tmpl-picker-card').forEach(c => c.classList.remove('active'));
}

// Wire template card clicks
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tmpl-picker-card[data-tmpl]').forEach(card => {
    card.addEventListener('click', function() {
      dashSelectTemplate(this.dataset.tmpl);
    });
  });
});

function dashResetPreview() {
  const vid = document.getElementById('dash-pv-video');
  if (vid) { vid.pause(); vid.src = ''; vid.style.display = 'none'; }
  const ph = document.getElementById('dash-pv-placeholder');
  if (ph) ph.style.display = '';
  const res = document.getElementById('dash-pv-result');
  if (res) res.style.display = 'none';
}

function dashShowPreview(src) {
  const vid = document.getElementById('dash-pv-video');
  vid.src = src; vid.style.display = '';
  document.getElementById('dash-pv-placeholder').style.display = 'none';
}

function dashShowDownload(filename) {
  const btn = document.getElementById('dash-pv-dl-btn');
  btn.onclick = () => downloadExport(filename);
  document.getElementById('dash-pv-result').style.display = '';
}

// ── Shared upload ────────────────────────────────────────────

async function _dashUpload(file, statusEl) {
  statusEl.textContent = 'Uploading…';
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Upload failed');
    statusEl.textContent = `✓ ${data.name} (${data.size_mb} MB)`;
    return data;
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    return null;
  }
}

// ── SPLITSCREEN ───────────────────────────────────────────────

function dashSrcTab(mode) {
  document.getElementById('ds-url-section').style.display  = mode === 'url'  ? '' : 'none';
  document.getElementById('ds-file-section').style.display = mode === 'file' ? '' : 'none';
  document.getElementById('ds-tab-url').classList.toggle('active', mode === 'url');
  document.getElementById('ds-tab-file').classList.toggle('active', mode === 'file');
}

function dashDropFile(ev) {
  ev.preventDefault();
  const file = ev.dataTransfer.files[0];
  if (file) dashFileChosen(file);
}

async function dashFileChosen(file) {
  const statusEl = document.getElementById('ds-file-status');
  const data = await _dashUpload(file, statusEl);
  if (!data) return;
  DASH.primaryUploadId = data.id;
  DASH.primaryUrl = '';
  dashShowPreview('/api/uploads/stream/' + data.id);
  dashSplitCheckReady();
}

async function dashPreviewUrl() {
  const url = document.getElementById('ds-url').value.trim();
  const info = document.getElementById('ds-url-info');
  if (!url) return;
  info.style.display = ''; info.textContent = 'Fetching…';
  try {
    const res = await fetch('/api/preview', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    info.textContent = `✓ ${d.title.slice(0,60)} · ${Math.round(d.duration)}s`;
    DASH.primaryUrl = url;
    dashSplitCheckReady();
  } catch (e) {
    info.textContent = `Error: ${e.message}`;
  }
}

function dashSplitCheckReady() {
  const hasSource = DASH.primaryUploadId || document.getElementById('ds-url').value.trim();
  const hasBg     = DASH.bgTemplate !== '';
  const hasClips  = DASH.clips.length > 0;
  document.getElementById('ds-render-btn').disabled = !(hasSource && hasBg && hasClips);
}

function dashSelectBg(name) {
  DASH.bgTemplate = name;
  document.querySelectorAll('.ds-bg-card').forEach(c => c.classList.remove('selected'));
  const map = { subway_surfers: 'ds-bg-subway', minecraft_parkour: 'ds-bg-minecraft', gta: 'ds-bg-gta' };
  document.getElementById(map[name])?.classList.add('selected');
  dashSplitCheckReady();
}

function dashAddClip() {
  const start = document.getElementById('ds-ts-start').value.trim();
  const end   = document.getElementById('ds-ts-end').value.trim();
  if (!start || !end) return;
  DASH.clips.push({ start, end });
  document.getElementById('ds-ts-start').value = '';
  document.getElementById('ds-ts-end').value   = '';
  _dashRenderClips();
  dashSplitCheckReady();
}

function _dashRenderClips() {
  const list = document.getElementById('ds-clip-list');
  list.innerHTML = DASH.clips.map((c, i) =>
    `<div class="ds-clip-row">
      <span>#${i+1} &nbsp; ${c.start} → ${c.end}</span>
      <button class="ds-clip-del" onclick="dashDelClip(${i})">×</button>
    </div>`
  ).join('');
}

function dashDelClip(i) {
  DASH.clips.splice(i, 1);
  _dashRenderClips();
  dashSplitCheckReady();
}

async function dashSplitRender() {
  const btn = document.getElementById('ds-render-btn');
  btn.disabled = true;
  document.getElementById('ds-progress-wrap').style.display = '';
  document.getElementById('ds-log').innerHTML = '';

  const body = {
    template: 'split_screen',
    bg_template: DASH.bgTemplate,
    clips: DASH.clips,
    resolution: '1080x1920',
    codec: 'h264',
  };
  if (DASH.primaryUploadId) body.primary_upload_id = DASH.primaryUploadId;
  else body.primary_url = document.getElementById('ds-url').value.trim();

  try {
    const res = await fetch('/api/generate', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    _dashPoll(d.job_id, 'ds');
  } catch (e) {
    document.getElementById('ds-log').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── AI STUDIO ────────────────────────────────────────────────

function dashAiSrcTab(mode) {
  document.getElementById('dai-url-section').style.display  = mode === 'url'  ? '' : 'none';
  document.getElementById('dai-file-section').style.display = mode === 'file' ? '' : 'none';
  document.getElementById('dai-tab-url').classList.toggle('active', mode === 'url');
  document.getElementById('dai-tab-file').classList.toggle('active', mode === 'file');
}

function dashAiDropFile(ev) {
  ev.preventDefault();
  const file = ev.dataTransfer.files[0];
  if (file) dashAiFileChosen(file);
}

async function dashAiFileChosen(file) {
  const statusEl = document.getElementById('dai-file-status');
  const data = await _dashUpload(file, statusEl);
  if (!data) return;
  DASH.primaryUploadId = data.id;
  dashShowPreview('/api/uploads/stream/' + data.id);
  dashAiCheckReady();
}

function dashAiToggleVo() {
  const on = document.getElementById('dai-do-vo').checked;
  document.getElementById('dai-vo-opts').style.cssText = on ? '' : 'opacity:.4;pointer-events:none';
  // also wire subs toggle
  const subsOn = document.getElementById('dai-do-subs').checked;
  document.getElementById('dai-subs-opts').style.cssText = subsOn ? '' : 'opacity:.4;pointer-events:none';
}

function dashAiCheckReady() {
  const hasSource = DASH.primaryUploadId || document.getElementById('dai-url').value.trim();
  const hasSubs   = document.getElementById('dai-do-subs').checked;
  const hasVo     = document.getElementById('dai-do-vo').checked;
  const hasScript = document.getElementById('dai-script').value.trim();
  const ready = hasSource && (hasSubs || (hasVo && hasScript));
  document.getElementById('dai-render-btn').disabled = !ready;
  // toggle opts visibility
  document.getElementById('dai-subs-opts').style.cssText = hasSubs ? '' : 'opacity:.4;pointer-events:none';
  document.getElementById('dai-vo-opts').style.cssText   = hasVo   ? '' : 'opacity:.4;pointer-events:none';
}

async function dashAiGenerate() {
  const btn = document.getElementById('dai-render-btn');
  btn.disabled = true;
  document.getElementById('dai-progress-wrap').style.display = '';
  document.getElementById('dai-log').innerHTML = '';

  const fontMap = {
    'impact': 'Impact', 'montserrat': 'DejaVu Sans Bold', 'oswald': 'DejaVu Sans Bold',
    'bebas': 'Impact', 'arial': 'Liberation Sans Bold', 'roboto': 'DejaVu Sans',
    'playfair': 'DejaVu Serif Bold',
  };
  const rawFont = document.getElementById('dai-sub-font')?.value || 'impact';
  const sizeMap = { small: 40, medium: 48, large: 58, xlarge: 70 };
  const rawSize = document.getElementById('dai-sub-size')?.value || 'medium';

  const body = {
    do_subtitles: document.getElementById('dai-do-subs').checked,
    sub_model:    document.getElementById('dai-sub-model').value,
    sub_style:    document.getElementById('dai-sub-style').value,
    sub_font:     fontMap[rawFont] || 'DejaVu Sans Bold',
    sub_size:     sizeMap[rawSize] || 48,
    do_voiceover: document.getElementById('dai-do-vo').checked,
    vo_voice:     document.getElementById('dai-voice').value,
    vo_script:    document.getElementById('dai-script').value.trim(),
    codec: 'h264', crf: 23,
  };
  if (DASH.primaryUploadId) body.upload_id = DASH.primaryUploadId;
  else body.source_url = document.getElementById('dai-url').value.trim();

  try {
    const res = await fetch('/api/generate/ai-studio', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    _dashPoll(d.job_id, 'dai');
  } catch (e) {
    document.getElementById('dai-log').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── RANKING ──────────────────────────────────────────────────

function dashRkAddItem() {
  const url   = document.getElementById('drk-url').value.trim();
  const start = document.getElementById('drk-start').value.trim() || '0:00';
  const end   = document.getElementById('drk-end').value.trim();
  const label = document.getElementById('drk-label').value.trim() || `Item ${DASH.rkItems.length + 1}`;
  if (!url || !end) { alert('Paste a URL and set an end time.'); return; }
  DASH.rkItems.push({ url, start, end, label, color: '#FFFFFF', fit: 'crop', crop_x: 0.5, crop_y: 0.5 });
  document.getElementById('drk-url').value = '';
  document.getElementById('drk-start').value = '';
  document.getElementById('drk-end').value = '';
  document.getElementById('drk-label').value = '';
  _dashRkRenderList();
  document.getElementById('drk-render-btn').disabled = DASH.rkItems.length < 1;
}

function _dashRkRenderList() {
  const list = document.getElementById('drk-item-list');
  list.innerHTML = DASH.rkItems.map((it, i) =>
    `<div class="ds-clip-row">
      <span>#${i+1} ${it.label} &nbsp; ${it.start} → ${it.end}</span>
      <button class="ds-clip-del" onclick="dashRkDel(${i})">×</button>
    </div>`
  ).join('');
}

function dashRkDel(i) {
  DASH.rkItems.splice(i, 1);
  _dashRkRenderList();
  document.getElementById('drk-render-btn').disabled = DASH.rkItems.length < 1;
}

async function dashRkRender() {
  const btn = document.getElementById('drk-render-btn');
  btn.disabled = true;
  document.getElementById('drk-progress-wrap').style.display = '';
  document.getElementById('drk-log').innerHTML = '';

  const body = {
    title:          document.getElementById('drk-title').value || 'RANKING',
    title_color:    document.getElementById('drk-title-color').value,
    subtitle:       document.getElementById('drk-subtitle').value,
    subtitle_color: document.getElementById('drk-subtitle-color').value,
    items:          DASH.rkItems,
    resolution:     '1080x1920',
    codec:          'h264',
    crf:            23,
  };

  try {
    const res = await fetch('/api/generate/ranking', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    _dashPoll(d.job_id, 'drk');
  } catch (e) {
    document.getElementById('drk-log').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── Shared poller ────────────────────────────────────────────

async function _dashPoll(jobId, prefix) {
  const fillEl   = document.getElementById(prefix + '-progress-fill');
  const labelEl  = document.getElementById(prefix + '-progress-label');
  const logEl    = document.getElementById(prefix + '-log');
  let seen = 0;

  const tick = async () => {
    try {
      const res = await fetch('/api/jobs/' + jobId);
      const job = await res.json();

      if (fillEl)  fillEl.style.width  = (job.progress || 0) + '%';
      if (labelEl) labelEl.textContent = job.status + (job.progress ? ` · ${job.progress}%` : '');

      const entries = (job.logs || []).slice(seen);
      seen += entries.length;
      if (logEl) {
        entries.forEach(e => {
          const div = document.createElement('div');
          div.className = 'log-line log-' + (e.level || 'inf');
          div.textContent = `[${e.ts}] ${e.msg}`;
          logEl.appendChild(div);
          logEl.scrollTop = logEl.scrollHeight;
        });
      }

      if (job.status === 'completed') {
        if (fillEl) fillEl.style.width = '100%';
        if (labelEl) labelEl.textContent = 'Done ✓';
        dashShowPreview('/api/video/' + job.output);
        dashShowDownload(job.output);
        return;
      }
      if (job.status === 'failed') {
        if (labelEl) labelEl.textContent = '✗ Failed — check log';
        return;
      }
      setTimeout(tick, 1500);
    } catch (err) { setTimeout(tick, 2000); }
  };
  tick();
}

// ── Clip Studio ──────────────────────────────────────────────
const DCS = { clips: [], uploadId: null, primaryUrl: '' };

function dashCsSrcTab(mode) {
  document.getElementById('dcs-url-section').style.display  = mode === 'url'  ? '' : 'none';
  document.getElementById('dcs-file-section').style.display = mode === 'file' ? '' : 'none';
  document.getElementById('dcs-tab-url').classList.toggle('active',  mode === 'url');
  document.getElementById('dcs-tab-file').classList.toggle('active', mode === 'file');
}

function dashCsDropFile(ev) {
  ev.preventDefault();
  const f = ev.dataTransfer.files[0];
  if (f) dashCsFileChosen(f);
}

async function dashCsFileChosen(file) {
  const st = document.getElementById('dcs-file-status');
  st.textContent = 'Uploading…';
  try {
    const data = await _dashUpload(file, st);
    DCS.uploadId = data.id;
    DCS.primaryUrl = '';
    st.textContent = `✓ ${data.name} (${data.size_mb} MB)`;
    dashShowPreview('/api/upload/' + data.id);
    dashCsCheckReady();
  } catch (e) {
    st.textContent = 'Upload failed: ' + e.message;
  }
}

async function dashCsPreviewUrl() {
  const url = document.getElementById('dcs-url').value.trim();
  if (!url) return;
  const info = document.getElementById('dcs-url-info');
  info.style.display = '';
  info.textContent = 'Fetching info…';
  try {
    const r = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const d = await r.json();
    DCS.primaryUrl = url;
    DCS.uploadId = null;
    info.textContent = d.title ? `✓ ${d.title}` : '✓ Ready';
    dashCsCheckReady();
  } catch {
    info.textContent = 'Could not fetch info';
  }
}

function dashCsAddClip() {
  const s = document.getElementById('dcs-ts-start').value.trim();
  const e = document.getElementById('dcs-ts-end').value.trim();
  if (!s || !e) return;
  DCS.clips.push({ start: s, end: e });
  document.getElementById('dcs-ts-start').value = '';
  document.getElementById('dcs-ts-end').value = '';
  _dashCsRenderClips();
  dashCsCheckReady();
}

function _dashCsRenderClips() {
  const el = document.getElementById('dcs-clip-list');
  if (!DCS.clips.length) { el.innerHTML = ''; return; }
  el.innerHTML = DCS.clips.map((c, i) =>
    `<div class="ds-clip-row">${c.start} → ${c.end}<button class="ds-clip-del" onclick="dashCsDelClip(${i})">✕</button></div>`
  ).join('');
}

function dashCsDelClip(i) {
  DCS.clips.splice(i, 1);
  _dashCsRenderClips();
  dashCsCheckReady();
}

function dashCsCheckReady() {
  const hasSrc = !!(DCS.uploadId || document.getElementById('dcs-url').value.trim());
  const hasClips = DCS.clips.length > 0;
  document.getElementById('dcs-render-btn').disabled = !(hasSrc && hasClips);
}

async function dashCsRender() {
  const btn = document.getElementById('dcs-render-btn');
  btn.disabled = true;
  document.getElementById('dcs-progress-wrap').style.display = '';
  document.getElementById('dcs-progress-fill').style.width = '0%';
  document.getElementById('dcs-progress-label').textContent = 'Queuing…';

  const fmtMap = { '9:16': '1080x1920', '1:1': '1080x1080', '16:9': '1920x1080' };
  const resolution = fmtMap[document.getElementById('dcs-format').value] || '1080x1920';
  const qualMap = { standard: 23, high: 18, compact: 28 };
  const crf = qualMap[document.getElementById('dcs-quality').value] || 23;

  const body = {
    template: 'center_crop',
    clips: DCS.clips,
    resolution,
    codec: 'h264',
    crf,
    ...(DCS.uploadId ? { primary_upload_id: DCS.uploadId } : { primary_url: document.getElementById('dcs-url').value.trim() }),
  };

  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const { job_id } = await r.json();
    _dashPoll(job_id, 'dcs');
  } catch (e) {
    document.getElementById('dcs-progress-label').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── Editor: caption track ─────────────────────────────────────
function vedAddCaption() {
  const text = prompt('Caption text:');
  if (!text) return;
  const row = document.getElementById('ved-tl-caption-row');
  const id = 'cap-' + Date.now();
  const div = document.createElement('div');
  div.className = 'ved-tl-clip';
  div.id = id;
  div.style.cssText = 'left:2px;width:160px;top:4px;height:24px;font-size:.65rem;padding:0 6px;display:flex;align-items:center;gap:4px;';
  div.innerHTML = `<span style="opacity:.7">T</span><span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${text}</span>`;
  div.title = text;
  row.appendChild(div);
}
