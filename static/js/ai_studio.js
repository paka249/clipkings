'use strict';

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
  card.style.display = enabled ? '' : 'none';
}

async function aisPreviewUrl() {
  const url  = document.getElementById('ais-url').value.trim();
  const info = document.getElementById('ais-url-preview');
  if (!url || !info) return;
  info.textContent = 'Checking…';
  info.className = 'rk-preview-info';
  try {
    const res = await apiFetch('/api/preview', {
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
  event.stopPropagation();
  const file = event.dataTransfer?.files?.[0];
  if (file) aisUploadFile(file);
}

function aisFileChosen(file) {
  if (file) aisUploadFile(file);
}

async function aisUploadFile(file) {
  const fileInput = document.getElementById('ais-file-input');
  if (fileInput) fileInput.value = '';

  const status = document.getElementById('ais-upload-status');
  if (status) status.textContent = `Uploading ${file.name}…`;

  const form = new FormData();
  form.append('file', file);
  try {
    const res = await apiFetch('/api/upload', { method: 'POST', body: form });
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
    const uploads = await apiFetch('/api/uploads').then(r => r.json());
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
        const res = await apiFetch('/api/uploads/' + id, { method: 'DELETE' });
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
  const ready  = hasSource && (doSubs || doVo) && (!doVo || script);
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
    const res = await apiFetch('/api/generate/ai-studio', {
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
    const res = await apiFetch('/api/jobs/' + jobId);
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
