'use strict';

function dashSelectTemplate(name) {
  const pg = document.getElementById('page-templates');
  if (!pg) return;

  if (DASH.template !== name) {
    DASH.primaryUploadId = null; DASH.primaryUrl = ''; DASH.bgTemplate = '';
    DASH.clips = []; DASH.rkItems = [];
    DCS.clips = []; DCS.uploadId = null; DCS.primaryUrl = '';
    const cl = document.getElementById('ds-clip-list');  if (cl) cl.innerHTML = '';
    const dc = document.getElementById('dcs-clip-list'); if (dc) dc.innerHTML = '';
    const rk = document.getElementById('drk-item-list'); if (rk) rk.innerHTML = '';
  }
  DASH.template = name;

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
  const res   = (document.getElementById('ds-resolution') || {}).value || '1080x1920';
  const ratio = parseInt((document.getElementById('ds-split-ratio') || {}).value || '50', 10);
  const [w, h] = res.split('x').map(Number);
  const topH = Math.round(h * ratio / 100);
  const botH = h - topH;
  const topEl    = document.getElementById('ds-preview-top');
  const botEl    = document.getElementById('ds-preview-bot');
  const dimTop   = document.getElementById('ds-dim-top');
  const dimBot   = document.getElementById('ds-dim-bot');
  const outLabel = document.getElementById('ds-output-label');
  if (topEl)    topEl.style.flex   = ratio + '';
  if (botEl)    botEl.style.flex   = (100 - ratio) + '';
  if (dimTop)   dimTop.textContent  = w + ' × ' + topH;
  if (dimBot)   dimBot.textContent  = w + ' × ' + botH;
  if (outLabel) outLabel.textContent = 'Output: ' + w + ' × ' + h;
}

function dashBackToPicker() {
  const pg = document.getElementById('page-templates');
  if (pg) pg.classList.remove('tmpl-ws-open');
  DASH.template = null;
  dashResetPreview();
  document.querySelectorAll('.tmpl-picker-card').forEach(c => c.classList.remove('active'));
}

