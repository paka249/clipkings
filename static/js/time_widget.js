'use strict';

/* ── Time Widget ──────────────────────────────────────────────
   Shared HH:MM:SS picker used across Gaming BG, Ranking, etc.
   Each widget is a .tw-wrap div with id="tw-{id}" and data-secs.
   Call twInitAll() after injecting HTML to activate all widgets.
──────────────────────────────────────────────────────────── */

function twParse(val) {
  if (!val) return 0;
  const parts = String(val).split(':').map(Number).reverse();
  return (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
}

function twFormat(total) {
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function twGetVal(id) {
  return twFormat(twGetSecs(id));
}

function twGetSecs(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const h = parseInt(el.querySelector('.tw-h')?.value) || 0;
  const m = parseInt(el.querySelector('.tw-m')?.value) || 0;
  const s = parseInt(el.querySelector('.tw-s')?.value) || 0;
  return h * 3600 + m * 60 + s;
}

function twSetSecs(id, total) {
  const el = document.getElementById(id);
  if (!el) return;
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hEl = el.querySelector('.tw-h');
  const mEl = el.querySelector('.tw-m');
  const sEl = el.querySelector('.tw-s');
  if (hEl) hEl.value = h;
  if (mEl) mEl.value = String(m).padStart(2, '0');
  if (sEl) sEl.value = String(s).padStart(2, '0');
  const cb = el.dataset.onchange;
  if (cb) { try { eval(cb); } catch(e){} }
}

function twAdj(id, delta) {
  twSetSecs(id, twGetSecs(id) + delta);
}

function twBuild(el) {
  const secs    = parseInt(el.dataset.secs) || 0;
  const compact = el.classList.contains('tw-compact');
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const id = el.id;
  const seg = (cls, val, inc) =>
    `<div class="tw-field">
       <button class="tw-step" type="button" tabindex="-1" onclick="twAdj('${id}',${-inc})">−</button>
       <input class="tw-seg ${cls}" type="number" min="0" max="${inc===3600?99:59}" value="${String(val).padStart(2,'0')}">
       <button class="tw-step" type="button" tabindex="-1" onclick="twAdj('${id}',${inc})">+</button>
     </div>`;
  el.innerHTML = `
    <div class="tw-display">
      ${seg('tw-h', h, 3600)}
      <span class="tw-colon">:</span>
      ${seg('tw-m', m, 60)}
      <span class="tw-colon">:</span>
      ${seg('tw-s', s, 1)}
    </div>
    ${compact ? '' : `<div class="tw-presets">
      <button class="tw-preset" type="button" onclick="twAdj('${id}',5)">+5s</button>
      <button class="tw-preset" type="button" onclick="twAdj('${id}',10)">+10s</button>
      <button class="tw-preset" type="button" onclick="twAdj('${id}',30)">+30s</button>
      <button class="tw-preset" type="button" onclick="twAdj('${id}',60)">+1m</button>
      <button class="tw-preset" type="button" onclick="twAdj('${id}',300)">+5m</button>
    </div>`}
  `;
  el.querySelectorAll('.tw-seg').forEach(inp => {
    inp.addEventListener('wheel', e => {
      e.preventDefault();
      const step = inp.classList.contains('tw-h') ? 3600 : inp.classList.contains('tw-m') ? 60 : 1;
      twAdj(id, e.deltaY < 0 ? step : -step);
    }, { passive: false });
    inp.addEventListener('change', () => twSetSecs(id, twGetSecs(id)));
  });
}

function twInitAll() {
  document.querySelectorAll('.tw-wrap').forEach(el => {
    if (!el.querySelector('.tw-display')) twBuild(el);
  });
}

document.addEventListener('DOMContentLoaded', twInitAll);
