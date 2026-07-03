'use strict';

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
  _vedSnapshot();
  VED.audioClips.push({
    uid:      newUid,
    uploadId: entry.id,
    name:     entry.name || entry.original_name || entry.id,
    duration: entry.duration,
    start:    0,
    end:      entry.duration || null,
  });
  if (!entry.duration) _vedDetectDuration(newUid, 'audio', entry.id);
  vedRenderAudioTrack();
  vedSelectClip(newUid, 'audio');
  _vedUpdatePlaceholder();
}

function vedRemoveFromAudioSeq(uid) {
  _vedSnapshot();
  VED.audioClips = VED.audioClips.filter(s => s.uid !== uid);
  if (VED.selectedClip === uid) vedCloseInspector();
  vedRenderAudioTrack();
  _vedUpdatePlaceholder();
}

function vedMoveAudioClip(uid, dir) {
  const idx = VED.audioClips.findIndex(s => s.uid === uid);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= VED.audioClips.length) return;
  _vedSnapshot();
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

    block.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const wasSelected = VED.selectedClip === item.uid;
      block.classList.add('ved-tl-clip--lift');
      const onUp = () => {
        document.removeEventListener('mouseup', onUp);
        block.classList.remove('ved-tl-clip--lift');
        if (wasSelected) { vedCloseInspector(); return; }
        vedSelectClip(item.uid, 'audio');
      };
      document.addEventListener('mouseup', onUp);
    });
    block.ondragstart = (e) => {
      VED.dragUid = item.uid; VED.dragTrack = 'audio';
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => block.classList.add('ved-tl-clip--lift'), 0);
    };
    block.ondragend = () => {
      VED.dragUid = null; VED.dragTrack = null;
      block.classList.remove('ved-tl-clip--lift');
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

// ── Audio playback ────────────────────────────────────────────
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
