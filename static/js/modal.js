'use strict';

function _modal({ icon = 'warn', iconColor = 'warn', title = '', msg = '',
                  input = null, confirm: cfm = null, cancel: cnl = null, onConfirm = null }) {
  _sfmOk = onConfirm || null;

  const wrap = document.getElementById('sfm-icon-wrap');
  const ico  = document.getElementById('sfm-icon');
  if (wrap) wrap.className = 'sfm-icon-wrap sfm-icon-' + iconColor;
  if (ico)  ico.innerHTML  = `<use href="#i-${icon}"/>`;

  const titleEl = document.getElementById('sfm-title');
  const msgEl   = document.getElementById('sfm-msg');
  if (titleEl) titleEl.textContent = title;
  if (msgEl)   msgEl.innerHTML = msg;

  const inpWrap = document.getElementById('sfm-input-wrap');
  const inpEl   = document.getElementById('sfm-input');
  const inpLbl  = document.getElementById('sfm-input-label');
  if (input) {
    if (inpWrap) inpWrap.style.display = '';
    if (inpLbl)  inpLbl.textContent    = input.label || '';
    if (inpEl) {
      inpEl.value = input.value || '';
      setTimeout(() => { inpEl.focus(); inpEl.select(); }, 80);
    }
  } else {
    if (inpWrap) inpWrap.style.display = 'none';
  }

  const btns = document.getElementById('sfm-btns');
  if (btns) {
    btns.innerHTML = '';
    if (cnl) {
      const b = document.createElement('button');
      b.className = 'sfm-btn sfm-btn-cancel';
      b.textContent = (typeof cnl === 'string') ? cnl : (cnl.label || 'Cancel');
      b.onclick = _sfModalClose;
      btns.appendChild(b);
    }
    if (cfm) {
      const b = document.createElement('button');
      b.className = 'sfm-btn ' + (cfm.danger ? 'sfm-btn-danger' : 'sfm-btn-confirm');
      b.textContent = (typeof cfm === 'string') ? cfm : (cfm.label || 'OK');
      b.onclick = _sfModalConfirm;
      btns.appendChild(b);
    }
  }

  const modal = document.getElementById('sf-modal');
  if (modal) modal.style.display = 'flex';
}

function _sfModalConfirm() {
  const val = document.getElementById('sfm-input')?.value ?? '';
  _sfModalClose();
  if (_sfmOk) _sfmOk(val);
}

function _sfModalClose() {
  const modal = document.getElementById('sf-modal');
  if (modal) modal.style.display = 'none';
  _sfmOk = null;
}

function _sfModalBgClick(e) {
  if (e.target === document.getElementById('sf-modal')) _sfModalClose();
}

function showUpgradeComingSoon() {
  _modal({
    icon: 'zap', iconColor: 'info',
    title: 'Coming soon',
    msg: 'Paid plans aren\'t live yet — ClipKings is completely free during beta.',
    confirm: { label: 'Got it' },
  });
}
