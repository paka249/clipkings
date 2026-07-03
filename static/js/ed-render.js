'use strict';

// ── Render & export ───────────────────────────────────────────
async function vedRender() {
  if (!VED.sequence.length && !VED.photoClips.length) return;
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
      captions: (VED.captions || []).map(c => ({
        text:          c.text        || '',
        time_start:    c.tStart      ?? 0,
        time_end:      c.tEnd        ?? ((c.tStart ?? 0) + 3),
        x:             c.x           ?? 0.5,
        y:             c.y           ?? 0.82,
        font_size_pct: c.fontSizePct || 5,
        font_family:   c.fontFamily  || 'Impact',
        color:         c.color       || '#FFFFFF',
        bg_color:      c.bgColor     || '',
        bold:          c.bold        || false,
        italic:        c.italic      || false,
        align:         c.align       || 'center',
        shadow:        c.shadow      !== false,
        rotation:      c.rotation    ?? 0,
      })),
      resolution, codec, fit,
      canvas_bg: VED.canvasBg || '#000000',
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
    const res  = await apiFetch(`/api/jobs/${jobId}`);
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

// ── Keyboard shortcuts (editor-only) ─────────────────────────
document.addEventListener('keydown', function _vedKeyNav(e) {
  if (!document.getElementById('ved-timeline')?.offsetParent) return;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
    e.preventDefault(); vedUndo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault(); vedRedo(); return;
  }

  if (e.target.matches('input,textarea,select,[contenteditable="true"]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? -5 : 5;
    _vedSeekElapsed(Math.max(0, _vedSeqElapsed() + delta));
    _vedUpdateImgOverlays(_vedSeqElapsed());
    _vedUpdateCaptionOverlays(_vedSeqElapsed());
  }
});
