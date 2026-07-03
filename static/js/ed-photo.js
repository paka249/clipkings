'use strict';

// ── Photo track ───────────────────────────────────────────────
function vedAddPhotoToSeq(uploadId) {
  const entry = VED.library.find(f => f.id === uploadId);
  if (!entry) return;
  if (VED.photoClips.length >= _VED_MAX_IMG) {
    _modal({ icon: 'warn', iconColor: 'danger', title: 'Image track full',
      msg: `Max ${_VED_MAX_IMG} image clips in the timeline. Remove one to add another.` });
    return;
  }
  const newUid = Math.random().toString(36).slice(2, 8);
  _vedSnapshot();
  const tStart = (VED.photoClips || []).reduce((m, c) => Math.max(m, c.tEnd ?? 0), _vedSeqTotal());
  VED.photoClips.push({
    uid:      newUid,
    uploadId: entry.id,
    name:     entry.name || entry.original_name || entry.id,
    tStart,
    tEnd:     tStart + _VED_PHOTO_DEFAULT_DUR,
    is_image: true,
    scale:    0.8, x: 0.5, y: 0.5, opacity: 1,
    rotation: 0, flipH: false, flipV: false,
    cropT: 0, cropR: 0, cropB: 0, cropL: 0,
  });
  _vedRenderRuler();
  vedRenderPhotoTrack();
  vedSelectClip(newUid, 'photo');
  _vedUpdatePlaceholder();
}

