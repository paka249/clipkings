'use strict';

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
    const dur         = file.duration ? fmtTS(Math.floor(file.duration)) : '';
    const isAudio     = file.is_audio  || false;
    const isImage     = file.is_image  || _vedIsImg({ name: file.name || file.id, type: file.type || '' });
    const displayName = file.name || file.original_name || file.id;
    const addFn       = isAudio ? 'vedAddAudioToSeq' : isImage ? 'vedAddPhotoToSeq' : 'vedAddToSeq';
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
  if (files.length) await _vedUpload(files, null);
}

function vedAddVideoFiles(rawList) { return _vedUpload(Array.from(rawList || []), 'video'); }
function vedAddAudioFiles(rawList) { return _vedUpload(Array.from(rawList || []), 'audio'); }
function vedAddPhotoFiles(rawList) { return _vedUpload(Array.from(rawList || []), 'image'); }

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
  await apiFetch(`/api/uploads/${id}`, { method: 'DELETE' }).catch(() => {});
  VED.library    = VED.library.filter(f => f.id !== id);
  VED.sequence   = VED.sequence.filter(s => s.uploadId !== id);
  VED.photoClips = VED.photoClips.filter(s => s.uploadId !== id);
  VED.audioClips = VED.audioClips.filter(s => s.uploadId !== id);
  const allClips = [...VED.sequence, ...VED.photoClips, ...VED.audioClips];
  if (VED.selectedClip && !allClips.find(s => s.uid === VED.selectedClip)) vedCloseInspector();
  vedRenderPhotoTrack();
  vedRenderSequence();
  vedRenderAudioTrack();
  _vedUpdatePlaceholder();
}
