'use strict';

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

// ── Video sequence ────────────────────────────────────────────
function vedAddToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  if (VED.sequence.length >= _VED_MAX_VIDEO) {
    _modal({ icon: 'warn', iconColor: 'danger', title: 'Video track full',
      msg: `Max ${_VED_MAX_VIDEO} video clips in the timeline. Remove one to add another.` });
    return;
  }
  const newUid = Math.random().toString(36).slice(2, 8);
  _vedSnapshot();
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
  if (!entry.duration) _vedDetectDuration(newUid, 'video', entry.id);
  vedRenderSequence();
  vedSelectClip(newUid);
  _vedUpdatePlaceholder();
}

function _vedDetectDuration(uid, track, uploadId) {
  const el = document.createElement(track === 'audio' ? 'audio' : 'video');
  el.preload = 'metadata';
  el.src     = `/api/uploads/stream/${uploadId}`;
  el.addEventListener('loadedmetadata', function once() {
    el.removeEventListener('loadedmetadata', once);
    const dur = el.duration;
    el.src = '';
    if (!dur || !isFinite(dur) || dur <= 0) return;
    const arr  = track === 'audio' ? VED.audioClips : VED.sequence;
    const item = arr.find(c => c.uid === uid);
    if (!item) return;
    item.duration = dur;
    if (item.end == null || item.end === 0) item.end = dur;
    const libEntry = VED.library.find(l => l.id === uploadId);
    if (libEntry) libEntry.duration = dur;
    if (track === 'audio') vedRenderAudioTrack();
    else vedRenderSequence();
    _vedRenderRuler();
    _vedUpdateSeekbar();
  });
}

function vedRemoveFromSeq(uid) {
  _vedSnapshot();
  VED.sequence = VED.sequence.filter(s => s.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  vedRenderSequence();
  _vedUpdatePlaceholder();
}

function vedMoveSeq(uid, dir) {
  const idx = VED.sequence.findIndex(s => s.uid === uid);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= VED.sequence.length) return;
  _vedSnapshot();
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

      block.onclick = (e) => { e.stopPropagation(); if (VED.selectedClip === item.uid) { vedCloseInspector(); return; } vedSelectClip(item.uid, 'video'); };
      block.ondragstart = (e) => {
        VED.dragUid = item.uid; VED.dragTrack = 'video';
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => block.classList.add('ved-tl-clip--lift'), 0);
      };
      block.ondragend = () => {
        VED.dragUid = null; VED.dragTrack = null;
        block.classList.remove('ved-tl-clip--lift');
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

  const hasAny = n > 0 || (VED.photoClips || []).length > 0;
  if (!hasAny) {
    if (status) { status.className = 'status-missing'; status.innerHTML = '<svg class="icon icon-sm"><use href="#i-warn"/></svg> Add at least one clip'; }
    if (btn) btn.disabled = true;
  } else {
    const totalSec = Math.max(
      VED.sequence.reduce((a, s) => a + _vedClipDur(s), 0),
      (VED.photoClips || []).reduce((m, p) => Math.max(m, p.tEnd ?? 0), 0)
    );
    const label = n > 0 ? `${n} video clip${n>1?'s':''}` : `${VED.photoClips.length} image${VED.photoClips.length>1?'s':''}`;
    if (status) { status.className = 'status-ready'; status.innerHTML = `<svg class="icon icon-sm"><use href="#i-check"/></svg> ${label} · ~${fmtTS(Math.floor(totalSec))}`; }
    if (btn) btn.disabled = false;
  }

  _vedRenderRuler();
  _vedUpdateSeekbar();
  vedRenderInspector();
}

// ── Video clip loading & playback ─────────────────────────────
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

let _vedAdvancing = false;

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