function vedRemoveFromPhotoSeq(uid) {
  _vedSnapshot();
  VED.photoClips = VED.photoClips.filter(c => c.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  _vedRenderRuler();
  vedRenderPhotoTrack();
  _vedUpdatePlaceholder();
}

function _vedMakeImageHandle(item, side, block) {
  const handle = document.createElement('div');
  handle.className = `ved-tl-clip-handle ved-tl-clip-handle-${side}`;
  const bar = document.createElement('div');
  bar.className = 'ved-tl-clip-handle-bar';
  handle.appendChild(bar);

  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault();
    vedSelectClip(item.uid, 'photo');
    const startX = e.pageX, initTS = item.tStart, initTE = item.tEnd;
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

function _vedAssignLanes(clips) {
  const laneEnd = [];
  const sorted  = clips.slice().sort((a, b) => (a.tStart ?? 0) - (b.tStart ?? 0));
  sorted.forEach(clip => {
    const tS = clip.tStart ?? 0;
    let lane = 0;
    while (lane < laneEnd.length && laneEnd[lane] > tS + 0.05) lane++;
    clip._lane = lane;
    laneEnd[lane] = clip.tEnd ?? (tS + _VED_PHOTO_DEFAULT_DUR);
  });
  return Math.max(1, laneEnd.length);
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
    const trackDiv = row.closest('.ved-tl-track--photo');
    const labelEl  = document.querySelector('.ved-tl-label-photo');
    if (trackDiv) trackDiv.style.height = '';
    if (labelEl)  labelEl.style.height  = '';
    return;
  }

  const LANE_H   = 36;
  const numLanes = _vedAssignLanes(VED.photoClips);
  const trackH   = numLanes * LANE_H + 8;
  const trackDiv = row.closest('.ved-tl-track--photo');
  const labelEl  = document.querySelector('.ved-tl-label-photo');
  if (trackDiv) trackDiv.style.height = trackH + 'px';
  if (labelEl)  labelEl.style.height  = trackH + 'px';

  const pps = _vedPPS();
  VED.photoClips.forEach((item, i) => {
    const tS    = item.tStart ?? 0;
    const tE    = item.tEnd   ?? (tS + _VED_PHOTO_DEFAULT_DUR);
    const dur   = Math.max(0.1, tE - tS);
    const isSel = item.uid === VED.selectedClip;
    const lane  = item._lane ?? 0;

    const block = document.createElement('div');
    block.dataset.uid = item.uid;
    block.className   = 'ved-tl-clip ved-tl-clip--photo' + (isSel ? ' ved-tl-clip--sel' : '');
    block.style.cssText = `left:${tS * pps}px;width:${dur * pps}px;top:${4 + lane * LANE_H}px;height:${LANE_H - 8}px;bottom:auto;cursor:grab`;

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

    block.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ved-tl-clip-handle')) return;
      e.preventDefault(); e.stopPropagation();
      const wasSelected = VED.selectedClip === item.uid;
      if (!wasSelected) vedSelectClip(item.uid, 'photo');
      const live    = document.querySelector(`#ved-tl-photo-row [data-uid="${item.uid}"]`) || block;
      const startX  = e.pageX;
      const initTS  = item.tStart;
      const clipDur = item.tEnd - item.tStart;
      let moved = false;

      const onMove = (ev) => {
        if (!moved && Math.abs(ev.pageX - startX) < 3) return;
        if (!moved) live.classList.add('ved-tl-clip--lift');
        moved = true;
        const dt = (ev.pageX - startX) / _vedPPS();
        item.tStart = Math.max(0, initTS + dt);
        item.tEnd   = item.tStart + clipDur;
        live.style.left = (item.tStart * _vedPPS()) + 'px';
        const infoBot = live.querySelector('.ved-tl-clip-dur');
        if (infoBot) infoBot.textContent = `${fmtTS(Math.round(item.tStart))}–${fmtTS(Math.round(item.tEnd))}`;
        vedRenderInspector();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        live.classList.remove('ved-tl-clip--lift');
        if (!moved && wasSelected) { vedCloseInspector(); return; }
        if (moved) { _vedRenderRuler(); vedRenderPhotoTrack(); }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    row.appendChild(block);
  });
}

// ── Image canvas overlays ─────────────────────────────────────
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
  wrap.className   = 'ved-img-wrap';
  wrap.dataset.uid = item.uid;

  const img = document.createElement('img');
  img.src       = `/api/uploads/stream/${item.uploadId}`;
  img.draggable = false;
  img.className = 'ved-img-el';
  if (item.cropT || item.cropR || item.cropB || item.cropL) {
    img.style.clipPath = `inset(${item.cropT??0}% ${item.cropR??0}% ${item.cropB??0}% ${item.cropL??0}%)`;
  }
  wrap.appendChild(img);

  ['nw','ne','se','sw'].forEach(pos => {
    const h = document.createElement('div');
    h.className = 'ved-img-corner ved-img-corner--' + pos;
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      _vedImgScaleStart(e, item, pos);
    });
    wrap.appendChild(h);
  });

  const rotHandle = document.createElement('div');
  rotHandle.className = 'ved-img-rot-handle';
  rotHandle.title = 'Drag to rotate';
  rotHandle.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>';
  rotHandle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    _vedImgRotateStart(e, item);
  });
  wrap.appendChild(rotHandle);

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
  const sign      = (corner === 'ne' || corner === 'se') ? 1 : -1;
  const wrap      = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);

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
  c.querySelectorAll('.ved-crop-ui').forEach(el => el.remove());

  const wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
  if (!wrap) return;
  const wr = wrap.getBoundingClientRect();
  const cr = c.getBoundingClientRect();

  const crop = { t: item.cropT ?? 0, r: item.cropR ?? 0, b: item.cropB ?? 0, l: item.cropL ?? 0 };

  const ui = document.createElement('div');
  ui.className = 'ved-crop-ui';
  ui.style.cssText = `position:absolute;left:${wr.left-cr.left}px;top:${wr.top-cr.top}px;width:${wr.width}px;height:${wr.height}px;pointer-events:all;z-index:30;box-sizing:border-box;`;

  const shTop = document.createElement('div');
  const shBot = document.createElement('div');
  const shL   = document.createElement('div');
  const shR   = document.createElement('div');
  const SH = 'position:absolute;background:rgba(0,0,0,.62);pointer-events:none;';
  shTop.style.cssText = SH + 'top:0;left:0;right:0;';
  shBot.style.cssText = SH + 'bottom:0;left:0;right:0;';
  shL.style.cssText   = SH + 'left:0;';
  shR.style.cssText   = SH + 'right:0;';
  ui.appendChild(shTop); ui.appendChild(shBot);
  ui.appendChild(shL);   ui.appendChild(shR);

  const border = document.createElement('div');
  border.style.cssText = 'position:absolute;border:2px dashed rgba(255,255,255,.9);box-sizing:border-box;pointer-events:none;z-index:2;';
  ui.appendChild(border);

  const handles = {};
  const redraw = () => {
    shTop.style.height = crop.t + '%';
    shBot.style.height = crop.b + '%';
    shL.style.top = crop.t + '%'; shL.style.bottom = crop.b + '%'; shL.style.width = crop.l + '%';
    shR.style.top = crop.t + '%'; shR.style.bottom = crop.b + '%'; shR.style.width = crop.r + '%';
    border.style.left = crop.l + '%'; border.style.top    = crop.t + '%';
    border.style.right = crop.r + '%'; border.style.bottom = crop.b + '%';
    const cx = crop.l + (100 - crop.l - crop.r) / 2;
    const cy = crop.t + (100 - crop.t - crop.b) / 2;
    if (handles.t) { handles.t.style.left = cx + '%';           handles.t.style.top    = crop.t + '%'; }
    if (handles.b) { handles.b.style.left = cx + '%';           handles.b.style.top    = (100-crop.b) + '%'; }
    if (handles.l) { handles.l.style.left = crop.l + '%';       handles.l.style.top    = cy + '%'; }
    if (handles.r) { handles.r.style.left = (100-crop.r) + '%'; handles.r.style.top    = cy + '%'; }
  };

  [['t','ns-resize'],['r','ew-resize'],['b','ns-resize'],['l','ew-resize']].forEach(([side, cur]) => {
    const h = document.createElement('div');
    h.style.cssText = `position:absolute;width:12px;height:12px;background:#fff;border:2px solid var(--accent);border-radius:50%;cursor:${cur};z-index:5;transform:translate(-50%,-50%);`;
    handles[side] = h;
    ui.appendChild(h);

    h.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const isV  = side === 't' || side === 'b';
      const start = isV ? ev.clientY : ev.clientX;
      const init  = crop[side];
      const dim   = isV ? wr.height : wr.width;
      const sign  = (side === 'b' || side === 'r') ? -1 : 1;
      const onM = em => {
        const delta = ((isV ? em.clientY : em.clientX) - start) / dim * 100;
        crop[side] = Math.max(0, Math.min(45, init + sign * delta));
        redraw();
      };
      const onU = () => {
        document.removeEventListener('mousemove', onM);
        document.removeEventListener('mouseup',   onU);
      };
      document.addEventListener('mousemove', onM);
      document.addEventListener('mouseup',   onU);
    });
  });

  redraw();

  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:10;white-space:nowrap;';

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-sm'; doneBtn.style.fontSize = '.75rem';
  doneBtn.textContent = '✓ Apply Crop';
  doneBtn.addEventListener('click', () => {
    _vedSnapshot();
    item.cropT = crop.t; item.cropR = crop.r; item.cropB = crop.b; item.cropL = crop.l;
    const imgEl = wrap.querySelector('.ved-img-el');
    if (imgEl) imgEl.style.clipPath = (crop.t || crop.r || crop.b || crop.l)
      ? `inset(${crop.t}% ${crop.r}% ${crop.b}% ${crop.l}%)` : '';
    ui.remove();
    vedRenderInspector();
  });

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-outline'; resetBtn.style.fontSize = '.75rem';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => { crop.t = crop.r = crop.b = crop.l = 0; redraw(); });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-outline'; cancelBtn.style.fontSize = '.75rem';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => ui.remove());

  bar.appendChild(doneBtn); bar.appendChild(resetBtn); bar.appendChild(cancelBtn);
  ui.appendChild(bar);
  c.appendChild(ui);
}

