'use strict';

// ── Clip selection & inspector ────────────────────────────────
function vedSelectClip(uid, track) {
  VED.seqPlaying    = false;
  VED.selectedClip  = uid;
  VED.selectedTrack = track || (
    VED.audioClips.find(s => s.uid === uid) ? 'audio' :
    VED.photoClips.find(s => s.uid === uid) ? 'photo' : 'video'
  );
  const idx = VED.sequence.findIndex(s => s.uid === uid);
  if (idx >= 0) VED.seqIdx = idx;
  if (VED.selectedTrack === 'photo') {
    const pc = VED.photoClips.find(c => c.uid === uid);
    if (pc) _vedSeekElapsed(pc.tStart ?? 0);
  } else {
    vedPreviewClip(uid);
  }
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
  vedRenderCaptionTrack();
  _vedUpdateImgOverlays(_vedSeqElapsed());
  _vedUpdateCaptionOverlays(_vedSeqElapsed());
  vedRenderInspector();
}

function vedCloseInspector() {
  VED.selectedClip  = null;
  VED.selectedTrack = 'video';
  vedPreviewClip(null);
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
  vedRenderCaptionTrack();
  vedRenderInspector();
}

function vedPreviewClip(uid) {
  const video       = document.getElementById('ved-preview-video');
  const placeholder = document.getElementById('ved-canvas-placeholder');
  if (!video) return;

  const item = VED.sequence.find(s => s.uid === uid) || VED.photoClips.find(s => s.uid === uid) || VED.audioClips.find(s => s.uid === uid);
  if (!item) {
    video.pause();
    video.style.display = 'none';
    _vedUpdatePlaceholder();
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

// ── Inspector panel ───────────────────────────────────────────
function vedRenderInspector() {
  const body  = document.getElementById('ved-inspector-body');
  const title = document.getElementById('ved-inspector-title');
  if (!body) return;

  const track = VED.selectedTrack;

  // ── Caption inspector ────────────────────────────────────────
  if (track === 'caption') {
    const cap = (VED.captions || []).find(c => c.uid === VED.selectedClip);
    if (!cap) {
      if (title) title.textContent = 'Properties';
      body.innerHTML = `<div class="ved-insp-empty"><svg class="icon icon-lg" style="color:var(--text-3)"><use href="#i-film"/></svg><div>Select a clip<br>to edit its properties</div></div>`;
      return;
    }
    if (title) title.textContent = 'Caption';
    const uid    = cap.uid;
    const _upd   = `const c=(VED.captions||[]).find(x=>x.uid==='${uid}');if(!c)return;`;
    const _ref   = `_vedUpdateCaptionOverlays(_vedSeqElapsed());`;
    const fsPct  = +(cap.fontSizePct || 5);
    const tS     = +(cap.tStart ?? 0);
    const tE     = +(cap.tEnd   ?? (tS + 3));
    const dur    = Math.max(0.5, tE - tS);
    const maxPos = Math.max(60, _vedTotalDur() + 30);

    body.innerHTML = `
      <div class="ved-insp-track-tag">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <rect x="2" y="7" width="20" height="10" rx="2"/><line x1="6" y1="11" x2="10" y2="11"/><line x1="6" y1="13.5" x2="14" y2="13.5"/>
        </svg>
        Caption overlay
      </div>
      <div class="ved-insp-section-lbl">Text</div>
      <textarea class="ved-cap-insp-ta" rows="3" placeholder="Caption text…"
        oninput="${_upd}c.text=this.value;${_ref}">${esc(cap.text || '')}</textarea>

      <div class="ved-insp-section-lbl" style="margin-top:10px">Timing</div>
      <div class="ved-insp-field">
        <label class="ved-insp-lbl">Appears at — <span id="ci-at">${fmtTS(Math.round(tS))}</span></label>
        <input type="range" class="ved-insp-range" min="0" max="${maxPos}" step="0.5" value="${tS.toFixed(1)}"
          oninput="${_upd}const d=(c.tEnd??c.tStart+3)-(c.tStart??0),v=+this.value;c.tStart=v;c.tEnd=v+d;document.getElementById('ci-at').textContent=fmtTS(Math.round(v));vedRenderCaptionTrack()">
      </div>
      <div class="ved-insp-field" style="margin-top:4px">
        <label class="ved-insp-lbl">Duration — <span id="ci-dur">${dur.toFixed(1)}s</span></label>
        <input type="range" class="ved-insp-range" min="0.5" max="30" step="0.5" value="${dur.toFixed(1)}"
          oninput="${_upd}const v=+this.value;c.tEnd=(c.tStart??0)+v;document.getElementById('ci-dur').textContent=v.toFixed(1)+'s';vedRenderCaptionTrack()">
      </div>

      <div class="ved-insp-section-lbl" style="margin-top:10px">Style</div>
      <div class="ved-insp-field">
        <label class="ved-insp-lbl">Font size — <span id="ci-fs">${fsPct.toFixed(1)}%</span></label>
        <input type="range" class="ved-insp-range" min="1" max="18" step="0.5" value="${fsPct}"
          oninput="${_upd}c.fontSizePct=+this.value;document.getElementById('ci-fs').textContent=(+this.value).toFixed(1)+'%';${_ref}">
      </div>
      <div class="ved-insp-field" style="margin-top:4px">
        <label class="ved-insp-lbl">Rotation — <span id="ci-rot">${(cap.rotation ?? 0).toFixed(0)}°</span></label>
        <input type="range" class="ved-insp-range" min="-180" max="180" step="1" value="${(cap.rotation ?? 0)}"
          oninput="${_upd}c.rotation=+this.value;document.getElementById('ci-rot').textContent=(+this.value).toFixed(0)+'°';${_ref}">
      </div>
      <div class="ved-insp-field" style="margin-top:4px;flex-direction:row;gap:8px;align-items:center">
        <label class="ved-insp-lbl" style="flex:0 0 auto;margin:0">Font</label>
        <select class="select-input" style="flex:1;font-size:.76rem"
          onchange="${_upd}c.fontFamily=this.value;${_ref}">
          ${['Impact','Anton','Bebas Neue','Oswald','Arial Black','Arial','Helvetica Neue',
             'Roboto Condensed','Montserrat','Playfair Display','Georgia',
             'Courier New','Trebuchet MS','Verdana','Times New Roman','Comic Sans MS','Permanent Marker'].map(f =>
            `<option value="${f}"${(cap.fontFamily||'Impact')===f?' selected':''}>${esc(f)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="ved-insp-field" style="margin-top:8px;flex-direction:row;gap:6px;align-items:center;flex-wrap:wrap">
        <label class="ved-insp-lbl" style="flex:0 0 auto;margin:0;min-width:60px">Text color</label>
        <input type="color" value="${cap.color||'#ffffff'}"
          style="width:32px;height:24px;padding:1px;border-radius:3px;border:1px solid var(--border);cursor:pointer"
          oninput="${_upd}c.color=this.value;${_ref}">
        <label class="ved-insp-lbl" style="flex:0 0 auto;margin:0 0 0 6px">Highlight</label>
        <input type="color" value="${cap.bgColor||'#000000'}"
          style="width:32px;height:24px;padding:1px;border-radius:3px;border:1px solid var(--border);cursor:pointer;${cap.bgColor?'':'opacity:.4'}"
          oninput="${_upd}c.bgColor=this.value;${_ref}">
        <button class="btn-sm${cap.bgColor?' btn-sm--active':''}" title="Toggle background highlight"
          onclick="${_upd}c.bgColor=c.bgColor?'':'#000000';vedRenderInspector();${_ref}">
          ${cap.bgColor?'Highlight Off':'Highlight'}</button>
      </div>
      <div class="ved-insp-field" style="margin-top:6px;flex-direction:row;gap:5px;align-items:center;flex-wrap:wrap">
        <label class="ved-insp-lbl" style="flex:0 0 auto;margin:0;min-width:60px">Style</label>
        <button class="btn-sm${cap.bold?' btn-sm--active':''}" style="font-weight:700;min-width:28px" title="Bold"
          onclick="${_upd}c.bold=!c.bold;vedRenderInspector();${_ref}"><strong>B</strong></button>
        <button class="btn-sm${cap.italic?' btn-sm--active':''}" style="font-style:italic;min-width:28px" title="Italic"
          onclick="${_upd}c.italic=!c.italic;vedRenderInspector();${_ref}"><em>I</em></button>
        <button class="btn-sm${cap.shadow!==false?' btn-sm--active':''}" title="Drop shadow behind text"
          onclick="${_upd}c.shadow=c.shadow===false;vedRenderInspector();${_ref}">Shadow</button>
      </div>
      <div class="ved-insp-field" style="margin-top:6px;flex-direction:row;gap:5px;align-items:center">
        <label class="ved-insp-lbl" style="flex:0 0 auto;margin:0;min-width:60px">Align</label>
        ${[
          ['left',   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg> Left'],
          ['center', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg> Center'],
          ['right',  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg> Right'],
        ].map(([a, lbl]) =>
          `<button class="btn-sm${(cap.align||'center')===a?' btn-sm--active':''}"
            style="display:inline-flex;align-items:center;gap:3px;font-size:.72rem"
            title="Align ${a}" onclick="${_upd}c.align='${a}';vedRenderInspector();${_ref}">${lbl}</button>`
        ).join('')}
      </div>
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
        <button class="btn-sm" style="color:var(--danger);border-color:var(--danger)"
          onclick="vedRemoveCaption('${uid}')">
          <svg class="icon icon-sm"><use href="#i-trash"/></svg> Remove
        </button>
      </div>`;
    return;
  }

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
      </div>
      <div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--border)">
        <div class="ved-insp-section-lbl">Canvas Background</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <input type="color" id="ved-canvas-bg-picker" value="${VED.canvasBg||'#111111'}"
            style="width:36px;height:28px;padding:1px;border-radius:4px;border:1px solid var(--border);cursor:pointer"
            oninput="_vedApplyCanvasBg(this.value)">
          <span style="font-size:.75rem;color:var(--text-2)">Canvas color</span>
        </div>
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
