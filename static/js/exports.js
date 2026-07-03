'use strict';

const _EXPORT_FOLDERS = [
  { id: 'aistudio', label: 'AI Studio',    icon: 'i-aistudio', prefixes: ['short_aistudio_'] },
  { id: 'ranking',  label: 'Ranking',      icon: 'i-ranking',  prefixes: ['short_ranking_'] },
  { id: 'editor',   label: 'Video Editor', icon: 'i-edit',     prefixes: ['short_edit_'] },
  { id: 'clip',     label: 'Clip Studio',  icon: 'i-film',     prefixes: ['short_crop_', 'short_split_'] },
  { id: 'other',    label: 'Other',        icon: 'i-folder',   prefixes: [] },
];
let _folderOpen = { aistudio: true, ranking: true, editor: true, clip: true, other: true };

// ── Download with rename modal ─────────────────────────────────
function downloadExport(filename, withPrompt = true) {
  const ext = filename.match(/\.(mp4|webm)$/i)?.[0] ?? '.mp4';
  if (!withPrompt) {
    _triggerDownload(filename, filename);
    return;
  }
  const suggested = filename
    .replace(/^short_(crop|split|ranking|aistudio)_\d{8}_\d{6}/, 'my-short')
    .replace(/\.(mp4|webm)$/i, '');
  _modal({
    icon: 'dl', iconColor: 'info',
    title: 'Save as',
    msg: 'Give your video a descriptive name — the file extension is added automatically.',
    input: { label: 'Filename (no extension needed)', value: suggested },
    confirm: { label: 'Download' },
    cancel: { label: 'Cancel' },
    onConfirm: (val) => {
      _triggerDownload(filename, (val.trim() || suggested) + ext);
    },
  });
}

