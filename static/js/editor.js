'use strict';

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
    tick.style.left   = (t * pps) + 'px';
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
    const res   = await apiFetch('/api/uploads');
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
function vedAddPhotoFiles(rawList) { return _vedUpload(Array.from(rawList || []), true); }

async function _vedUpload(files, isPhoto = false) {
  if (!files.length) return;
  const wrap = document.getElementById('ved-uploading');
  if (wrap) wrap.style.display = 'block';

  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        _modal({ icon: 'warn', iconColor: 'danger', title: 'Upload failed', msg: err.detail || 'Unknown error' });
        continue;
      }
      const data = await res.json();
      VED.library.unshift(data);
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
  const name  = entry?.name || id;
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

// ── Photo track ───────────────────────────────────────────────
const _VED_PHOTO_DEFAULT_DUR = 3;

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
    hint.className   = 'ved-tl-empty-hint';
    hint.textContent = 'Add photos from the library';
    row.appendChild(hint);
    return;
  }

  const pps = _vedPPS();
  let cumSec = 0;
  VED.photoClips.forEach((item, i) => {
    const dur   = _vedClipDur(item);
    const isSel = item.uid === VED.selectedClip;
    const block = document.createElement('div');
    block.className = 'ved-tl-clip ved-tl-clip--photo' + (isSel ? ' ved-tl-clip--sel' : '');
    block.style.cssText = `left:${cumSec * pps}px;width:${dur * pps}px`;
    block.draggable = true;

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
      document.querySelectorAll('.ved-tl-clip--drag-over').forEach(el => el.classList.remove('ved-tl-clip--drag-over'));
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

// ── Audio track ───────────────────────────────────────────────
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
    hint.className   = 'ved-tl-empty-hint';
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
      document.querySelectorAll('.ved-tl-clip--drag-over').forEach(el => el.classList.remove('ved-tl-clip--drag-over'));
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

// ── Video sequence ────────────────────────────────────────────
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
        const maxIn = (item.end != null ? item.end : (item.duration || 9999)) - 0.1;
        item.start  = Math.max(0, Math.min(maxIn, initTime + delta));
        const leftDelta = (item.start - initStart) * pps;
        block.style.left  = (initLeft + leftDelta) + 'px';
        block.style.width = (_vedClipDur(item) * pps) + 'px';
      } else {
        item.end = Math.max((item.start || 0) + 0.1,
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
    hint.className   = 'ved-tl-empty-hint';
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

      const canvas = document.createElement('canvas');
      canvas.width  = Math.ceil(widPx);
      canvas.height = 56;
      block.appendChild(canvas);
      _vedDrawFilmstrip(canvas, item);

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
        document.querySelectorAll('.ved-tl-clip--drag-over').forEach(el => el.classList.remove('ved-tl-clip--drag-over'));
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
    VED.audioClips.find(s => s.uid === uid) ? 'audio' :
    VED.photoClips.find(s => s.uid === uid) ? 'photo' : 'video'
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
    const s   = VED.sequence[i];
    const dur = Math.max(0, (s.end != null ? s.end : (s.duration || 0)) - (s.start || 0));
    if (i < VED.seqIdx)  { e += dur; continue; }
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

// ── Video sequence playback ───────────────────────────────────
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
  const item = VED.sequence.find(s => s.uid === VED.selectedClip)
            || VED.audioClips.find(s => s.uid === VED.selectedClip);
  const minT = item?.start ?? 0;
  const maxT = item?.end   ?? (video.duration || 9999);
  video.currentTime = Math.max(minT, Math.min(maxT, video.currentTime + secs));
  _vedUpdateSeekbar();
}

function vedTlPointerDown(e) {
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
  const item  = arr.find(s => s.uid === VED.selectedClip);

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

  const reRenderFn  = track === 'audio' ? 'vedRenderAudioTrack()' : track === 'photo' ? 'vedRenderPhotoTrack()' : 'vedRenderSequence()';
  const removeFn    = track === 'audio' ? 'vedRemoveFromAudioSeq' : track === 'photo' ? 'vedRemoveFromPhotoSeq' : 'vedRemoveFromSeq';
  const moveFn      = track === 'audio' ? 'vedMoveAudioClip'      : track === 'photo' ? 'vedMovePhotoClip'      : 'vedMoveSeq';
  const trackIcon   = track === 'audio' ? '#i-vol' : track === 'photo' ? '#i-img' : '#i-film';
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

    const res = await apiFetch('/api/edit/render', {
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

function _vedSetProgress(pct, label) {
  const fill = document.getElementById('ved-progress-fill');
  const lbl  = document.getElementById('ved-progress-label');
  if (fill) fill.style.width  = pct + '%';
  if (lbl)  lbl.textContent   = label;
}

function _vedAppendLog(entry) {
  const box = document.getElementById('ved-log-box');
  if (!box) return;
  const line = document.createElement('span');
  line.className   = entry.level === 'err' ? 'log-err' : entry.level === 'ok' ? 'log-ok' : 'log-inf';
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
