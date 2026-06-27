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
function _vedTotalDur() {
  const seqEnd = _vedSeqTotal();
  const imgEnd = (VED.photoClips || []).reduce((m, c) => Math.max(m, c.tEnd ?? 0), 0);
  return Math.max(seqEnd, imgEnd);
}

function _vedRenderRuler() {
  const ruler = document.getElementById('ved-tl-ruler');
  if (!ruler) return;
  const pps   = _vedPPS();
  const total = Math.max(30, _vedTotalDur() + 15);
  const w     = Math.ceil(total * pps) + 120;
  ruler.style.width = w + 'px';

  // Start at 1 (not 0.5) so labels are always whole-second integers and never duplicate.
  const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const majorSec  = intervals.find(s => s * pps >= 55) || 300;
  const minorSec  = majorSec / 5;

  ruler.innerHTML = '';
  for (let t = 0; t <= total + majorSec; t += minorSec) {
    const isMajor = Math.round(t / minorSec) % 5 === 0;
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

// ── File validation ───────────────────────────────────────────
const _VED_IMG_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.gif','.jfif','.avif']);
const _VED_AUD_EXTS = new Set(['.mp3','.aac','.wav','.m4a','.ogg','.flac']);

function _vedIsImg(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return _VED_IMG_EXTS.has(ext) || file.type.startsWith('image/');
}
function _vedIsAud(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return _VED_AUD_EXTS.has(ext) || file.type.startsWith('audio/');
}

// expectedTrack: 'image' | 'audio' | 'video' | null (auto for drag-drop)
function _vedValidateFile(file, expectedTrack) {
  const mb    = file.size / 1048576;
  const isImg = _vedIsImg(file);
  const isAud = _vedIsAud(file);

  if (expectedTrack === 'image') {
    if (!isImg)
      return `"${file.name}" is not an image. The Images track only accepts JPG, PNG, WebP, or GIF.`;
    if (mb > 10)
      return `"${file.name}" is ${mb.toFixed(1)} MB — images must be under 10 MB.`;
  } else if (expectedTrack === 'audio') {
    if (!isAud)
      return `"${file.name}" is not an audio file. The Audio track only accepts MP3, AAC, WAV, M4A, OGG, or FLAC.`;
    if (mb > 100)
      return `"${file.name}" is ${mb.toFixed(0)} MB — audio must be under 100 MB.`;
  } else if (expectedTrack === 'video') {
    if (isImg || isAud)
      return `"${file.name}" is not a video. The Video track only accepts MP4, MOV, MKV, WebM, AVI, and similar formats.`;
    if (mb > 500)
      return `"${file.name}" is ${mb.toFixed(0)} MB — videos must be under 500 MB.`;
  } else {
    // Drag-drop: only enforce size limits, auto-route by type
    if (isImg && mb > 10)  return `"${file.name}" is ${mb.toFixed(1)} MB — images must be under 10 MB.`;
    if (isAud && mb > 100) return `"${file.name}" is ${mb.toFixed(0)} MB — audio must be under 100 MB.`;
    if (!isImg && !isAud && mb > 500) return `"${file.name}" is ${mb.toFixed(0)} MB — videos must be under 500 MB.`;
  }
  return null;
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
    const isAudio = file.is_audio  || false;
    const isImage = file.is_image  || _vedIsImg({ name: file.name || file.id, type: file.type || '' });
    const displayName = file.name || file.original_name || file.id;
    const addFn = isAudio ? 'vedAddAudioToSeq' : isImage ? 'vedAddPhotoToSeq' : 'vedAddToSeq';
    const card = document.createElement('div');
    card.className = 'ved-lib-card';
    card.innerHTML = `
      <div class="ved-lib-thumb" id="vedthumb-${file.id}">
        ${isAudio
          ? `<svg class="icon icon-xl" style="color:var(--accent)"><use href="#i-vol"/></svg>`
          : isImage
          ? `<img src="/api/uploads/stream/${file.id}"
               style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
          : `<video muted playsinline preload="metadata" src="/api/uploads/stream/${file.id}"
               style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
               onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>
             <svg class="icon" style="color:rgba(255,255,255,.5);position:relative;z-index:1"><use href="#i-film"/></svg>`
        }
      </div>
      <div class="ved-lib-name" title="${displayName}">${displayName}</div>
      <div class="ved-lib-meta">${file.size_mb} MB${dur ? ' · ' + dur : ''}</div>
      <div class="ved-lib-btns">
        <button class="ved-lib-btn" onclick="${addFn}('${file.id}')">+ Add</button>
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
  if (files.length) await _vedUpload(files, null); // null = auto-detect
}

function vedAddVideoFiles(rawList) { return _vedUpload(Array.from(rawList || []), 'video'); }
function vedAddAudioFiles(rawList) { return _vedUpload(Array.from(rawList || []), 'audio'); }
function vedAddPhotoFiles(rawList) { return _vedUpload(Array.from(rawList || []), 'image'); }

// track: 'video' | 'audio' | 'image' | null (auto for drag-drop)
async function _vedUpload(files, track) {
  if (!files.length) return;
  const wrap = document.getElementById('ved-uploading');
  if (wrap) wrap.style.display = 'block';

  for (const file of files) {
    if (VED.library.length >= _VED_MAX_LIB) {
      _modal({ icon: 'warn', iconColor: 'danger', title: 'Library full',
        msg: `Max ${_VED_MAX_LIB} files in the library. Delete unused files to upload more.` });
      break;
    }
    const validErr = _vedValidateFile(file, track);
    if (validErr) {
      _modal({ icon: 'warn', iconColor: 'danger', title: 'File rejected', msg: validErr });
      continue;
    }
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
      // Route to the right track — use explicit track if provided, else auto-detect
      const ext = data.ext || '';
      const resolvedTrack = track || (
        _vedIsImg({ name: data.original_name || data.id, type: data.type || '' }) ? 'image' :
        (_VED_AUD_EXTS.has(data.ext) || data.is_audio) ? 'audio' : 'video'
      );
      if (resolvedTrack === 'image') vedAddPhotoToSeq(data.id);
      else if (resolvedTrack === 'audio') vedAddAudioToSeq(data.id);
      else vedAddToSeq(data.id);
    } catch (e) {
      _modal({ icon: 'warn', iconColor: 'danger', title: 'Upload failed', msg: e.message });
    }
  }

  ['ved-video-input','ved-audio-input','ved-image-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  vedRenderLibrary();
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

// ── Image (photo) track ───────────────────────────────────────
const _VED_PHOTO_DEFAULT_DUR = 3;

function vedAddPhotoToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  if (VED.photoClips.length >= _VED_MAX_IMG) {
    _modal({ icon: 'warn', iconColor: 'danger', title: 'Image track full',
      msg: `Max ${_VED_MAX_IMG} image clips in the timeline. Remove one to add another.` });
    return;
  }
  const newUid = Math.random().toString(36).slice(2, 8);
  // Place after the last existing image (or after the video sequence)
  const tStart = (VED.photoClips || []).reduce((m, c) => Math.max(m, c.tEnd ?? 0), _vedSeqTotal());
  VED.photoClips.push({
    uid:      newUid,
    uploadId: entry.id,
    name:     entry.name || entry.original_name || entry.id,
    tStart,
    tEnd:     tStart + _VED_PHOTO_DEFAULT_DUR,
    is_image: true,
    scale:    0.8,
    x:        0.5,
    y:        0.5,
    opacity:  1,
    rotation: 0,
    flipH:    false,
    flipV:    false,
    cropT: 0, cropR: 0, cropB: 0, cropL: 0,
  });
  _vedRenderRuler();
  vedRenderPhotoTrack();
  vedSelectClip(newUid, 'photo');
}

function vedRemoveFromPhotoSeq(uid) {
  VED.photoClips = VED.photoClips.filter(c => c.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  _vedRenderRuler();
  vedRenderPhotoTrack();
}

// Make an image resize handle (left = shift tStart, right = extend tEnd)
function _vedMakeImageHandle(item, side, block) {
  const handle = document.createElement('div');
  handle.className = `ved-tl-clip-handle ved-tl-clip-handle-${side}`;
  const bar = document.createElement('div');
  bar.className = 'ved-tl-clip-handle-bar';
  handle.appendChild(bar);

  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault();
    vedSelectClip(item.uid, 'photo');
    const startX  = e.pageX;
    const initTS  = item.tStart;
    const initTE  = item.tEnd;

    const onMove = (ev) => {
      const pps   = _vedPPS();
      const delta = (ev.pageX - startX) / pps;
      if (side === 'l') {
        item.tStart = Math.max(0, Math.min(initTE - 0.1, initTS + delta));
        block.style.left  = (item.tStart * pps) + 'px';
        block.style.width = ((item.tEnd - item.tStart) * pps) + 'px';
      } else {
        item.tEnd = Math.max(item.tStart + 0.1, initTE + delta);
        block.style.width = ((item.tEnd - item.tStart) * pps) + 'px';
      }
      vedRenderInspector();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      vedRenderPhotoTrack();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
  return handle;
}

function vedRenderPhotoTrack() {
  const row = document.getElementById('ved-tl-photo-row');
  if (!row) return;
  row.innerHTML = '';

  if (!VED.photoClips.length) {
    const hint = document.createElement('span');
    hint.className   = 'ved-tl-empty-hint';
    hint.textContent = 'Add images from the library — drag to position on the timeline';
    row.appendChild(hint);
    return;
  }

  const pps = _vedPPS();
  VED.photoClips.forEach((item, i) => {
    const tS    = item.tStart ?? 0;
    const tE    = item.tEnd   ?? (tS + _VED_PHOTO_DEFAULT_DUR);
    const dur   = Math.max(0.1, tE - tS);
    const isSel = item.uid === VED.selectedClip;

    const block = document.createElement('div');
    block.className = 'ved-tl-clip ved-tl-clip--photo' + (isSel ? ' ved-tl-clip--sel' : '');
    block.style.cssText = `left:${tS * pps}px;width:${dur * pps}px;cursor:grab`;

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
        <span class="ved-tl-clip-dur">${fmtTS(Math.round(tS))}–${fmtTS(Math.round(tE))}</span>
      </div>`;
    block.appendChild(info);
    block.appendChild(_vedMakeImageHandle(item, 'l', block));
    block.appendChild(_vedMakeImageHandle(item, 'r', block));

    // Body drag: reposition along the timeline
    block.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ved-tl-clip-handle')) return;
      e.preventDefault(); e.stopPropagation();
      vedSelectClip(item.uid, 'photo');
      const startX   = e.pageX;
      const initTS   = item.tStart;
      const clipDur  = item.tEnd - item.tStart;
      let moved = false;

      const onMove = (ev) => {
        if (!moved && Math.abs(ev.pageX - startX) < 3) return;
        moved = true;
        block.style.cursor = 'grabbing';
        const dt = (ev.pageX - startX) / _vedPPS();
        item.tStart = Math.max(0, initTS + dt);
        item.tEnd   = item.tStart + clipDur;
        block.style.left = (item.tStart * _vedPPS()) + 'px';
        const infoBot = block.querySelector('.ved-tl-clip-dur');
        if (infoBot) infoBot.textContent = `${fmtTS(Math.round(item.tStart))}–${fmtTS(Math.round(item.tEnd))}`;
        vedRenderInspector();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        block.style.cursor = 'grab';
        if (moved) { _vedRenderRuler(); vedRenderPhotoTrack(); }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    row.appendChild(block);
  });
}

// ── Audio track ───────────────────────────────────────────────
function vedAddAudioToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  if (VED.audioClips.length >= _VED_MAX_AUDIO) {
    _modal({ icon: 'warn', iconColor: 'danger', title: 'Audio track full',
      msg: `Max ${_VED_MAX_AUDIO} audio clips in the timeline. Remove one to add another.` });
    return;
  }
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
const _VED_MAX_VIDEO = 10;
const _VED_MAX_AUDIO = 3;
const _VED_MAX_IMG   = 20;
const _VED_MAX_LIB   = 30;

function vedAddToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  if (VED.sequence.length >= _VED_MAX_VIDEO) {
    _modal({ icon: 'warn', iconColor: 'danger', title: 'Video track full',
      msg: `Max ${_VED_MAX_VIDEO} video clips in the timeline. Remove one to add another.` });
    return;
  }
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
  // Refresh overlays so the selected image is immediately visible for editing
  _vedUpdateImgOverlays(_vedSeqElapsed());
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
  if (!VED.sequence.length) {
    // Image-only mode: drive elapsed from a manual timer
    const running = VED.seqPlaying && VED.imgPlayT0;
    return VED.imgPlayOffset + (running ? (performance.now() - VED.imgPlayT0) / 1000 : 0);
  }
  if (!video) return 0;
  let e = 0;
  for (let i = 0; i < VED.sequence.length; i++) {
    const s   = VED.sequence[i];
    const dur = Math.max(0, (s.end != null ? s.end : (s.duration || 0)) - (s.start || 0));
    if (i < VED.seqIdx)  { e += dur; continue; }
    if (i === VED.seqIdx) { e += Math.max(0, video.currentTime - (s.start || 0)); break; }
  }
  return e;
}

// ── Image overlay preview ─────────────────────────────────────
// ── Canvas image interaction ──────────────────────────────────

function _vedImgApplyStyle(wrap, item) {
  const scale = item.scale    ?? 1;
  const rot   = item.rotation ?? 0;
  const fX    = item.flipH    ? -1 : 1;
  const fY    = item.flipV    ? -1 : 1;
  wrap.style.left      = ((item.x ?? 0.5) * 100) + '%';
  wrap.style.top       = ((item.y ?? 0.5) * 100) + '%';
  wrap.style.width     = (scale * 100) + '%';
  wrap.style.transform = `translate(-50%,-50%) rotate(${rot}deg) scale(${fX},${fY})`;
  wrap.style.opacity   = item.opacity ?? 1;
}

function _vedImgCreateOverlay(item) {
  const wrap = document.createElement('div');
  wrap.className     = 'ved-img-wrap';
  wrap.dataset.uid   = item.uid;

  const img = document.createElement('img');
  img.src             = `/api/uploads/stream/${item.uploadId}`;
  img.draggable       = false;
  img.className       = 'ved-img-el';
  wrap.appendChild(img);

  // Corner handles (scale)
  ['nw','ne','se','sw'].forEach(pos => {
    const h = document.createElement('div');
    h.className = 'ved-img-corner ved-img-corner--' + pos;
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      _vedImgScaleStart(e, item, pos);
    });
    wrap.appendChild(h);
  });

  // Rotation handle (circle above image center, connected by line)
  const rotHandle = document.createElement('div');
  rotHandle.className = 'ved-img-rot-handle';
  rotHandle.title = 'Drag to rotate';
  rotHandle.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>';
  rotHandle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    _vedImgRotateStart(e, item);
  });
  wrap.appendChild(rotHandle);

  // Floating toolbar (crop, flip H, flip V)
  const tb = document.createElement('div');
  tb.className = 'ved-img-tb';

  const cropBtn = document.createElement('button');
  cropBtn.className = 'ved-img-tb-btn'; cropBtn.title = 'Crop';
  cropBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 2 6 18 22 18"/><polyline points="2 6 18 6 18 22"/></svg> Crop';
  cropBtn.addEventListener('click', e => { e.stopPropagation(); _vedImgCropMode(item); });
  tb.appendChild(cropBtn);

  const flipH = document.createElement('button');
  flipH.className = 'ved-img-tb-btn'; flipH.title = 'Mirror horizontal';
  flipH.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="2" x2="12" y2="22"/><path d="M20 7L12 2 12 22l8-5V7z" fill="currentColor" opacity=".4"/><path d="M4 7l8-5v20L4 17V7z"/></svg>';
  flipH.addEventListener('click', e => {
    e.stopPropagation();
    item.flipH = !item.flipH;
    const w = document.getElementById('ved-img-overlays')?.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
    if (w) _vedImgApplyStyle(w, item);
    vedRenderInspector();
  });
  tb.appendChild(flipH);

  const flipV = document.createElement('button');
  flipV.className = 'ved-img-tb-btn'; flipV.title = 'Mirror vertical';
  flipV.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="2" y1="12" x2="22" y2="12"/><path d="M7 20l-5-8 20 0-5 8H7z" fill="currentColor" opacity=".4"/><path d="M7 4l-5 8h20L17 4H7z"/></svg>';
  flipV.addEventListener('click', e => {
    e.stopPropagation();
    item.flipV = !item.flipV;
    const w = document.getElementById('ved-img-overlays')?.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
    if (w) _vedImgApplyStyle(w, item);
    vedRenderInspector();
  });
  tb.appendChild(flipV);

  wrap.appendChild(tb);

  // Body drag = move
  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.ved-img-corner,.ved-img-tb')) return;
    e.preventDefault(); e.stopPropagation();
    vedSelectClip(item.uid, 'photo');
    _vedUpdateImgOverlays(_vedSeqElapsed());
    vedRenderInspector();
    _vedImgMoveStart(e, item);
  });

  return wrap;
}

function _vedImgMoveStart(e, item) {
  const c = document.getElementById('ved-img-overlays');
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const ix = item.x ?? 0.5, iy = item.y ?? 0.5;
  const wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);

  const onMove = ev => {
    item.x = Math.max(0, Math.min(1, ix + (ev.clientX - sx) / rect.width));
    item.y = Math.max(0, Math.min(1, iy + (ev.clientY - sy) / rect.height));
    if (wrap) _vedImgApplyStyle(wrap, item);
    vedRenderInspector();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function _vedImgScaleStart(e, item, corner) {
  const c = document.getElementById('ved-img-overlays');
  if (!c) return;
  const rect      = c.getBoundingClientRect();
  const sx        = e.clientX;
  const initScale = item.scale ?? 1;
  // right-side corners → drag right = bigger; left-side → drag left = bigger
  const sign = (corner === 'ne' || corner === 'se') ? 1 : -1;
  const wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);

  const onMove = ev => {
    const dx = (ev.clientX - sx) / rect.width;
    item.scale = Math.max(0.05, Math.min(3, initScale + sign * dx * 2));
    if (wrap) _vedImgApplyStyle(wrap, item);
    vedRenderInspector();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function _vedImgRotateStart(e, item) {
  const c = document.getElementById('ved-img-overlays');
  if (!c) return;
  const wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;

  const onMove = ev => {
    const deg = Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180 / Math.PI;
    item.rotation = Math.round(deg);
    _vedImgApplyStyle(wrap, item);
    vedRenderInspector();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function _vedImgCropMode(item) {
  const c = document.getElementById('ved-img-overlays');
  if (!c) return;
  // Remove any existing crop UI
  c.querySelectorAll('.ved-crop-ui').forEach(el => el.remove());

  const wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
  if (!wrap) return;
  const wr = wrap.getBoundingClientRect();
  const cr = c.getBoundingClientRect();

  // Crop values: percentage of image inset from each side (0–100)
  const crop = { t: item.cropT ?? 0, r: item.cropR ?? 0, b: item.cropB ?? 0, l: item.cropL ?? 0 };

  const ui = document.createElement('div');
  ui.className = 'ved-crop-ui';
  ui.style.cssText = `position:absolute;left:${wr.left-cr.left}px;top:${wr.top-cr.top}px;width:${wr.width}px;height:${wr.height}px;pointer-events:all;`;

  const applyClip = () => {
    ui.style.clipPath = `inset(${crop.t}% ${crop.r}% ${crop.b}% ${crop.l}%)`;
    const shadeTop    = document.getElementById('_vc_shade_t'); if(shadeTop) shadeTop.style.height = crop.t + '%';
    const shadeRight  = document.getElementById('_vc_shade_r'); if(shadeRight) shadeRight.style.width = crop.r + '%';
    const shadeBottom = document.getElementById('_vc_shade_b'); if(shadeBottom) shadeBottom.style.height = crop.b + '%';
    const shadeLeft   = document.getElementById('_vc_shade_l'); if(shadeLeft) shadeLeft.style.width = crop.l + '%';
  };

  // Shade layers
  [['t','top:0;left:0;right:0','_vc_shade_t'],['r','top:0;right:0;bottom:0','_vc_shade_r'],
   ['b','bottom:0;left:0;right:0','_vc_shade_b'],['l','top:0;left:0;bottom:0','_vc_shade_l']].forEach(([key, pos, id]) => {
    const s = document.createElement('div');
    s.id = id;
    s.style.cssText = `position:absolute;${pos};background:rgba(0,0,0,.55);pointer-events:none;`;
    if (key==='t'||key==='b') s.style.height = crop[key]+'%';
    else s.style.width = crop[key]+'%';
    ui.appendChild(s);
  });

  // Crop border
  const border = document.createElement('div');
  border.style.cssText = `position:absolute;border:2px dashed #fff;box-sizing:border-box;
    left:${crop.l}%;top:${crop.t}%;right:${crop.r}%;bottom:${crop.b}%;pointer-events:none;`;
  ui.appendChild(border);

  // Edge handles
  [['t','top:-4px;left:50%;transform:translateX(-50%)','ns-resize'],
   ['r','right:-4px;top:50%;transform:translateY(-50%)','ew-resize'],
   ['b','bottom:-4px;left:50%;transform:translateX(-50%)','ns-resize'],
   ['l','left:-4px;top:50%;transform:translateY(-50%)','ew-resize']].forEach(([side, pos, cur]) => {
    const h = document.createElement('div');
    h.style.cssText = `position:absolute;${pos};width:12px;height:12px;background:#fff;border-radius:50%;cursor:${cur};z-index:5;`;
    h.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const startCoord = side==='t'||side==='b' ? ev.clientY : ev.clientX;
      const initVal = crop[side];
      const dim = side==='t'||side==='b' ? wr.height : wr.width;
      const sign = side==='b'||side==='r' ? -1 : 1;
      const onM = em => {
        const delta = (em[side==='t'||side==='b'?'clientY':'clientX'] - startCoord) / dim * 100;
        crop[side] = Math.max(0, Math.min(45, initVal + sign * delta));
        border.style.left = crop.l+'%'; border.style.top = crop.t+'%';
        border.style.right = crop.r+'%'; border.style.bottom = crop.b+'%';
        applyClip();
      };
      const onU = () => { document.removeEventListener('mousemove',onM); document.removeEventListener('mouseup',onU); };
      document.addEventListener('mousemove',onM); document.addEventListener('mouseup',onU);
    });
    ui.appendChild(h);
  });

  // Done / Reset buttons
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;bottom:-34px;left:50%;transform:translateX(-50%);display:flex;gap:6px;white-space:nowrap;';
  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-sm'; doneBtn.textContent = 'Apply Crop';
  doneBtn.addEventListener('click', () => {
    item.cropT = crop.t; item.cropR = crop.r; item.cropB = crop.b; item.cropL = crop.l;
    const img = wrap.querySelector('.ved-img-el');
    if (img) img.style.clipPath = (item.cropT||item.cropR||item.cropB||item.cropL)
      ? `inset(${item.cropT}% ${item.cropR}% ${item.cropB}% ${item.cropL}%)` : '';
    ui.remove(); vedRenderInspector();
  });
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-outline'; resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => {
    crop.t = crop.r = crop.b = crop.l = 0; applyClip();
    border.style.left = '0'; border.style.top = '0'; border.style.right = '0'; border.style.bottom = '0';
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-outline'; cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => ui.remove());
  bar.appendChild(doneBtn); bar.appendChild(resetBtn); bar.appendChild(cancelBtn);
  ui.appendChild(bar);

  applyClip();
  c.appendChild(ui);
}

function _vedUpdateImgOverlays(elapsed) {
  const c = document.getElementById('ved-img-overlays');
  if (!c) return;

  const clips = VED.photoClips || [];

  clips.forEach(item => {
    const tS    = item.tStart ?? 0;
    const tE    = item.tEnd   ?? (tS + _VED_PHOTO_DEFAULT_DUR);
    const isSel = item.uid === VED.selectedClip;
    // Always show the selected clip so the user can edit it regardless of playhead
    const vis   = (elapsed >= tS && elapsed < tE) || isSel;

    let wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
    if (!wrap) { wrap = _vedImgCreateOverlay(item); c.appendChild(wrap); }

    wrap.style.display  = vis ? '' : 'none';
    wrap.style.zIndex   = isSel ? '5' : '1';
    // Dim the image when it's only shown because it's selected (not in its time window)
    wrap.style.outline  = isSel && !(elapsed >= tS && elapsed < tE)
      ? '2px dashed var(--accent)' : '';

    if (vis) _vedImgApplyStyle(wrap, item);
    wrap.classList.toggle('ved-img-sel', isSel);

    // Apply saved crop to img element
    const imgEl = wrap.querySelector('.ved-img-el');
    if (imgEl) {
      imgEl.style.clipPath = (item.cropT||item.cropR||item.cropB||item.cropL)
        ? `inset(${item.cropT??0}% ${item.cropR??0}% ${item.cropB??0}% ${item.cropL??0}%)`
        : '';
    }
  });

  // Remove overlays for deleted clips
  c.querySelectorAll('.ved-img-wrap').forEach(el => {
    if (!clips.find(x => x.uid === el.dataset.uid)) el.remove();
  });
}

function _vedUpdateSeekbar() {
  const playhead = document.getElementById('ved-tl-playhead');
  const curEl    = document.getElementById('ved-tl-cur');
  const totEl    = document.getElementById('ved-tl-total');
  const pps      = _vedPPS();
  const elapsed  = _vedSeqElapsed();
  const total    = _vedTotalDur();
  if (playhead) playhead.style.left = (elapsed * pps) + 'px';
  if (curEl)    curEl.textContent   = fmtTS(Math.floor(elapsed));
  if (totEl)    totEl.textContent   = fmtTS(Math.floor(total));
  _vedUpdateImgOverlays(elapsed);
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

function _vedImgOnlyTick() {
  const total = _vedTotalDur();
  const elapsed = _vedSeqElapsed();
  _vedUpdateSeekbar();
  if (elapsed >= total) {
    VED.seqPlaying    = false;
    VED.imgPlayOffset = 0;
    VED.imgPlayT0     = 0;
    VED.imgRafId      = null;
    _vedSetPlayIcon(false);
    _vedUpdateSeekbar();
    return;
  }
  VED.imgRafId = requestAnimationFrame(_vedImgOnlyTick);
}

function vedTlPlayPause() {
  const video    = document.getElementById('ved-preview-video');
  const audio    = document.getElementById('ved-preview-audio');
  const hasVideo = VED.sequence.length > 0;
  const hasImgs  = (VED.photoClips || []).length > 0;

  if (!hasVideo && !hasImgs) return;

  if (!hasVideo) {
    // Image-only playback driven by rAF timer
    if (VED.seqPlaying) {
      VED.imgPlayOffset = _vedSeqElapsed();
      VED.seqPlaying    = false;
      VED.imgPlayT0     = 0;
      if (VED.imgRafId) { cancelAnimationFrame(VED.imgRafId); VED.imgRafId = null; }
      _vedSetPlayIcon(false);
    } else {
      const total = _vedTotalDur();
      if (VED.imgPlayOffset >= total) VED.imgPlayOffset = 0;
      VED.imgPlayT0  = performance.now();
      VED.seqPlaying = true;
      _vedSetPlayIcon(true);
      VED.imgRafId   = requestAnimationFrame(_vedImgOnlyTick);
    }
    return;
  }

  if (!video) return;
  if (!video.paused) {
    video.pause();
    audio?.pause();
    _vedSetPlayIcon(false);
    return;
  }
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

  // ── Image clip inspector ──
  if (track === 'photo') {
    if (title) title.textContent = `Image ${i + 1} of ${n}`;
    const tS      = item.tStart  ?? 0;
    const tE      = item.tEnd    ?? (tS + _VED_PHOTO_DEFAULT_DUR);
    const dur     = Math.max(0.1, tE - tS);
    const maxPos  = Math.max(60, _vedSeqTotal() + 30);
    const scale   = item.scale   ?? 1;
    const x       = item.x       ?? 0.5;
    const y       = item.y       ?? 0.5;
    const opacity = item.opacity ?? 1;
    const uid     = item.uid;

    const _upd = `const c=VED.photoClips.find(x=>x.uid==='${uid}');if(!c)return;`;
    const _ref = `_vedUpdateImgOverlays(_vedSeqElapsed());`;

    body.innerHTML = `
      <div class="ved-insp-track-tag">
        <svg class="icon icon-sm"><use href="#i-img"/></svg>
        Image overlay
      </div>
      <div class="ved-insp-name" title="${item.name || ''}">${item.name || item.uploadId}</div>
      <img src="/api/uploads/stream/${item.uploadId}"
           style="width:100%;border-radius:6px;max-height:68px;object-fit:contain;background:var(--surface-2);margin:6px 0 10px;display:block">

      <div class="ved-insp-section-lbl">Timing</div>
      <div class="ved-insp-row" style="flex-direction:column;gap:6px">
        <div class="ved-insp-field">
          <label class="ved-insp-lbl">Appears at — <span id="ii-at">${fmtTS(Math.round(tS))}</span></label>
          <input type="range" class="ved-insp-range" min="0" max="${maxPos}" step="0.5" value="${tS.toFixed(1)}"
            oninput="${_upd}const d=${dur.toFixed(3)},v=+this.value;c.tStart=v;c.tEnd=v+d;document.getElementById('ii-at').textContent=fmtTS(Math.round(v));vedRenderPhotoTrack()">
        </div>
        <div class="ved-insp-field">
          <label class="ved-insp-lbl">Show for — <span id="ii-dur">${dur.toFixed(1)}s</span></label>
          <input type="range" class="ved-insp-range" min="0.5" max="30" step="0.5" value="${dur.toFixed(1)}"
            oninput="${_upd}const v=+this.value;c.tEnd=c.tStart+v;document.getElementById('ii-dur').textContent=v.toFixed(1)+'s';vedRenderPhotoTrack()">
        </div>
      </div>

      <div class="ved-insp-section-lbl" style="margin-top:10px">Transform</div>
      <div class="ved-insp-row" style="flex-direction:column;gap:6px">
        <div class="ved-insp-field">
          <label class="ved-insp-lbl">Scale — <span id="ii-sc">${Math.round(scale*100)}%</span></label>
          <input type="range" class="ved-insp-range" min="0.05" max="2" step="0.05" value="${scale}"
            oninput="${_upd}c.scale=+this.value;document.getElementById('ii-sc').textContent=Math.round(+this.value*100)+'%';${_ref}">
        </div>
        <div class="ved-insp-field">
          <label class="ved-insp-lbl">Position X — <span id="ii-x">${Math.round(x*100)}%</span></label>
          <input type="range" class="ved-insp-range" min="0" max="1" step="0.01" value="${x}"
            oninput="${_upd}c.x=+this.value;document.getElementById('ii-x').textContent=Math.round(+this.value*100)+'%';${_ref}">
        </div>
        <div class="ved-insp-field">
          <label class="ved-insp-lbl">Position Y — <span id="ii-y">${Math.round(y*100)}%</span></label>
          <input type="range" class="ved-insp-range" min="0" max="1" step="0.01" value="${y}"
            oninput="${_upd}c.y=+this.value;document.getElementById('ii-y').textContent=Math.round(+this.value*100)+'%';${_ref}">
        </div>
        <div class="ved-insp-field">
          <label class="ved-insp-lbl">Opacity — <span id="ii-op">${Math.round(opacity*100)}%</span></label>
          <input type="range" class="ved-insp-range" min="0" max="1" step="0.01" value="${opacity}"
            oninput="${_upd}c.opacity=+this.value;document.getElementById('ii-op').textContent=Math.round(+this.value*100)+'%';${_ref}">
        </div>
        <div class="ved-insp-field" style="flex-direction:row;gap:8px;align-items:center">
          <label class="ved-insp-lbl" style="flex:0 0 auto;margin:0">Flip</label>
          <button id="ii-fh" class="btn-sm${item.flipH ? ' btn-sm--active' : ''}"
            onclick="${_upd}c.flipH=!c.flipH;this.classList.toggle('btn-sm--active',c.flipH);${_ref}">↔ H</button>
          <button id="ii-fv" class="btn-sm${item.flipV ? ' btn-sm--active' : ''}"
            onclick="${_upd}c.flipV=!c.flipV;this.classList.toggle('btn-sm--active',c.flipV);${_ref}">↕ V</button>
          <button class="btn-sm" title="Reset all transforms"
            onclick="${_upd}c.scale=1;c.x=0.5;c.y=0.5;c.opacity=1;c.flipH=false;c.flipV=false;vedRenderInspector();${_ref}">Reset</button>
        </div>
      </div>

      <div class="ved-insp-actions" style="margin-top:10px">
        <button class="btn-icon" title="Remove" onclick="vedRemoveFromPhotoSeq('${uid}')">
          <svg class="icon icon-sm" style="color:var(--danger)"><use href="#i-trash"/></svg>
        </button>
      </div>`;
    return;
  }

  // ── Video / Audio clip inspector ──
  if (title) title.textContent = `${track === 'audio' ? 'Audio ' : ''}Clip ${i + 1} of ${n}`;

  const reRenderFn  = track === 'audio' ? 'vedRenderAudioTrack()' : 'vedRenderSequence()';
  const removeFn    = track === 'audio' ? 'vedRemoveFromAudioSeq' : 'vedRemoveFromSeq';
  const moveFn      = track === 'audio' ? 'vedMoveAudioClip'      : 'vedMoveSeq';
  const trackIcon   = track === 'audio' ? '#i-vol' : '#i-film';
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
        upload_id:  p.uploadId,
        time_start: p.tStart  ?? 0,
        time_end:   p.tEnd    ?? ((p.tStart ?? 0) + _VED_PHOTO_DEFAULT_DUR),
        is_image:   true,
        scale:      p.scale   ?? 1,
        x:          p.x       ?? 0.5,
        y:          p.y       ?? 0.5,
        opacity:    p.opacity ?? 1,
        flip_h:     p.flipH   ?? false,
        flip_v:     p.flipV    ?? false,
        rotation:   p.rotation ?? 0,
        crop_t:     p.cropT   ?? 0,
        crop_r:     p.cropR   ?? 0,
        crop_b:     p.cropB   ?? 0,
        crop_l:     p.cropL   ?? 0,
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
