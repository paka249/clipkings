'use strict';

function showExportResult(filename, hasAudio = true, cardId = 'export-card', resultId = 'export-result') {
  const card = document.getElementById(cardId);
  if (card) card.style.display = 'block';
  const safeFile = esc(filename);
  const mime = filename.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
  const pid = 'sfsp' + Date.now();

  const el = document.getElementById(resultId);
  if (!el) return;
  el.innerHTML = `
    <p class="success-msg">
      <svg class="icon icon-sm"><use href="#i-check"/></svg>
      <strong>${safeFile}</strong>
    </p>
    <div class="sfs-player" id="${pid}">
      <video id="${pid}_v" preload="auto" playsinline>
        <source src="/api/video/${encodeURIComponent(filename)}" type="${mime}">
      </video>
      <div class="sfs-overlay" onclick="_sfsPP('${pid}')">
        <div class="sfs-big-play" id="${pid}_bp">&#9654;</div>
      </div>
      <div class="sfs-controls">
        <div class="sfs-seekbar" id="${pid}_sb">
          <div class="sfs-seekbar-fill" id="${pid}_sf"></div>
          <div class="sfs-seekbar-thumb" id="${pid}_st"></div>
        </div>
        <div class="sfs-ctrl-row">
          <button class="sfs-btn" id="${pid}_pb" onclick="_sfsPP('${pid}')" title="Play/Pause">&#9654;</button>
          <button class="sfs-btn sfs-btn-skip" onclick="_sfsSkip('${pid}',-5)" title="-5 seconds">&#8617;5s</button>
          <button class="sfs-btn sfs-btn-skip" onclick="_sfsSkip('${pid}',5)" title="+5 seconds">5s&#8618;</button>
          <span class="sfs-time" id="${pid}_tm">0:00 / 0:00</span>
          <span style="flex:1"></span>
          <button class="sfs-btn sfs-btn-vol" id="${pid}_vb" onclick="_sfsMute('${pid}')" title="Mute / Unmute">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
              <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
              <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325L6.188 3.61a.5.5 0 0 1 .529-.06z"/>
            </svg>
          </button>
          <input type="range" class="sfs-vol-slider" id="${pid}_vs" min="0" max="1" step="0.05" value="1"
            oninput="_sfsVol('${pid}',this.value)" title="Volume">
          <button class="sfs-btn" onclick="_sfsFs('${pid}')" title="Fullscreen">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1h4a.5.5 0 0 1 0 1H2v3.5a.5.5 0 0 1-1 0V1.5A.5.5 0 0 1 1.5 1zm13 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V2h-3.5a.5.5 0 0 1 0-1h4zm0 13h-4a.5.5 0 0 1 0-1H14v-3.5a.5.5 0 0 1 1 0v4a.5.5 0 0 1-.5.5zM1 10.5a.5.5 0 0 1 1 0V14h3.5a.5.5 0 0 1 0 1H1.5a.5.5 0 0 1-.5-.5v-4z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <button class="btn-outline" style="margin-top:10px;display:flex;width:100%;justify-content:center;gap:6px"
       onclick="downloadExport('${safeFile}')">
      <svg class="icon icon-sm"><use href="#i-dl"/></svg> Download
    </button>
  `;
  requestAnimationFrame(() => _sfsSetup(pid));
}

function _sfsSetup(pid) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.addEventListener('timeupdate', () => _sfsProgress(pid, v));
  v.addEventListener('loadedmetadata', () => _sfsProgress(pid, v));
  v.addEventListener('play', () => {
    const pb = document.getElementById(pid + '_pb');
    const bp = document.getElementById(pid + '_bp');
    if (pb) pb.innerHTML = '&#9646;&#9646;';
    if (bp) bp.style.opacity = '0';
  });
  v.addEventListener('pause', () => {
    const pb = document.getElementById(pid + '_pb');
    const bp = document.getElementById(pid + '_bp');
    if (pb) pb.innerHTML = '&#9654;';
    if (bp) { bp.innerHTML = '&#9654;'; bp.style.opacity = '1'; }
  });
  v.addEventListener('ended', () => {
    const pb = document.getElementById(pid + '_pb');
    const bp = document.getElementById(pid + '_bp');
    if (pb) pb.innerHTML = '&#8635;';
    if (bp) { bp.innerHTML = '&#8635;'; bp.style.opacity = '1'; }
  });
  const sb = document.getElementById(pid + '_sb');
  if (sb) {
    let dragging = false;
    const seek = (clientX) => {
      if (!v.duration) return;
      const r = sb.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      v.currentTime = pct * v.duration;
    };
    sb.addEventListener('mousedown', e => { dragging = true; seek(e.clientX); });
    document.addEventListener('mousemove', e => { if (dragging) seek(e.clientX); });
    document.addEventListener('mouseup', () => { dragging = false; });
    sb.addEventListener('touchstart', e => seek(e.touches[0].clientX), { passive: true });
    sb.addEventListener('touchmove', e => seek(e.touches[0].clientX), { passive: true });
  }
}

function _sfsProgress(pid, v) {
  if (!v.duration) return;
  const pct = (v.currentTime / v.duration) * 100;
  const sf = document.getElementById(pid + '_sf');
  const st = document.getElementById(pid + '_st');
  const tm = document.getElementById(pid + '_tm');
  if (sf) sf.style.width = pct + '%';
  if (st) st.style.left = pct + '%';
  if (tm) tm.textContent = fmtTS(Math.floor(v.currentTime)) + ' / ' + fmtTS(Math.floor(v.duration));
}

function _sfsPP(pid) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
}

function _sfsSkip(pid, sec) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + sec));
}

function _sfsMute(pid) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.muted = !v.muted;
  if (!v.muted && v.volume === 0) v.volume = 1;
  const sl = document.getElementById(pid + '_vs');
  if (sl) sl.value = v.muted ? 0 : v.volume;
  _sfsVolIcon(pid, v);
}

function _sfsVol(pid, val) {
  const v = document.getElementById(pid + '_v');
  if (!v) return;
  v.volume = parseFloat(val);
  v.muted = (v.volume === 0);
  _sfsVolIcon(pid, v);
}

function _sfsVolIcon(pid, v) {
  const btn = document.getElementById(pid + '_vb');
  if (!btn) return;
  if (v.muted || v.volume === 0) {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325L6.188 3.61a.5.5 0 0 1 .529-.06zm7.083 4.45a.5.5 0 0 1 0 .707l-4 4a.5.5 0 0 1-.707-.707l4-4a.5.5 0 0 1 .707 0zm-4.707 0a.5.5 0 0 1 .707 0l4 4a.5.5 0 0 1-.707.707l-4-4a.5.5 0 0 1 0-.707z"/>
    </svg>`;
    btn.title = 'Unmute';
  } else {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
      <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
      <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325L6.188 3.61a.5.5 0 0 1 .529-.06z"/>
    </svg>`;
    btn.title = 'Mute';
  }
}

function _sfsFs(pid) {
  const player = document.getElementById(pid);
  if (!player) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    player.requestFullscreen().catch(() => {
      const v = document.getElementById(pid + '_v');
      if (v && v.requestFullscreen) v.requestFullscreen().catch(() => {});
    });
  }
}
