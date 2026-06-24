'use strict';

function setBase(base) {
  document.documentElement.setAttribute('data-theme', base === 'light' ? 'light' : '');
  document.getElementById('btn-dark')?.classList.toggle('active', base !== 'light');
  document.getElementById('btn-light')?.classList.toggle('active', base === 'light');
  localStorage.setItem('sf-theme-base', base);
  _syncProfileTheme(base);
}

function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-hover',
    color === '#3B82F6' ? '#2563EB' : shiftColor(color, -20));
  localStorage.setItem('sf-theme-accent', color);
  syncAccentUI(color);
}

function shiftColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function syncAccentUI(color) {
  const c = (color || '').toUpperCase();
  document.querySelectorAll('.accent-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color.toUpperCase() === c);
  });
  const picker = document.getElementById('profile-accent-picker');
  if (picker && picker.value.toUpperCase() !== c) picker.value = color;
  const sidebarPicker = document.getElementById('accent-picker');
  if (sidebarPicker && sidebarPicker.value.toUpperCase() !== c) sidebarPicker.value = color;
}

function _syncProfileTheme(base) {
  const dark  = document.getElementById('prof-btn-dark');
  const light = document.getElementById('prof-btn-light');
  if (dark)  dark.classList.toggle('active', base === 'dark');
  if (light) light.classList.toggle('active', base === 'light');
}