function dashResetPreview() {
  const vid = document.getElementById('dash-pv-video');
  if (vid) { vid.pause(); vid.src = ''; vid.style.display = 'none'; }
  const ph  = document.getElementById('dash-pv-placeholder');
  if (ph)  ph.style.display = '';
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

// ── Shared upload ─────────────────────────────────────────────
async function _dashUpload(file, statusEl) {
  statusEl.textContent = 'Uploading…';
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await apiFetch('/api/upload', { method: 'POST', body: form });
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
  const url  = document.getElementById('ds-url').value.trim();
  const info = document.getElementById('ds-url-info');
  if (!url) return;
  info.style.display = ''; info.textContent = 'Fetching…';
  try {
    const res = await apiFetch('/api/preview', { method: 'POST',
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

function dashSelectBg(slug) {
  DASH.bgTemplate = slug;
  document.querySelectorAll('.ds-bg-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`ds-bg-${slug}`)?.classList.add('selected');
  dashSplitCheckReady();
}

function bgCardHover(card, enter) {
  if (card.classList.contains('ds-bg-unavailable')) return;
  const vid = card.querySelector('.ds-bg-video');
  if (!vid) return;
  if (enter) {
    vid.play().catch(() => {});
  } else {
    vid.pause();
    vid.currentTime = 0;
  }
}

function dsCarScroll(dir) {
  const el = document.getElementById('ds-bg-grid');
  if (!el) return;
  const card = el.querySelector('.ds-bg-card');
  const cardW = card ? card.offsetWidth + 10 : 120;
  el.scrollBy({ left: dir * cardW * 2, behavior: 'smooth' });
}

function dsCheckBgTemplates() {
  apiFetch('/api/bg-templates')
    .then(r => r.json())
    .then(list => {
      list.forEach(({ name, ready }) => {
        const card = document.getElementById(`ds-bg-${name}`);
        if (!card) return;
        card.classList.toggle('ds-bg-unavailable', !ready);
      });
    })
    .catch(() => {});
}

function dashAddClip() {
  const start = twGetVal('tw-ds-start');
  const end   = twGetVal('tw-ds-end');
  if (!start || !end || start === end) return;
  DASH.clips.push({ start, end });
  twSetSecs('tw-ds-start', 0);
  twSetSecs('tw-ds-end', 5);
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
    const res = await apiFetch('/api/generate', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    _dashPoll(d.job_id, 'ds');
  } catch (e) {
    document.getElementById('ds-log').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── AI STUDIO ─────────────────────────────────────────────────
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
  const on     = document.getElementById('dai-do-vo').checked;
  const subsOn = document.getElementById('dai-do-subs').checked;
  document.getElementById('dai-vo-opts').style.cssText   = on     ? '' : 'opacity:.4;pointer-events:none';
  document.getElementById('dai-subs-opts').style.cssText = subsOn ? '' : 'opacity:.4;pointer-events:none';
}

function dashAiCheckReady() {
  const hasSource = DASH.primaryUploadId || document.getElementById('dai-url').value.trim();
  const hasSubs   = document.getElementById('dai-do-subs').checked;
  const hasVo     = document.getElementById('dai-do-vo').checked;
  const hasScript = document.getElementById('dai-script').value.trim();
  const ready = hasSource && (hasSubs || (hasVo && hasScript));
  document.getElementById('dai-render-btn').disabled = !ready;
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
  const sizeMap = { small: 40, medium: 48, large: 58, xlarge: 70 };
  const rawFont = document.getElementById('dai-sub-font')?.value || 'impact';
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
    const res = await apiFetch('/api/generate/ai-studio', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    _dashPoll(d.job_id, 'dai');
  } catch (e) {
    document.getElementById('dai-log').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── RANKING ───────────────────────────────────────────────────
function dashRkAddItem() {
  const url   = document.getElementById('drk-url').value.trim();
  const start = document.getElementById('drk-start').value.trim() || '0:00';
  const end   = document.getElementById('drk-end').value.trim();
  const label = document.getElementById('drk-label').value.trim() || `Item ${DASH.rkItems.length + 1}`;
  if (!url || !end) { alert('Paste a URL and set an end time.'); return; }
  DASH.rkItems.push({ url, start, end, label, color: '#FFFFFF', fit: 'crop', crop_x: 0.5, crop_y: 0.5 });
  document.getElementById('drk-url').value   = '';
  document.getElementById('drk-start').value = '';
  document.getElementById('drk-end').value   = '';
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
    const res = await apiFetch('/api/generate/ranking', { method: 'POST',
      headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail);
    _dashPoll(d.job_id, 'drk');
  } catch (e) {
    document.getElementById('drk-log').textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

// ── Shared poller ─────────────────────────────────────────────
async function _dashPoll(jobId, prefix) {
  const fillEl  = document.getElementById(prefix + '-progress-fill');
  const labelEl = document.getElementById(prefix + '-progress-label');
  const logEl   = document.getElementById(prefix + '-log');
  let seen = 0;

  const tick = async () => {
    try {
      const res = await apiFetch('/api/jobs/' + jobId);
      const job = await res.json();

      if (fillEl)  fillEl.style.width   = (job.progress || 0) + '%';
      if (labelEl) labelEl.textContent  = job.status + (job.progress ? ` · ${job.progress}%` : '');

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
        if (fillEl)  fillEl.style.width    = '100%';
        if (labelEl) labelEl.textContent   = 'Done ✓';
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

// ── Clip Studio ───────────────────────────────────────────────
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
    DCS.uploadId   = data.id;
    DCS.primaryUrl = '';
    st.textContent = `✓ ${data.name} (${data.size_mb} MB)`;
    dashShowPreview('/api/upload/' + data.id);
    dashCsCheckReady();
  } catch (e) {
    st.textContent = 'Upload failed: ' + e.message;
  }
}

async function dashCsPreviewUrl() {
  const url  = document.getElementById('dcs-url').value.trim();
  if (!url) return;
  const info = document.getElementById('dcs-url-info');
  info.style.display = '';
  info.textContent = 'Fetching info…';
  try {
    const r = await apiFetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const d = await r.json();
    DCS.primaryUrl = url;
    DCS.uploadId   = null;
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
  document.getElementById('dcs-ts-end').value   = '';
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
  const hasSrc   = !!(DCS.uploadId || document.getElementById('dcs-url').value.trim());
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
    const r = await apiFetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  const id  = 'cap-' + Date.now();
  const div = document.createElement('div');
  div.className = 'ved-tl-clip';
  div.id = id;
  div.style.cssText = 'left:2px;width:160px;top:4px;height:24px;font-size:.65rem;padding:0 6px;display:flex;align-items:center;gap:4px;';
  div.innerHTML = `<span style="opacity:.7">T</span><span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${text}</span>`;
  div.title = text;
  row.appendChild(div);
}
