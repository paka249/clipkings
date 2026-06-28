'use strict';

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
  RKS.items.push({ url: '', start: '0:00', end: '', label: '', color, font: 'DejaVu Sans Bold', fit: 'crop', crop_x: 0.5, crop_y: 0.5, _thumb: '', _thumbW: 0, _thumbH: 0 });
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
      start:  twGetVal(`tw-rk-start-${i}`) || '0:00',
      end:    twGetVal(`tw-rk-end-${i}`),
      label:  row.querySelector('.rk-label').value.trim(),
      color:  row.querySelector('.rk-color').value,
      font:   (row.querySelector('.rk-font-sel') || {}).value || 'DejaVu Sans Bold',
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
          <select class="select-input rk-font-sel" title="Label font"
            onchange="RKS.items[${i}].font=this.value">
            ${['DejaVu Sans Bold','Liberation Sans Bold','Ubuntu Bold','FreeSans Bold','Impact','Arial Bold'].map(f =>
              `<option value="${f}"${item.font===f?' selected':''}>${f}</option>`
            ).join('')}
          </select>
        </div>
        <div class="rk-row-bot">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
            <div><label class="field-label" style="margin-bottom:4px">Start</label><div id="tw-rk-start-${i}" class="tw-wrap tw-compact" data-secs="${twParse(item.start)}" data-onchange="RKS.items[${i}].start=twGetVal('tw-rk-start-${i}')"></div></div>
            <div><label class="field-label" style="margin-bottom:4px">End</label><div id="tw-rk-end-${i}" class="tw-wrap tw-compact" data-secs="${twParse(item.end)}" data-onchange="RKS.items[${i}].end=twGetVal('tw-rk-end-${i}');_checkRankingReady()"></div></div>
          </div>
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
  twInitAll();
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
  const url  = row.querySelector('.rk-url').value.trim();
  const info = document.getElementById(`rk-prev-${idx}`);
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
    if (!RKS.items[idx].end) {
      const endInput = row.querySelector('.rk-end');
      const autoEnd = fmtTS(Math.min(10, d.duration));
      if (endInput) endInput.value = autoEnd;
      RKS.items[idx].end = autoEnd;
      _checkRankingReady();
    }
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
  const img = document.getElementById(`rk-crop-img-${idx}`);
  const ind = document.getElementById(`rk-crop-ind-${idx}`);
  if (!img || !ind) return;

  const iw = item._thumbW || img.naturalWidth  || 16;
  const ih = item._thumbH || img.naturalHeight || 9;

  const res = document.getElementById('rk-resolution')?.value || '1080x1920';
  const [cw, ch] = res.split('x').map(Number);

  const sf      = Math.max(cw / iw, ch / ih);
  const scaledW = iw * sf;
  const scaledH = ih * sf;

  const fracW = Math.min(1, cw / scaledW);
  const fracH = Math.min(1, ch / scaledH);

  const cx      = item.crop_x ?? 0.5;
  const cy      = item.crop_y ?? 0.5;
  const leftPct = cx * (1 - fracW) * 100;
  const topPct  = cy * (1 - fracH) * 100;

  ind.style.left   = leftPct + '%';
  ind.style.top    = topPct  + '%';
  ind.style.width  = (fracW * 100) + '%';
  ind.style.height = (fracH * 100) + '%';
}

async function generateRanking() {
  _readRankingItemsFromDOM();
  const title         = (document.getElementById('rk-title').value.trim()) || 'RANKING';
  const titleColor    = document.getElementById('rk-title-color').value;
  const subtitle      = document.getElementById('rk-subtitle').value.trim();
  const subtitleColor = document.getElementById('rk-subtitle-color').value;
  const resolution    = document.getElementById('rk-resolution').value;
  const codec         = document.getElementById('rk-codec').value;
  const mute          = document.getElementById('rk-mute').checked;
  const fontSize      = parseInt(document.getElementById('rk-font-size').value) || 0;

  const btn = document.getElementById('rk-generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="rk-spinner"></span>Generating…';

  const logBox  = document.getElementById('rk-log-box');
  const logWrap = document.getElementById('rk-log-wrap');
  logWrap.style.display = 'block';
  logBox.innerHTML = '';
  document.getElementById('rk-export-card').style.display = 'none';
  document.getElementById('rk-progress-fill').style.width = '0%';
  RKS.lastLogCount = 0;

  try {
    const res = await apiFetch('/api/generate/ranking', {
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
    const res = await apiFetch('/api/jobs/' + jobId);
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

// ── Gaming template status ─────────────────────────────────────
async function loadGamingTemplateStatus() {
  try {
    const list = await apiFetch('/api/bg-templates').then(r => r.json());
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
