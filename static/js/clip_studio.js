'use strict';

function previewURL(type) {
  const val = type === 'primary'
    ? document.getElementById('primary-url').value.trim()
    : document.getElementById('bg-url').value.trim();
  if (!val) return;

  const thumbId  = type === 'primary' ? 'preview-thumb'    : 'bg-preview-thumb';
  const labelId  = type === 'primary' ? 'preview-label'    : 'bg-preview-label';
  const statusId = type === 'primary' ? 'primary-url-status': 'bg-url-status';

  const thumb  = document.getElementById(thumbId);
  const label  = document.getElementById(labelId);
  const status = document.getElementById(statusId);

  if (thumb) { thumb.style.display = 'none'; thumb.src = ''; }
  if (label) label.textContent = '';
  if (status) { status.textContent = 'Fetching preview…'; status.className = 'preview-info'; status.style.display = 'block'; }

  apiFetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: val, type }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        if (status) { status.textContent = 'Preview failed: ' + data.error; status.className = 'preview-info error'; }
        return;
      }
      if (status) { status.style.display = 'none'; }
      if (thumb && data.thumbnail) { thumb.src = data.thumbnail; thumb.style.display = 'block'; }
      if (label) label.textContent = data.title || '';
      if (type === 'primary' && data.duration) {
        initTimelineSlider(data.duration);
      }
    })
    .catch(err => {
      if (status) { status.textContent = 'Preview error: ' + err.message; status.className = 'preview-info error'; }
    });
}

// ── Editor source tabs ─────────────────────────────────────────
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
    const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
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
    document.getElementById('ed-dropzone').querySelector('div').textContent = data.name;
  } catch (e) {
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-warn"/></svg> ${e.message}`;
    statusEl.className = 'preview-info error';
    S.edUploadId = null;
    S.edUploadName = null;
  }
  checkReady();
}

// ── Background source tabs ─────────────────────────────────────
function bgSourceTab(mode) {
  S.bgSourceMode = mode;
  document.getElementById('bg-tab-url').classList.toggle('active', mode === 'url');
  document.getElementById('bg-tab-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('bg-url-input-area').style.display = mode === 'url'    ? '' : 'none';
  document.getElementById('bg-upload-area').style.display    = mode === 'upload' ? '' : 'none';
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
    const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
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
  if (!hasSource)       missing.push(S.edSourceMode === 'upload' ? 'Upload a video file' : 'Primary URL');
  if (S.clips.length === 0) missing.push('At least one clip');
  const hasBg = bgURL || S.bgTemplate || (S.bgSourceMode === 'upload' && S.bgUploadId);
  if (isSplit && !hasBg) missing.push('Background video, URL, or Gaming Template');

  const statusEl = document.getElementById('ready-status');
  const genBtn   = document.getElementById('gen-btn');

  if (missing.length > 0) {
    statusEl.className = 'status-missing';
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-warn"/></svg> Missing: ${missing.join(' · ')}`;
    genBtn.disabled = true;
  } else {
    statusEl.className = 'status-ready';
    statusEl.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> Ready — source videos will download when you generate.`;
    genBtn.disabled = false;
  }
}

// ── Generate ──────────────────────────────────────────────────
async function generate() {
  const primaryURL = document.getElementById('primary-url').value.trim();
  const bgURL      = document.getElementById('bg-url').value.trim();

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

    const res = await apiFetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_url:       S.edSourceMode === 'url'    ? primaryURL : '',
        primary_upload_id: S.edSourceMode === 'upload' ? (S.edUploadId || '') : '',
        bg_url:            S.bgSourceMode === 'url'    ? bgURL : '',
        bg_upload_id:      S.bgSourceMode === 'upload' ? (S.bgUploadId || '') : '',
        bg_template:  S.bgTemplate,
        template:     S.template,
        clips:        S.clips.map(c => ({ start: c.start, end: c.end })),
        resolution, codec,
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
    const res = await apiFetch('/api/jobs/' + jobId);
    if (!res.ok) return;
    const job = await res.json();

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