function _vedUpdateImgOverlays(elapsed) {
  const c = document.getElementById('ved-img-overlays');
  if (!c) return;
  const clips = VED.photoClips || [];

  clips.forEach(item => {
    const tS     = item.tStart ?? 0;
    const tE     = item.tEnd   ?? (tS + _VED_PHOTO_DEFAULT_DUR);
    const isSel  = item.uid === VED.selectedClip;
    const inRange = elapsed >= tS && elapsed < tE;

    let wrap = c.querySelector(`.ved-img-wrap[data-uid="${item.uid}"]`);
    if (!wrap) { wrap = _vedImgCreateOverlay(item); c.appendChild(wrap); }

    wrap.style.display = inRange ? '' : 'none';
    wrap.style.zIndex  = isSel ? '5' : '1';
    wrap.style.outline = '';
    if (inRange) _vedImgApplyStyle(wrap, item);
    wrap.classList.toggle('ved-img-sel', isSel && inRange);

    const imgEl = wrap.querySelector('.ved-img-el');
    if (imgEl) {
      imgEl.style.clipPath = (item.cropT||item.cropR||item.cropB||item.cropL)
        ? `inset(${item.cropT??0}% ${item.cropR??0}% ${item.cropB??0}% ${item.cropL??0}%)`
        : '';
    }
  });

  c.querySelectorAll('.ved-img-wrap').forEach(el => {
    if (!clips.find(x => x.uid === el.dataset.uid)) el.remove();
  });
}