function _triggerDownload(filename, saveName) {
  const a = document.createElement('a');
  a.href = '/api/download/' + encodeURIComponent(filename);
  a.download = saveName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Export helpers (compact rows for editor / account) ─────────
function _exportRowHtml(f) {
  const safeAttr = esc(f.name).replace(/'/g, '&#39;');
  return `<div class="export-row">
    <span class="export-name">${esc(f.name)}</span>
    <span class="export-size">${f.size_mb} MB</span>
    <button class="btn-sm" title="Watch" onclick="openWatchModal('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-film"/></svg>
    </button>
    <button class="btn-sm" title="Download" onclick="downloadExport('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-dl"/></svg>
    </button>
    <button class="btn-del btn-icon" title="Delete" onclick="deleteExport('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-trash"/></svg>
    </button>
  </div>`;
}

// ── Full rows for Exports page (with checkbox) ─────────────────
function _exportFullRowHtml(f) {
  const ext      = f.name.endsWith('.webm') ? 'WebM' : 'MP4';
  const date     = _parseExportDate(f.name);
  const checked  = _selectedExports.has(f.name) ? 'checked' : '';
  const safeAttr = esc(f.name).replace(/'/g, '&#39;');
  return `<div class="export-full-row" id="erow-${btoa(encodeURIComponent(f.name)).replace(/[^a-z0-9]/gi,'')}">
    <input type="checkbox" class="export-checkbox" ${checked}
           onchange="toggleExportSelect('${safeAttr}', this.checked)">
    <span class="export-name" style="flex:1">${esc(f.name)}</span>
    <span class="export-ext-badge">${ext}</span>
    <span class="export-size">${f.size_mb} MB</span>
    <span class="export-date">${date}</span>
    <button class="btn-sm" title="Watch" onclick="openWatchModal('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-film"/></svg>
    </button>
    <button class="btn-sm" title="Download" onclick="downloadExport('${safeAttr}')">
      <svg class="icon icon-sm"><use href="#i-dl"/></svg>
    </button>
    <button class="btn-del btn-icon" title="Delete" onclick="deleteExport('${safeAttr}', true)">
      <svg class="icon icon-sm"><use href="#i-trash"/></svg>
    </button>
  </div>`;
}

function openWatchModal(filename) {
  const modal = document.getElementById('watch-modal');
  if (!modal) return;
  document.getElementById('watch-modal-result').innerHTML = '';
  document.getElementById('watch-modal-card').style.display = 'none';
  modal.style.display = 'flex';
  showExportResult(filename, true, 'watch-modal-card', 'watch-modal-result');
}

function closeWatchModal() {
  const modal = document.getElementById('watch-modal');
  if (modal) modal.style.display = 'none';
  const vid = modal?.querySelector('video');
  if (vid) { vid.pause(); vid.src = ''; }
  document.getElementById('watch-modal-result').innerHTML = '';
}

function toggleExportSelect(name, checked) {
  if (checked) _selectedExports.add(name);
  else         _selectedExports.delete(name);
  _updateSelectionBar();
}

function toggleSelectAll(checked) {
  const boxes = document.querySelectorAll('.export-checkbox');
  boxes.forEach(cb => {
    cb.checked = checked;
    const row = cb.closest('.export-full-row');
    if (row) {
      const nameEl = row.querySelector('.export-name');
      if (nameEl) {
        if (checked) _selectedExports.add(nameEl.textContent.trim());
        else         _selectedExports.delete(nameEl.textContent.trim());
      }
    }
  });
  _updateSelectionBar();
}

function _updateSelectionBar() {
  const bar   = document.getElementById('export-select-bar');
  const label = document.getElementById('select-count-label');
  const allCb = document.getElementById('select-all-cb');
  const n = _selectedExports.size;
  if (bar)   bar.style.display = n > 0 ? 'flex' : 'none';
  if (label) label.textContent = `${n} selected`;
  if (allCb) {
    const total = document.querySelectorAll('.export-checkbox').length;
    allCb.checked       = total > 0 && n === total;
    allCb.indeterminate = n > 0 && n < total;
  }
}

function clearSelection() {
  _selectedExports.clear();
  document.querySelectorAll('.export-checkbox').forEach(cb => { cb.checked = false; });
  const allCb = document.getElementById('select-all-cb');
  if (allCb) { allCb.checked = false; allCb.indeterminate = false; }
  _updateSelectionBar();
}

async function bulkDownload() {
  if (!_selectedExports.size) return;
  for (const name of _selectedExports) {
    await downloadExport(name, false);
    await new Promise(r => setTimeout(r, 200));
  }
}

function bulkDelete() {
  if (!_selectedExports.size) return;
  const n = _selectedExports.size;
  _modal({
    icon: 'trash', iconColor: 'danger',
    title: `Delete ${n} export${n > 1 ? 's' : ''}`,
    msg: `${n} export${n > 1 ? 's' : ''} will be permanently removed. This cannot be undone.`,
    confirm: { label: `Delete ${n > 1 ? `all ${n}` : 'export'}`, danger: true },
    cancel: { label: 'Cancel' },
    onConfirm: async () => {
      const names = [..._selectedExports];
      _selectedExports.clear();
      let failed = 0;
      for (const name of names) {
        try {
          const res = await apiFetch('/api/exports/' + encodeURIComponent(name), { method: 'DELETE' });
          if (!res.ok) failed++;
        } catch { failed++; }
      }
      loadExportsPage();
      if (failed) {
        _modal({ icon: 'warn', iconColor: 'warn', title: 'Partial failure',
          msg: `${failed} file${failed > 1 ? 's' : ''} could not be deleted.`,
          confirm: { label: 'OK' } });
      }
    },
  });
}

function _parseExportDate(filename) {
  const m = filename.match(/(\d{8})_(\d{6})/);
  if (!m) return '';
  const d = m[1];
  try {
    return new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch { return ''; }
}

// ── Editor exports list (capped at 4) ─────────────────────────
async function loadExportsList() {
  const div = document.getElementById('exports-list');
  try {
    const files = await fetchExports();
    if (!files.length) { div.innerHTML = '<p class="muted-text">No exports yet.</p>'; return; }
    const preview = files.slice(0, 4);
    let html = preview.map(_exportRowHtml).join('');
    if (files.length > 4) {
      html += `<div class="exports-view-all">
        <a class="btn-sm" style="cursor:pointer" onclick="showPage('exports')">
          View all ${files.length} exports
          <svg class="icon icon-sm"><use href="#i-dl"/></svg>
        </a>
      </div>`;
    }
    div.innerHTML = html;
  } catch {
    div.innerHTML = '<p class="muted-text">Could not load exports.</p>';
  }
}

// ── Exports page ───────────────────────────────────────────────
async function loadExportsPage() {
  const div = document.getElementById('exports-page-list');
  div.innerHTML = '<p class="muted-text">Loading…</p>';
  _selectedExports.clear();
  _updateSelectionBar();
  try {
    _allExports = await fetchExports();
    _renderExportsPage(_allExports);
    const chip = document.getElementById('exports-count-chip');
    if (chip) chip.textContent = _allExports.length;
  } catch {
    div.innerHTML = '<p class="muted-text">Could not load exports.</p>';
  }
}

function _renderExportsPage(files) {
  const div = document.getElementById('exports-page-list');

  // Group into folders by filename prefix
  const groups = {};
  _EXPORT_FOLDERS.forEach(f => { groups[f.id] = []; });
  files.forEach(file => {
    const folder = _EXPORT_FOLDERS.find(f =>
      f.prefixes.length > 0 && f.prefixes.some(p => file.name.startsWith(p))
    );
    groups[folder ? folder.id : 'other'].push(file);
  });

  const hasAny = files.length > 0;
  let html = hasAny ? `
    <div class="export-select-all-row">
      <input type="checkbox" id="select-all-cb" onchange="toggleSelectAll(this.checked)">
      <label for="select-all-cb" class="muted" style="font-size:.78rem;cursor:pointer">Select all</label>
    </div>
  ` : '';

  for (const folder of _EXPORT_FOLDERS) {
    const folderFiles = groups[folder.id];
    if (folder.id === 'other' && !folderFiles.length) continue;
    const isOpen = _folderOpen[folder.id] !== false;
    html += `<div class="exp-folder">
      <div class="exp-folder-hdr" onclick="toggleExportFolder('${folder.id}')">
        <svg class="icon icon-sm exp-folder-chevron${isOpen ? '' : ' closed'}" id="exp-chev-${folder.id}">
          <use href="#i-chevron-left"/>
        </svg>
        <svg class="icon icon-sm exp-folder-icon"><use href="#${folder.icon}"/></svg>
        <span class="exp-folder-name">${folder.label}</span>
        <span class="exp-folder-count">${folderFiles.length}</span>
      </div>
      <div class="exp-folder-body" id="exp-fbody-${folder.id}"${isOpen ? '' : ' style="display:none"'}>
        ${folderFiles.length
          ? folderFiles.map(_exportFullRowHtml).join('')
          : '<p class="muted-text" style="padding:8px 0 10px;font-size:.8rem">No exports yet.</p>'}
      </div>
    </div>`;
  }

  div.innerHTML = html;
  _updateSelectionBar();
}

function toggleExportFolder(id) {
  _folderOpen[id] = !_folderOpen[id];
  const body = document.getElementById('exp-fbody-' + id);
  const chev = document.getElementById('exp-chev-' + id);
  if (body) body.style.display = _folderOpen[id] ? '' : 'none';
  if (chev) chev.classList.toggle('closed', !_folderOpen[id]);
}

function filterExports(query) {
  const q = query.toLowerCase();
  const filtered = q ? _allExports.filter(f => f.name.toLowerCase().includes(q)) : _allExports;
  _selectedExports.clear();
  _renderExportsPage(filtered);
}

function deleteExport(filename, fromExportsPage = false) {
  _modal({
    icon: 'trash', iconColor: 'danger',
    title: 'Delete export',
    msg: `<strong>${esc(filename)}</strong><br><br>This export will be permanently removed and cannot be recovered.`,
    confirm: { label: 'Delete', danger: true },
    cancel: { label: 'Cancel' },
    onConfirm: async () => {
      try {
        const res = await apiFetch('/api/exports/' + encodeURIComponent(filename), { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');
        if (fromExportsPage) loadExportsPage();
        else { loadExportsList(); loadAccountPage(); }
      } catch (e) {
        _modal({ icon: 'warn', iconColor: 'danger', title: 'Could not delete', msg: e.message, confirm: { label: 'OK' } });
      }
    },
  });
}

async function fetchExports() {
  const res = await apiFetch('/api/exports');
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}

// ── Account page ───────────────────────────────────────────────
async function loadAccountPage() {
  loadProfile();
  const div = document.getElementById('account-exports');
  try {
    const files = await fetchExports();
    if (!files.length) { div.innerHTML = '<p class="muted-text">No exports yet.</p>'; return; }
    div.innerHTML = files.slice(0, 5).map(_exportRowHtml).join('');
    if (files.length > 5) {
      div.innerHTML += `<div class="exports-view-all">
        <a class="btn-sm" style="cursor:pointer" onclick="showPage('exports')">View all ${files.length} exports</a>
      </div>`;
    }
  } catch {
    div.innerHTML = '<p class="muted-text">Could not load exports.</p>';
  }
}

// ── Profile ────────────────────────────────────────────────────
function loadProfile() {
  const name  = localStorage.getItem('sf-profile-name')  || 'Guest';
  const email = localStorage.getItem('sf-profile-email') || '';
  const nameEl   = document.getElementById('profile-name');
  const emailEl  = document.getElementById('profile-email');
  const avatarEl = document.getElementById('profile-avatar');
  if (nameEl)   nameEl.value  = name;
  if (emailEl)  emailEl.value = email;
  if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
  _applySidebarProfile(name, email);
}

function saveProfile() {
  const name  = (document.getElementById('profile-name').value.trim()  || 'Guest');
  const email = (document.getElementById('profile-email').value.trim() || '');
  localStorage.setItem('sf-profile-name',  name);
  localStorage.setItem('sf-profile-email', email);
  document.getElementById('profile-avatar').textContent = name[0].toUpperCase();
  _applySidebarProfile(name, email);
  const btn = document.getElementById('save-profile-btn');
  const orig = btn.textContent;
  btn.textContent = 'Saved';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

function _applySidebarProfile(name, email) {
  const avatarEl = document.getElementById('sidebar-avatar');
  const nameEl   = document.getElementById('sidebar-name');
  const emailEl  = document.getElementById('sidebar-email');
  const greetEl  = document.getElementById('greeting-name');
  const signinEl = document.getElementById('sidebar-signin-link');
  const isGuest  = !authToken();

  if (avatarEl) avatarEl.textContent = name[0].toUpperCase();
  if (nameEl)   nameEl.innerHTML = `${esc(name)} <span class="user-plan">Free</span>`;
  if (emailEl)  emailEl.textContent = isGuest ? 'Not signed in' : (email || 'Signed in');
  if (greetEl)  greetEl.textContent = isGuest ? 'there' : name;
  if (signinEl) signinEl.style.display = isGuest ? 'block' : 'none';
}
