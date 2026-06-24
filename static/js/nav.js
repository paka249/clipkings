'use strict';

function showPage(name, _fromHistory = false) {
  if (!_VALID_PAGES.has(name)) name = 'templates';

  // Stop editor preview playback when leaving
  const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (currentPage === 'editor' && name !== 'editor') {
    const prevVideo = document.getElementById('ved-preview-video');
    const prevAudio = document.getElementById('ved-preview-audio');
    if (prevVideo) { prevVideo.pause(); }
    if (prevAudio) { prevAudio.pause(); }
    VED.seqPlaying = false;
    _vedSetPlayIcon(false);
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + name);
  if (!pageEl) return;
  pageEl.classList.add('active');
  document.querySelector('.main')?.classList.toggle('is-editor', name === 'editor');
  const navEl = document.querySelector('[data-page="' + name + '"]');
  if (navEl) navEl.classList.add('active');
  if (!_fromHistory) history.pushState({ page: name }, '', '#' + name);

  if (_TOOL_PAGES.has(name)) localStorage.setItem('sf-last-tool', name);

  if (name === 'clipstudio')  loadExportsList();
  if (name === 'exports')     loadExportsPage();
  if (name === 'account')     loadAccountPage();
  if (name === 'templates')   loadGamingTemplateStatus();
  if (name === 'splitscreen') { dsCheckBgTemplates(); twInitAll(); }
  if (name === 'ranking')     { if (RKS.items.length === 0) { addRankingItem(); addRankingItem(); addRankingItem(); } else { _renderRankingItems(); } }
  if (name === 'aistudio')    aisLoadUploads();
  if (name === 'editor')      { vedRenderPhotoTrack(); vedRenderAudioTrack(); }
  if (name === 'dashboard')   _updateDashboardRecent();
}

function _updateDashboardRecent() {
  const last = localStorage.getItem('sf-last-tool');
  const wrap = document.getElementById('dash-recent');
  if (!wrap) return;
  if (!last || !_TOOL_NAMES[last]) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  wrap.innerHTML = `<div class="dash-recent-card" onclick="showPage('${last}')">
    <svg class="icon" style="color:var(--accent)"><use href="${_TOOL_ICONS[last]}"/></svg>
    <div class="dash-recent-body">
      <div class="dash-recent-lbl">Continue where you left off</div>
      <div class="dash-recent-tool">${_TOOL_NAMES[last]}</div>
    </div>
    <svg class="icon icon-sm" style="color:var(--text-3);transform:rotate(180deg)"><use href="#i-chevron-left"/></svg>
  </div>`;
}

window.addEventListener('popstate', e => {
  const page = (e.state && e.state.page) || location.hash.slice(1) || 'dashboard';
  showPage(page, true);
});

function useTemplate(key) {
  S.template = key;
  S.bgTemplate = '';
  document.getElementById('template-select').value = key;
  _hideBgTemplateBadge();
  onTemplateChange();
  showPage('clipstudio');
}

function useGamingTemplate(name) {
  const labels = {
    subway_surfers: 'Subway Surfers',
    minecraft_parkour: 'Minecraft Parkour',
    gta: 'GTA Gameplay',
  };
  S.template = 'split_screen';
  S.bgTemplate = name;
  setMute(false);
  document.getElementById('template-select').value = 'split_screen';
  const badge  = document.getElementById('bg-template-badge');
  const nameEl = document.getElementById('bg-template-name');
  const tabs   = document.getElementById('bg-source-tabs');
  if (badge)  { badge.style.display = 'flex'; }
  if (nameEl) { nameEl.textContent = labels[name] || name; }
  if (tabs)   { tabs.style.display = 'none'; }
  onTemplateChange();
  showPage('editor');
}

function clearGamingTemplate() {
  S.bgTemplate = '';
  _hideBgTemplateBadge();
  checkReady();
}

function _hideBgTemplateBadge() {
  const badge = document.getElementById('bg-template-badge');
  const tabs  = document.getElementById('bg-source-tabs');
  if (badge) { badge.style.display = 'none'; }
  if (tabs)  { tabs.style.display = ''; }
}

function setMute(val) {
  S.mute = val;
  const cb = document.getElementById('opt-audio');
  if (cb) cb.checked = !val;
}

function onTemplateChange() {
  const val = document.getElementById('template-select').value;
  if (val !== 'split_screen' && S.bgTemplate) {
    S.bgTemplate = '';
    _hideBgTemplateBadge();
  }
  S.template = val;
  document.getElementById('template-desc').innerHTML = TMPL_DESC[val] || '';
  checkReady();
}
