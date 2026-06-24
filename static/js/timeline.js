'use strict';

function initTimelineSlider(duration) {
  S.primaryDuration = duration;
  const dur = Math.floor(duration) || 600;
  document.getElementById('clip-dur-label').textContent = duration
    ? `Video length: ${fmtTS(duration)} · drag the handles to pick a segment`
    : 'Drag handles to set start/end, or use the pickers below';
  const rs = document.getElementById('range-start');
  const re = document.getElementById('range-end');
  rs.max = dur; re.max = dur;
  rs.value = 0; re.value = dur;
  twSetSecs('clip-start', 0);
  twSetSecs('clip-end', dur);
  updateDualFill();
}

function onRangeStart(val) {
  const dur  = parseInt(document.getElementById('range-end').max) || 600;
  const endV = parseInt(document.getElementById('range-end').value);
  val = Math.min(parseInt(val), endV - 1, dur - 1);
  document.getElementById('range-start').value = val;
  twSetSecs('clip-start', val);
  updateDualFill();
}

function onRangeEnd(val) {
  const dur    = parseInt(document.getElementById('range-end').max) || 600;
  const startV = parseInt(document.getElementById('range-start').value);
  val = Math.max(parseInt(val), startV + 1);
  val = Math.min(val, dur);
  document.getElementById('range-end').value = val;
  twSetSecs('clip-end', val);
  updateDualFill();
}

function updateDualFill() {
  const dur    = parseInt(document.getElementById('range-end').max) || 600;
  const start  = parseInt(document.getElementById('range-start').value) || 0;
  const end    = parseInt(document.getElementById('range-end').value)   || dur;
  const leftPct = (start / dur) * 100;
  const wPct    = Math.max(0, (end / dur) * 100 - leftPct);
  const fill    = document.getElementById('dual-fill');
  fill.style.left  = leftPct + '%';
  fill.style.width = wPct + '%';
  document.getElementById('rng-start-lbl').textContent = fmtTS(start);
  document.getElementById('rng-end-lbl').textContent   = fmtTS(end);
}

function syncInputToSlider(type) {
  if (!S.primaryDuration) return;
  const twId    = type === 'start' ? 'clip-start' : 'clip-end';
  const rangeId = type === 'start' ? 'range-start' : 'range-end';
  const secs = twGetSecs(twId);
  document.getElementById(rangeId).value = Math.min(Math.floor(secs), Math.floor(S.primaryDuration));
  updateDualFill();
}

function addClipFromSlider() { addClip(); }

function addClip() {
  const startSec = twGetSecs('clip-start');
  const endSec   = twGetSecs('clip-end');
  const errEl    = document.getElementById('clip-error');

  if (endSec <= startSec) { showClipErr('End time must be after start time.'); return; }

  const maxDur = S.primaryDuration;
  if (maxDur > 0 && startSec >= maxDur) {
    showClipErr(`Start ${fmtTS(startSec)} is past the end of the video (${fmtTS(maxDur)}).`);
    return;
  }
  const clampedEnd = maxDur > 0 ? Math.min(endSec, maxDur) : endSec;

  errEl.style.display = 'none';
  S.clips.push({ start: twGetVal('clip-start'), end: fmtTS(clampedEnd), startSec, endSec: clampedEnd });
  twSetSecs('clip-start', 0);
  twSetSecs('clip-end', 0);
  renderClips();
  checkReady();
}

function showClipErr(msg) {
  const el = document.getElementById('clip-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function deleteClip(i) {
  S.clips.splice(i, 1);
  renderClips();
  checkReady();
}

function clearTimeline() {
  S.clips = [];
  renderClips();
  checkReady();
}

function renderClips() {
  const list     = document.getElementById('clip-list');
  const total    = document.getElementById('clip-total');
  const clearBtn = document.getElementById('clear-timeline-btn');

  if (S.clips.length === 0) {
    list.innerHTML = '<p class="muted-text" style="margin-top:8px">No clips queued. Add at least one segment above.</p>';
    total.style.display = 'none';
    clearBtn.style.display = 'none';
    return;
  }

  let totalSec = 0;
  list.innerHTML = S.clips.map((c, i) => {
    const dur = c.endSec - c.startSec;
    totalSec += dur;
    return `<div class="clip-row">
      <span class="clip-num">#${i + 1}</span>
      <span class="clip-ts">▶ ${esc(c.start)}</span>
      <span class="clip-ts">■ ${esc(c.end)}</span>
      <span class="clip-dur">${dur.toFixed(1)}s</span>
      <button class="btn-icon" title="Remove clip" onclick="deleteClip(${i})">✕</button>
    </div>`;
  }).join('');

  total.textContent = `📐 ${S.clips.length} clip(s) — total ≈ ${totalSec.toFixed(1)}s (${(totalSec / 60).toFixed(1)}m)`;
  total.style.display = 'block';
  clearBtn.style.display = 'block';
}
