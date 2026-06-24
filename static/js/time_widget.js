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
  const h = Math.min(99, parseInt(el.querySelector('.tw-h')?.value) || 0);
  const m = Math.min(59, parseInt(el.querySelector('.tw-m')?.value) || 0);
  const s = Math.min(59, parseInt(el.querySelector('.tw-s')?.value) || 0);
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
  if (hEl) hEl.value = String(Math.min(99, h)).padStart(2, '0');
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

  // type="text" + inputmode="numeric" lets us enforce maxlength="2" and clamp properly.
  // type="number" ignores maxlength and lets the browser silently accept out-of-range values.
  const chevUp = `<svg viewBox="0 0 10 6" width="10" height="6"><polyline points="1,5 5,1 9,5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const chevDn = `<svg viewBox="0 0 10 6" width="10" height="6"><polyline points="1,1 5,5 9,1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const seg = (cls, val, inc) =>
    `<div class="tw-field">
       <button class="tw-chevron tw-up" type="button" tabindex="-1" onclick="twAdj('${id}',${inc})">${chevUp}</button>
       <input class="tw-seg ${cls}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${String(val).padStart(2,'0')}">
       <button class="tw-chevron tw-dn" type="button" tabindex="-1" onclick="twAdj('${id}',${-inc})">${chevDn}</button>
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

  const segs    = [...el.querySelectorAll('.tw-seg')];
  const maxVals = [99, 59, 59]; // HH, MM, SS
  const steps   = [3600, 60, 1];

  segs.forEach((inp, i) => {
    const max  = maxVals[i];
    const step = steps[i];

    // Select all text on focus so typing replaces the current value
    inp.addEventListener('focus', () => inp.select());

    // Strip non-digits, clamp to max, auto-advance after 2 digits typed
    inp.addEventListener('input', () => {
      let raw = inp.value.replace(/\D/g, '').slice(0, 2);
      if (raw.length > 0) {
        const n = parseInt(raw);
        // If first digit alone already exceeds max's tens place, pad immediately
        // e.g. typing "7" in seconds (max 59) → "07", then advance
        if (raw.length === 1 && n * 10 > max) {
          inp.value = String(n).padStart(2, '0');
          if (i < segs.length - 1) setTimeout(() => { segs[i+1].focus(); segs[i+1].select(); }, 0);
          return;
        }
        if (raw.length === 2) {
          inp.value = String(Math.min(max, n)).padStart(2, '0');
          if (i < segs.length - 1) setTimeout(() => { segs[i+1].focus(); segs[i+1].select(); }, 0);
          return;
        }
      }
      inp.value = raw;
    });

    // Normalise and zero-pad when leaving the field
    inp.addEventListener('blur', () => {
      const n = Math.min(max, Math.max(0, parseInt(inp.value) || 0));
      inp.value = String(n).padStart(2, '0');
    });

    // Scroll wheel changes value
    inp.addEventListener('wheel', e => {
      e.preventDefault();
      twAdj(id, e.deltaY < 0 ? step : -step);
    }, { passive: false });

    inp.addEventListener('keydown', e => {
      // ↑ / ↓ → increment / decrement
      if (e.key === 'ArrowUp')   { e.preventDefault(); twAdj(id,  step); }
      if (e.key === 'ArrowDown') { e.preventDefault(); twAdj(id, -step); }
      // ← / → → jump to previous / next segment
      if (e.key === 'ArrowLeft'  && i > 0)             { e.preventDefault(); segs[i-1].focus(); segs[i-1].select(); }
      if (e.key === 'ArrowRight' && i < segs.length-1) { e.preventDefault(); segs[i+1].focus(); segs[i+1].select(); }
      // Backspace on empty field → go back
      if (e.key === 'Backspace' && inp.value === '' && i > 0) { segs[i-1].focus(); segs[i-1].select(); }
    });
  });
}

function twInitAll() {
  document.querySelectorAll('.tw-wrap').forEach(el => {
    if (!el.querySelector('.tw-display')) twBuild(el);
  });
}

document.addEventListener('DOMContentLoaded', twInitAll);
