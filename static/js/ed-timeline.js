'use strict';

// ── Timeline zoom levels ──────────────────────────────────────
const _VED_ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4, 8];

// ── Ruler ─────────────────────────────────────────────────────
function _vedTotalDur() {
  const seqEnd = _vedSeqTotal();
  const imgEnd = (VED.photoClips || []).reduce((m, c) => Math.max(m, c.tEnd ?? 0), 0);
  const capEnd = (VED.captions   || []).reduce((m, c) => Math.max(m, c.tEnd ?? 0), 0);
  return Math.max(seqEnd, imgEnd, capEnd);
}

function _vedRenderRuler() {
  const ruler = document.getElementById('ved-tl-ruler');
  if (!ruler) return;
  const pps   = _vedPPS();
  const total = Math.max(30, _vedTotalDur() + 15);
  const w     = Math.ceil(total * pps) + 120;
  ruler.style.width = w + 'px';

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

// ── Sequence elapsed / seek ───────────────────────────────────
function _vedSeqTotal() {
  return VED.sequence.reduce((t, s) =>
    t + Math.max(0, (s.end != null ? s.end : (s.duration || 0)) - (s.start || 0)), 0);
}

function _vedSeqElapsed() {
  const video = document.getElementById('ved-preview-video');
  if (!VED.sequence.length) {
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

function _vedSeekElapsed(t) {
  t = Math.max(0, t);
  if (!VED.sequence.length) {
    VED.seqPlaying    = false;
    VED.imgPlayOffset = t;
    VED.imgPlayT0     = 0;
    if (VED.imgRafId) { cancelAnimationFrame(VED.imgRafId); VED.imgRafId = null; }
    _vedSetPlayIcon(false);
    _vedUpdateSeekbar();
    return;
  }
  const video = document.getElementById('ved-preview-video');
  if (!video) return;
  video.pause();
  VED.seqPlaying = false;
  _vedSetPlayIcon(false);
  let acc = 0;
  for (let i = 0; i < VED.sequence.length; i++) {
    const s   = VED.sequence[i];
    const dur = Math.max(0, (s.end ?? (s.duration || 0)) - (s.start || 0));
    if (acc + dur > t || i === VED.sequence.length - 1) {
      VED.seqIdx = i;
      const clipT = (s.start || 0) + Math.min(dur, Math.max(0, t - acc));
      const src   = `/api/uploads/stream/${s.uploadId}`;
      if (video.dataset.src !== src) {
        video.dataset.src = src;
        video.src = src;
        video.style.display = 'block';
        const ph = document.getElementById('ved-canvas-placeholder');
        if (ph) ph.style.display = 'none';
        video.addEventListener('loadedmetadata', function once() {
          video.removeEventListener('loadedmetadata', once);
          video.currentTime = clipT;
          _vedUpdateSeekbar();
        });
      } else {
        video.currentTime = clipT;
        _vedUpdateSeekbar();
      }
      return;
    }
    acc += dur;
  }
}

// ── Seekbar update ────────────────────────────────────────────
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
  _vedUpdateCaptionOverlays(elapsed);
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

// ── Image-only playback tick ──────────────────────────────────
function _vedImgOnlyTick() {
  const total   = _vedTotalDur();
  const elapsed = _vedSeqElapsed();
  _vedUpdateSeekbar();
  _vedUpdateImgOverlays(elapsed);
  _vedUpdateCaptionOverlays(elapsed);
  if (elapsed >= total) {
    VED.seqPlaying    = false;
    VED.imgPlayOffset = 0;
    VED.imgPlayT0     = 0;
    VED.imgRafId      = null;
    _vedSetPlayIcon(false);
    _vedUpdateSeekbar();
    _vedUpdateImgOverlays(0);
    _vedUpdateCaptionOverlays(0);
    return;
  }
  VED.imgRafId = requestAnimationFrame(_vedImgOnlyTick);
}

// ── Play / Pause / Seek / Scrub ───────────────────────────────
function vedTlPlayPause() {
  const video    = document.getElementById('ved-preview-video');
  const audio    = document.getElementById('ved-preview-audio');
  const hasVideo = VED.sequence.length > 0;
  const hasImgs  = (VED.photoClips || []).length > 0;

  if (!hasVideo && !hasImgs) return;

  if (!hasVideo) {
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
  if (!VED.sequence.length) {
    const t = Math.max(0, _vedSeqElapsed() + secs);
    _vedSeekElapsed(t);
    _vedUpdateImgOverlays(t);
    _vedUpdateCaptionOverlays(t);
    _vedUpdateSeekbar();
    return;
  }
  const video = document.getElementById('ved-preview-video');
  if (!video || !video.dataset.src) return;
  const item = VED.sequence.find(s => s.uid === VED.selectedClip)
            || VED.audioClips.find(s => s.uid === VED.selectedClip);
  const minT = item?.start ?? 0;
  const maxT = item?.end   ?? (video.duration || 9999);
  video.currentTime = Math.max(minT, Math.min(maxT, video.currentTime + secs));
  _vedUpdateSeekbar();
}

function _vedScrubTo(clientX) {
  const inner = document.getElementById('ved-tl-inner');
  if (!inner) return;
  const rect   = inner.getBoundingClientRect();
  const target = Math.max(0, (clientX - rect.left) / _vedPPS());

  if (!VED.sequence.length) {
    _vedSeekElapsed(target);
    _vedUpdateImgOverlays(target);
    _vedUpdateCaptionOverlays(target);
    _vedUpdateSeekbar();
    return;
  }

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
}

function vedTlPointerDown(e) {
  if (e.target.closest('.ved-tl-clip')) return;
  if (!VED.sequence.length && !VED.photoClips.length && !VED.audioClips.length && !VED.captions.length) return;

  const onMove = (ev) => _vedScrubTo(ev.clientX);
  const onUp   = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  _vedScrubTo(e.clientX);
}

function _vedSetPlayIcon(playing) {
  const icon = document.getElementById('ved-tl-play-icon');
  if (!icon) return;
  icon.innerHTML = playing ? '<use href="#i-pause"/>' : '<use href="#i-play"/>';
}
