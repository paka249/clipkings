'use strict';

// ── Caption rotate handle (canvas overlay) ────────────────────
function _vedCapRotateStart(e, item) {
  const c = document.getElementById('ved-cap-overlays');
  if (!c) return;
  const wrap = c.querySelector(`.ved-cap-wrap[data-uid="${item.uid}"]`);
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;
  const cRect = c.getBoundingClientRect();
  const onMove = ev => {
    const deg = Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180 / Math.PI;
    item.rotation = Math.round(deg);
    _vedCapApplyStyle(wrap, item, cRect);
    const lbl = document.getElementById('ci-rot');
    if (lbl) lbl.textContent = item.rotation + '°';
    const sl = document.querySelector('#ved-inspector-body input[type=range][min="-180"]');
    if (sl) sl.value = item.rotation;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

// ── Caption track ─────────────────────────────────────────────
function vedAddCaption() {
  const uid = 'cap-' + Math.random().toString(36).slice(2, 8);
  const t   = Math.max(0, Math.min(_vedSeqElapsed(), Math.max(0, _vedTotalDur() - 3)));
  _vedSnapshot();
  VED.captions.push({
    uid, text: 'Caption', tStart: t, tEnd: t + 3,
    x: 0.5, y: 0.82, fontSizePct: 5, rotation: 0,
    fontFamily: 'Impact', color: '#FFFFFF', bgColor: '',
    bold: false, italic: false, align: 'center', shadow: true, width: 0.75,
  });
  vedSelectCaption(uid);
  _vedRenderRuler();
  _vedUpdatePlaceholder();
}

function vedSelectCaption(uid) {
  VED.selectedClip  = uid;
  VED.selectedTrack = 'caption';
  const cap = (VED.captions || []).find(c => c.uid === uid);
  if (cap) _vedSeekElapsed(cap.tStart ?? 0);
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
  vedRenderCaptionTrack();
  vedRenderInspector();
  _vedUpdateCaptionOverlays(_vedSeqElapsed());
}

function vedRemoveCaption(uid) {
  _vedSnapshot();
  VED.captions = VED.captions.filter(c => c.uid !== uid);
  if (VED.selectedClip === uid) { VED.selectedClip = null; VED.selectedTrack = 'video'; }
  vedRenderCaptionTrack();
  vedRenderInspector();
  _vedUpdateCaptionOverlays(_vedSeqElapsed());
  _vedRenderRuler();
  _vedUpdatePlaceholder();
}

function _vedMakeCaptionHandle(item, side, block) {
  const handle = document.createElement('div');
  handle.className = `ved-tl-clip-handle ved-tl-clip-handle-${side}`;
  const bar = document.createElement('div');
  bar.className = 'ved-tl-clip-handle-bar';
  handle.appendChild(bar);
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const startX = e.pageX, initTS = item.tStart, initTE = item.tEnd;
    const onMove = (ev) => {
      const delta = (ev.pageX - startX) / _vedPPS();
      if (side === 'l') {
        item.tStart = Math.max(0, Math.min(initTE - 0.1, initTS + delta));
        block.style.left  = (item.tStart * _vedPPS()) + 'px';
        block.style.width = ((item.tEnd - item.tStart) * _vedPPS()) + 'px';
      } else {
        item.tEnd = Math.max(item.tStart + 0.1, initTE + delta);
        block.style.width = ((item.tEnd - item.tStart) * _vedPPS()) + 'px';
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      vedRenderCaptionTrack();
      vedRenderInspector();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
  return handle;
}

function vedRenderCaptionTrack() {
  const row = document.getElementById('ved-tl-caption-row');
  if (!row) return;
  row.innerHTML = '';
  const caps = VED.captions || [];
  if (!caps.length) {
    const hint = document.createElement('span');
    hint.className   = 'ved-tl-empty-hint';
    hint.textContent = 'Click + to add a caption';
    row.appendChild(hint);
    return;
  }
  const pps = _vedPPS();
  caps.forEach(item => {
    const tS    = item.tStart ?? 0;
    const tE    = item.tEnd   ?? (tS + 3);
    const dur   = Math.max(0.1, tE - tS);
    const isSel = item.uid === VED.selectedClip;
    const block = document.createElement('div');
    block.className = 'ved-tl-clip ved-tl-clip--caption' + (isSel ? ' ved-tl-clip--sel' : '');
    block.style.cssText = `left:${tS * pps}px;width:${dur * pps}px;cursor:grab`;

    const label = document.createElement('div');
    label.className = 'ved-tl-clip-info';
    label.innerHTML = `
      <div class="ved-tl-clip-info-top">
        <span class="ved-tl-clip-idx" style="background:rgba(168,85,247,.8)">T</span>
        <span class="ved-tl-clip-nm" style="font-style:italic">${esc((item.text||'Caption').slice(0,28))}</span>
      </div>
      <div class="ved-tl-clip-info-bot">
        <span class="ved-tl-clip-dur">${fmtTS(Math.round(tS))}–${fmtTS(Math.round(tE))}</span>
      </div>`;
    block.appendChild(label);
    block.appendChild(_vedMakeCaptionHandle(item, 'l', block));
    block.appendChild(_vedMakeCaptionHandle(item, 'r', block));

    block.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ved-tl-clip-handle')) return;
      e.preventDefault(); e.stopPropagation();
      if (VED.selectedClip !== item.uid) vedSelectCaption(item.uid);
      const startX = e.pageX, initTS = item.tStart, clipDur = item.tEnd - item.tStart;
      let moved = false;
      const onMove = (ev) => {
        if (!moved && Math.abs(ev.pageX - startX) < 3) return;
        if (!moved) block.classList.add('ved-tl-clip--lift');
        moved = true;
        item.tStart = Math.max(0, initTS + (ev.pageX - startX) / _vedPPS());
        item.tEnd   = item.tStart + clipDur;
        block.style.left = (item.tStart * _vedPPS()) + 'px';
        const infoBot = block.querySelector('.ved-tl-clip-dur');
        if (infoBot) infoBot.textContent = `${fmtTS(Math.round(item.tStart))}–${fmtTS(Math.round(item.tEnd))}`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        block.classList.remove('ved-tl-clip--lift');
        block.style.cursor = 'grab';
        if (!moved && VED.selectedClip === item.uid) { vedCloseInspector(); return; }
        vedRenderCaptionTrack();
        vedRenderInspector();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
    row.appendChild(block);
  });
}

// ── Caption overlays (canvas) ─────────────────────────────────
function _vedCapApplyStyle(wrap, item, cRect) {
  const h     = (cRect && cRect.height) ? cRect.height : 400;
  const fSize = Math.max(8, Math.round((item.fontSizePct || 5) / 100 * h));
  const inner = wrap.querySelector('.ved-cap-text');
  const rot = item.rotation ?? 0;
  wrap.style.left      = ((item.x     ?? 0.5)  * 100) + '%';
  wrap.style.top       = ((item.y     ?? 0.82) * 100) + '%';
  wrap.style.width     = ((item.width ?? 0.75) * 100) + '%';
  wrap.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
  wrap.style.textAlign = item.align || 'center';
  if (inner) {
    inner.style.fontSize     = fSize + 'px';
    inner.style.fontFamily   = item.fontFamily || 'Impact';
    inner.style.color        = item.color      || '#FFFFFF';
    inner.style.fontWeight   = item.bold   ? '700' : '400';
    inner.style.fontStyle    = item.italic ? 'italic' : 'normal';
    inner.style.textShadow   = (item.shadow !== false)
      ? '2px 2px 4px rgba(0,0,0,.95),-1px -1px 2px rgba(0,0,0,.8)' : 'none';
    inner.style.background   = item.bgColor || '';
    inner.style.padding      = item.bgColor ? '3px 10px' : '0';
    inner.style.borderRadius = item.bgColor ? '4px' : '0';
    inner.textContent        = item.text || '';
  }
}

function _vedCapCreateOverlay(item, cRect) {
  const wrap = document.createElement('div');
  wrap.className   = 'ved-cap-wrap';
  wrap.dataset.uid = item.uid;

  const inner = document.createElement('div');
  inner.className = 'ved-cap-text';
  wrap.appendChild(inner);

  const rotH = document.createElement('div');
  rotH.className = 'ved-cap-rot-handle';
  rotH.title = 'Drag to rotate';
  rotH.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>';
  rotH.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    _vedCapRotateStart(e, item);
  });
  wrap.appendChild(rotH);

  const rh = document.createElement('div');
  rh.className = 'ved-cap-resize';
  rh.title = 'Drag to resize font';
  rh.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const c       = document.getElementById('ved-cap-overlays');
    const cr      = c.getBoundingClientRect();
    const startY  = e.clientY;
    const initPct = item.fontSizePct || 5;
    const onMove  = ev => {
      const dy = ev.clientY - startY;
      item.fontSizePct = Math.max(1, Math.min(20, initPct + dy / cr.height * 100));
      _vedCapApplyStyle(wrap, item, cr);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      vedRenderInspector();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
  wrap.appendChild(rh);

  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.ved-cap-resize')) return;
    e.preventDefault(); e.stopPropagation();
    if (VED.selectedClip !== item.uid) vedSelectCaption(item.uid);
    const c  = document.getElementById('ved-cap-overlays');
    const cr = c.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const ix = item.x ?? 0.5, iy = item.y ?? 0.82;
    const onMove = ev => {
      item.x = Math.max(0, Math.min(1, ix + (ev.clientX - sx) / cr.width));
      item.y = Math.max(0, Math.min(1, iy + (ev.clientY - sy) / cr.height));
      _vedCapApplyStyle(wrap, item, cr);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      vedRenderInspector();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  _vedCapApplyStyle(wrap, item, cRect);
  return wrap;
}

function _vedUpdateCaptionOverlays(elapsed) {
  const c = document.getElementById('ved-cap-overlays');
  if (!c) return;
  const cRect = c.getBoundingClientRect();
  const sel   = VED.selectedTrack === 'caption';

  (VED.captions || []).forEach(item => {
    const tS      = item.tStart ?? 0;
    const tE      = item.tEnd   ?? (tS + 3);
    const isSel   = sel && item.uid === VED.selectedClip;
    const inRange = elapsed >= tS && elapsed < tE;

    let wrap = c.querySelector(`.ved-cap-wrap[data-uid="${item.uid}"]`);
    if (!wrap) { wrap = _vedCapCreateOverlay(item, cRect); c.appendChild(wrap); }

    wrap.style.display       = inRange ? '' : 'none';
    wrap.style.zIndex        = isSel ? '2' : '1';
    wrap.style.outline       = '';
    wrap.style.outlineOffset = '';
    wrap.classList.toggle('ved-cap-sel', isSel && inRange);

    if (inRange) _vedCapApplyStyle(wrap, item, cRect);
  });

  c.querySelectorAll('.ved-cap-wrap').forEach(el => {
    if (!(VED.captions || []).find(x => x.uid === el.dataset.uid)) el.remove();
  });
}
