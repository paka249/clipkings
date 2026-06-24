'use strict';

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('sidebar--collapsed');
  localStorage.setItem('sf-sidebar-collapsed', collapsed ? '1' : '');
}

/* ── Editor canvas expand ──────────────────────────── */
function vedExpandCanvas() {
  const overlay = document.getElementById('ved-expand-overlay');
  const video   = document.getElementById('ved-preview-video');
  const expVid  = document.getElementById('ved-expand-video');
  const expPh   = document.getElementById('ved-expand-ph');
  if (!overlay) return;
  if (video && video.src && !video.paused) {
    expVid.src = video.src;
    expVid.currentTime = video.currentTime;
    expVid.style.display = '';
    expPh.style.display = 'none';
  } else if (video && video.src) {
    expVid.src = video.src;
    expVid.style.display = '';
    expPh.style.display = 'none';
  } else {
    expVid.style.display = 'none';
    expPh.style.display = '';
  }
  overlay.classList.add('open');
}

function vedCollapseCanvas(e) {
  if (e && e.target !== e.currentTarget) return;
  const overlay = document.getElementById('ved-expand-overlay');
  const expVid  = document.getElementById('ved-expand-video');
  if (overlay) overlay.classList.remove('open');
  if (expVid) { expVid.pause(); expVid.src = ''; }
}

/* ── Feature preview expand (AI Studio, Ranking, etc.) ── */
function featExpandPreview(btn) {
  const panel   = btn.closest('.feat-preview-panel');
  const overlay = document.getElementById('feat-expand-overlay');
  const expVid  = document.getElementById('feat-expand-video');
  const expPh   = document.getElementById('feat-expand-ph');
  if (!overlay || !panel) return;
  const vid = panel.querySelector('video');
  if (vid && vid.src) {
    expVid.src = vid.src;
    expVid.currentTime = vid.currentTime || 0;
    expVid.style.display = '';
    expPh.style.display = 'none';
  } else {
    expVid.style.display = 'none';
    expPh.style.display = '';
  }
  overlay.classList.add('open');
}

function featCollapsePreview(e) {
  if (e && e.target !== e.currentTarget) return;
  const overlay = document.getElementById('feat-expand-overlay');
  const expVid  = document.getElementById('feat-expand-video');
  if (overlay) overlay.classList.remove('open');
  if (expVid) { expVid.pause(); expVid.src = ''; }
}

/* ── Feature panel resize handle ── */
function featResizeStart(e, handle) {
  const layout = handle.closest('.feature-layout');
  if (!layout) return;
  const mainCol    = layout.querySelector('.feature-col-main');
  const previewCol = layout.querySelector('.feature-col-preview');
  if (!mainCol || !previewCol) return;

  handle.classList.add('dragging');
  const startX    = e.clientX;
  const startMain = mainCol.getBoundingClientRect().width;
  const startPrev = previewCol.getBoundingClientRect().width;
  const totalW    = startMain + startPrev;

  function onMove(ev) {
    const dx      = ev.clientX - startX;
    const newMain = Math.max(300, Math.min(totalW - 180, startMain + dx));
    const newPrev = totalW - newMain;
    mainCol.style.flex    = 'none';
    mainCol.style.width   = newMain + 'px';
    previewCol.style.width = newPrev + 'px';
  }
  function onUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  e.preventDefault();
}

function _initSidebarResize() {
  const handle  = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const w = Math.max(160, Math.min(340, startW + e2.clientX - startX));
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

function _initTimelineResize() {
  const handle   = document.getElementById('ved-tl-resize-handle');
  const timeline = document.getElementById('ved-timeline');
  if (!handle || !timeline) return;
  let startY, startH;
  handle.addEventListener('mousedown', e => {
    startY = e.clientY;
    startH = timeline.getBoundingClientRect().height;
    handle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const h = Math.max(140, Math.min(480, startH - (e2.clientY - startY)));
      timeline.style.height = h + 'px';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

function _initPropsResize() {
  const handle = document.getElementById('ved-props-resize-handle');
  const panel  = document.querySelector('.ved-side-panel');
  if (!handle || !panel) return;
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = e2 => {
      const w = Math.max(200, Math.min(420, startW - (e2.clientX - startX)));
      panel.style.width = w + 'px';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}
