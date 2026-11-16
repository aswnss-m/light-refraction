'use strict';
const O = Optics, $ = s => document.querySelector(s), RAD = Math.PI / 180;
const cv = $('#cv'), ctx = cv.getContext('2d');
const BODY = 46, HANDLE = 16; // light source body length and aim handle offset, px

// Angles are in degrees here because the sliders show them.
const S = {
  src: 'sun', wl: 650, beamW: 14, spread: 40, rays: 5, temp: 5778, samples: 40, sx: 0, sy: 0, sa: -20,
  objects: [], sel: 0,
  medium: 'Air', nMedium: 1.2,
  refl: true, angles: true, pol: 'u', gain: 3,
};

const newObject = (shape, x, y) => ({
  shape, material: 'Crown glass (BK7)', nCustom: 1.5, abbe: 40,
  size: shape === 'prism' ? 220 : 110, apex: 60, w: 160, h: 160, lensR: 320, rot: 0, x, y,
});
const cur = () => S.objects[S.sel]; // selected object, undefined when there are none

const SHAPES = {
  cylinder: ['Cylinder', '<circle cx="12" cy="12" r="8"/>'],
  prism: ['Prism', '<path d="M12 4 21 20H3z"/>'],
  cube: ['Cube', '<rect x="4.5" y="4.5" width="15" height="15"/>'],
  half: ['Half cylinder', '<path d="M8 3a9 9 0 0 1 0 18z"/>'],
  convex: ['Convex lens', '<path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>'],
  concave: ['Concave lens', '<path d="M6 3h12a14 14 0 0 0 0 18H6a14 14 0 0 0 0-18z"/>'],
};

const matOpts = Object.fromEntries([...Object.keys(O.MATERIALS), 'Custom'].map(k => [k, k]));
const white = () => S.src !== 'laser', lens = () => cur().shape === 'convex' || cur().shape === 'concave';
const sizeLabel = () => ({ cylinder: 'Radius', half: 'Radius', prism: 'Side length' }[cur().shape] || 'Half height');
const CONTROLS = [
  { h: 'Light source' },
  { k: 'src', seg: true, opts: { laser: 'Laser', sun: 'Sunlight', lamp: 'Lamp' } },
  { k: 'wl', label: 'Wavelength', unit: ' nm', min: 380, max: 750, step: 1, show: () => !white() },
  { k: 'beamW', label: 'Beam width', unit: ' px', min: 0, max: 200, step: 1, show: () => S.src === 'sun' },
  { k: 'spread', label: 'Spread angle', unit: '°', min: 1, max: 120, step: 1, show: () => S.src === 'lamp' },
  { k: 'rays', label: 'Rays', min: 1, max: 60, step: 1, show: white },
  { k: 'temp', label: 'Colour temperature', unit: ' K', min: 1500, max: 10000, step: 50, show: white },
  { k: 'samples', label: 'Wavelengths sampled', min: 3, max: 80, step: 1, show: white },
  { k: 'sa', label: 'Beam direction', unit: '°', min: -180, max: 180, step: 0.5 },
  { h: () => `Selected object (${S.sel + 1} of ${S.objects.length})`, o: 1 },
  { h: 'Objects', show: () => !cur() },
  { note: 'Click a shape in the top bar to add an object.', show: () => !cur() },
  { o: 1, k: 'shape', label: 'Shape', opts: Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v[0]])) },
  { o: 1, k: 'material', label: 'Material', opts: matOpts },
  { o: 1, k: 'nCustom', label: 'Refractive index at 588 nm', min: 1, max: 3, step: 0.001, show: () => cur().material === 'Custom' },
  { o: 1, k: 'abbe', label: 'Abbe number (lower disperses more)', min: 15, max: 90, step: 1, show: () => cur().material === 'Custom' },
  { o: 1, k: 'size', label: sizeLabel, unit: ' px', min: 30, max: 300, step: 1, show: () => cur().shape !== 'cube' },
  { o: 1, k: 'apex', label: 'Apex angle', unit: '°', min: 20, max: 120, step: 1, show: () => cur().shape === 'prism' },
  { o: 1, k: 'w', label: 'Width', unit: ' px', min: 20, max: 500, step: 1, show: () => cur().shape === 'cube' },
  { o: 1, k: 'h', label: 'Height', unit: ' px', min: 20, max: 500, step: 1, show: () => cur().shape === 'cube' },
  { o: 1, k: 'lensR', label: 'Surface radius', unit: ' px', min: 60, max: 1200, step: 1, show: lens },
  { o: 1, k: 'rot', label: 'Rotation', unit: '°', min: -180, max: 180, step: 0.5 },
  { o: 1, btn: 'Duplicate object', act: () => pasteObject(cur(), cur().x, cur().y + 2 * objRadius(cur()) + 20) },
  { o: 1, btn: 'Delete object', act: () => removeObject() },
  { h: 'Surrounding medium' },
  { k: 'medium', label: 'Medium', opts: matOpts },
  { k: 'nMedium', label: 'Refractive index', min: 1, max: 3, step: 0.001, show: () => S.medium === 'Custom' },
  { h: 'View' },
  { k: 'refl', label: 'Partial reflections (Fresnel)', check: true },
  { k: 'angles', label: 'Normals and angles', check: true },
  { k: 'pol', label: 'Polarisation', opts: { u: 'Unpolarised', s: 's (electric field out of the screen)', p: 'p (electric field in the screen)' } },
  { k: 'gain', label: 'Exposure', min: 0.5, max: 30, step: 0.5 },
];

function el(tag, props, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function addObject(shape) {
  // Objects must not overlap, so a new one goes to the right of the rightmost while there is room.
  const o = newObject(shape, S.cx, S.cy), n = S.objects.length;
  const x = Math.max(...S.objects.map(q => q.x + objRadius(q))) + objRadius(o) + 20;
  if (n && x + objRadius(o) < innerWidth - 300) o.x = x;
  else if (n) { o.x += (n % 5) * 40; o.y += 120 + (n % 5) * 40; }
  S.sel = S.objects.push(o) - 1;
  buildPanel();
  draw();
}

// Copies the known fields of untrusted src onto T, using each control's options and range as the rule.
function clean(src, T, forObject) {
  for (const c of CONTROLS) {
    if (!c.k || !!c.o !== forObject || !(c.k in src)) continue;
    const v = src[c.k];
    if (c.opts) { if (Object.hasOwn(c.opts, v)) T[c.k] = v; }
    else if (c.check) T[c.k] = !!v;
    else if (Number.isFinite(v)) T[c.k] = Math.min(c.max, Math.max(c.min, v));
  }
  for (const k of forObject ? ['x', 'y'] : ['sx', 'sy']) if (Number.isFinite(src[k])) T[k] = src[k];
  return T;
}
const cleanObject = o => clean(o, newObject('prism', S.cx, S.cy), true);

const exportSetup = indent => { const { cx, cy, sel, ...setup } = S; return JSON.stringify(setup, null, indent); };

function loadSetup(data) {
  if (!data || !Array.isArray(data.objects)) throw new Error('This is not a setup. It has no "objects" list.');
  clean(data, S, false);
  S.objects = data.objects.slice(0, 50).filter(o => o && typeof o === 'object').map(cleanObject);
  S.sel = 0;
  buildPanel();
  draw();
}

// Adds a copy of src centred on (x, y) and selects it.
function pasteObject(src, x, y) {
  if (!src) return;
  S.sel = S.objects.push({ ...src, x, y }) - 1;
  buildPanel();
  draw();
}

function removeObject() {
  if (!cur()) return;
  S.objects.splice(S.sel, 1);
  S.sel = Math.max(0, S.objects.length - 1);
  buildPanel();
  draw();
}

function setChoice(k, v, T = S) {
  T[k] = v;
  if (k === 'src') S.temp = v === 'lamp' ? 2700 : 5778; // incandescent filament, Sun's surface
  buildPanel();
  draw();
}

function buildPanel() {
  const box = $('#controls');
  box.textContent = '';
  for (const c of CONTROLS) {
    if ((c.o && !cur()) || (c.show && !c.show())) continue;
    const T = c.o ? cur() : S;
    const label = typeof c.label === 'function' ? c.label() : c.label;
    if (c.h) box.append(el('h2', {}, typeof c.h === 'function' ? c.h() : c.h));
    else if (c.note) box.append(el('p', { className: 'formula' }, c.note));
    else if (c.btn) box.append(el('button', { className: 'wide', onclick: c.act }, c.btn));
    else if (c.seg) {
      box.append(el('div', { className: 'seg', role: 'group' }, ...Object.entries(c.opts).map(([v, t]) =>
        el('button', { ariaPressed: String(T[c.k] === v), onclick: () => setChoice(c.k, v, T) }, t))));
    } else if (c.check) {
      box.append(el('label', { className: 'check' },
        el('input', { type: 'checkbox', checked: T[c.k], onchange: e => setChoice(c.k, e.target.checked, T) }), label));
    } else if (c.opts) {
      const sel = el('select', { onchange: e => setChoice(c.k, e.target.value, T) },
        ...Object.entries(c.opts).map(([v, t]) => el('option', { value: v }, t)));
      sel.value = T[c.k];
      box.append(el('label', { className: 'row' }, label, sel));
    } else {
      const out = el('output', {}, T[c.k] + (c.unit || ''));
      const input = el('input', { type: 'range', min: c.min, max: c.max, step: c.step });
      input.value = T[c.k];
      input.oninput = () => { T[c.k] = +input.value; out.textContent = T[c.k] + (c.unit || ''); draw(); };
      box.append(el('label', { className: 'row' }, el('span', {}, label, out), input));
    }
  }
}

function index(name, nm, ob) { // ob is the object whose custom settings apply, omitted for the medium
  if (name === 'Custom') return ob ? O.cauchy(ob.nCustom, ob.abbe)(nm / 1000) : S.nMedium;
  return O.MATERIALS[name](nm / 1000);
}

function sourceRays() {
  const a = S.sa * RAD, d = [Math.cos(a), Math.sin(a)], n = S.src === 'laser' ? 1 : S.rays, rays = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) - 0.5 : 0;
    if (S.src === 'lamp') {
      const b = a + f * S.spread * RAD;
      rays.push({ o: [S.sx, S.sy], d: [Math.cos(b), Math.sin(b)] });
    } else rays.push({ o: [S.sx - d[1] * f * S.beamW, S.sy + d[0] * f * S.beamW], d });
  }
  return rays;
}

// Wavelengths to trace, each with the display colour of its share of the source's power.
function spectrum() {
  if (S.src === 'laser') {
    const c = O.wavelengthToRGB(S.wl), m = Math.max(...c, 1e-6);
    return [{ lam: S.wl, rgb: c.map(v => v / m) }];
  }
  const out = [], sum = [0, 0, 0];
  for (let k = 0; k < S.samples; k++) {
    const lam = 390 + 320 * (k + 0.5) / S.samples, w = O.planck(lam, S.temp);
    const rgb = O.wavelengthToRGB(lam).map(v => v * w);
    rgb.forEach((v, i) => sum[i] += v);
    out.push({ lam, rgb });
  }
  const m = Math.max(...sum); // the undispersed beam peaks at full brightness
  for (const s of out) s.rgb = s.rgb.map(v => v / m);
  return out;
}

// shortcut: display values add linearly with no gamma curve, so a 4% reflection draws at 4% of the
// beam's value and looks darker than it would in reality. Raise Exposure to see weak rays.
// Upgrade to a float WebGL buffer with a tone-map pass if that matters.
const enc = v => Math.round(255 * Math.min(1, v));
const srcHalf = () => S.src === 'sun' ? Math.max(8, S.beamW / 2 + 3) : 8;
const objRadius = o => o.shape === 'cube' ? Math.hypot(o.w, o.h) / 2 : o.size;

function render() {
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);

  const bodies = S.objects.map(o => ({ o, els: O.makeShape(o.shape, o), x: o.x, y: o.y, rot: o.rot * RAD }));
  for (const b of bodies) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.beginPath();
    for (const e of b.els) {
      if (e.r === undefined) { ctx.lineTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by); }
      else ctx.arc(e.cx, e.cy, e.r, e.a0, e.a1);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(90,150,255,.10)';
    ctx.fill();
    ctx.strokeStyle = b.o === cur() ? '#7aa2ff' : '#3a5cae';
    ctx.lineWidth = b.o === cur() ? 2 : 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // Rays add up like light does, so overlapping colours recombine to white.
  const scAt = lam => ({
    objs: bodies.map(b => ({ ...b, nIn: index(b.o.material, lam, b.o) })),
    nOut: index(S.medium, lam), pol: S.pol, refl: S.refl,
  });
  const rays = sourceRays();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = S.src === 'laser' ? 2 : 1.2;
  for (const { lam, rgb } of spectrum()) {
    const sc = scAt(lam);
    const emit = (a, b, I) => {
      const g = I * S.gain;
      ctx.strokeStyle = `rgb(${enc(rgb[0] * g)},${enc(rgb[1] * g)},${enc(rgb[2] * g)})`;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    for (const r of rays) O.trace(sc, r.o, r.d, 1, emit);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Reference ray: the laser, or the middle ray of a white source at the sodium D line.
  const ref = rays[rays.length >> 1], lamRef = S.src === 'laser' ? S.wl : 589, ev = [];
  O.trace(scAt(lamRef), ref.o, ref.d, 1, () => {}, ev);
  const text = exportSetup(2), box = $('#json');
  if (!jsonBad && document.activeElement !== box && box.value !== text) { box.value = text; paint(); }
  if (S.angles) drawAngles(ev);
  readout(ev, lamRef, ref.d);

  ctx.save();
  ctx.translate(S.sx, S.sy);
  ctx.rotate(S.sa * RAD);
  ctx.fillStyle = '#2a2f3a';
  ctx.strokeStyle = '#8b93a7';
  ctx.lineWidth = 1.5;
  const hh = srcHalf();
  ctx.beginPath();
  ctx.moveTo(-BODY, 0);
  ctx.lineTo(-BODY - HANDLE, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-BODY, -hh, BODY, 2 * hh);
  ctx.moveTo(-BODY - HANDLE + 6, 0);
  ctx.arc(-BODY - HANDLE, 0, 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawAngles(ev) {
  const deg = r => (r / RAD).toFixed(1) + '°';
  const arcBetween = (p, u, v, r) => { // shorter arc from direction u to direction v
    const a = Math.atan2(u[1], u[0]);
    const diff = ((Math.atan2(v[1], v[0]) - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, a, a + diff, diff < 0);
    ctx.stroke();
  };
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const e of ev.slice(0, 6)) {
    const { p, N } = e;
    ctx.strokeStyle = '#8b93a7';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p[0] - N[0] * 46, p[1] - N[1] * 46);
    ctx.lineTo(p[0] + N[0] * 46, p[1] + N[1] * 46);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#d7dbe6';
    arcBetween(p, N, [N[0] * 2 * Math.cos(e.ti) - e.refl[0], N[1] * 2 * Math.cos(e.ti) - e.refl[1]], 24); // back along the incoming ray
    if (e.trans) arcBetween(p, [-N[0], -N[1]], e.trans, 24);
    ctx.fillStyle = '#d7dbe6';
    ctx.fillText(deg(e.ti), p[0] + N[0] * 58, p[1] + N[1] * 58);
    ctx.fillText(e.trans ? deg(e.tt) : 'TIR', p[0] - N[0] * 40, p[1] - N[1] * 40);
  }
}

function readout(ev, lam, d0) {
  const deg = r => (r / RAD).toFixed(1) + '°';
  const nO = index(S.medium, lam), nI = cur() ? index(cur().material, lam, cur()) : nO;
  const L = [`Wavelength ${lam} nm`, `n medium ${nO.toFixed(4)}`];
  if (cur()) L.push(`n selected object ${nI.toFixed(4)}`);
  if (nI !== nO) {
    L.push(`Critical angle ${deg(Math.asin(Math.min(nI, nO) / Math.max(nI, nO)))}, ${nI > nO ? 'inside the object' : 'in the medium'}`);
    L.push(`Brewster angle on entry ${deg(Math.atan(nI / nO))}`);
  }
  ev.slice(0, 6).forEach((e, i) => L.push(`${i + 1}. ` + (e.trans
    ? `${e.entering ? 'Enters' : 'Exits'} at θ₁ ${deg(e.ti)}, θ₂ ${deg(e.tt)}, ${(e.R * 100).toFixed(1)}% reflected`
    : `Total internal reflection at θ₁ ${deg(e.ti)}`)));
  if (!ev.length) L.push('The ray misses every object.');
  else if (ev.out) L.push(`Total deviation ${deg(Math.acos(Math.max(-1, Math.min(1, d0[0] * ev.out[0] + d0[1] * ev.out[1]))))}`);
  $('#readout').replaceChildren(...L.map(t => el('div', {}, t)));
}

let queued = false;
function draw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
  // Keep the address bar pointing at the current setup. Delayed because Safari throws on rapid replaceState.
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => { try { history.replaceState(null, '', setupURL()); } catch {} }, 400);
}
let urlTimer;

let drag = null;
cv.onpointerdown = e => {
  const mx = e.clientX, my = e.clientY, a = S.sa * RAD, c = Math.cos(a), s = Math.sin(a);
  const lx = c * (mx - S.sx) + s * (my - S.sy), ly = -s * (mx - S.sx) + c * (my - S.sy);
  if (Math.hypot(lx + BODY + HANDLE, ly) < 12) drag = { aim: true };
  else if (lx > -BODY - 4 && lx < 4 && Math.abs(ly) < srcHalf() + 4) drag = { T: S, kx: 'sx', ky: 'sy', dx: S.sx - mx, dy: S.sy - my };
  else for (let i = S.objects.length - 1; i >= 0 && !drag; i--) { // topmost first
    const o = S.objects[i];
    if (Math.hypot(mx - o.x, my - o.y) >= objRadius(o)) continue;
    drag = { T: o, kx: 'x', ky: 'y', dx: o.x - mx, dy: o.y - my };
    if (S.sel !== i) { S.sel = i; buildPanel(); draw(); }
  }
  if (drag) cv.setPointerCapture(e.pointerId);
};
cv.onpointermove = e => {
  if (!drag) return;
  if (drag.aim) S.sa = Math.round(Math.atan2(S.sy - e.clientY, S.sx - e.clientX) / RAD * 2) / 2;
  else { drag.T[drag.kx] = e.clientX + drag.dx; drag.T[drag.ky] = e.clientY + drag.dy; }
  draw();
};
cv.onpointerup = cv.onpointercancel = () => { if (drag && drag.aim) buildPanel(); drag = null; };
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (!cur()) return;
  cur().rot = Math.round((((cur().rot + e.deltaY * 0.05 + 540) % 360) - 180) * 2) / 2;
  buildPanel();
  draw();
}, { passive: false });
let mouse = null; // last pointer position over the canvas
cv.addEventListener('pointermove', e => { mouse = [e.clientX, e.clientY]; });
const typing = e => /SELECT|TEXTAREA/.test(e.target.tagName);
addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing(e)) removeObject();
});
// Copy puts the selected object on the system clipboard as JSON. Paste accepts that or a whole setup.
addEventListener('copy', e => {
  if (typing(e) || String(getSelection()) || !cur()) return;
  e.clipboardData.setData('text/plain', JSON.stringify({ object: cur() }));
  e.preventDefault();
});
addEventListener('paste', e => {
  if (typing(e)) return;
  let data;
  try { data = JSON.parse(e.clipboardData.getData('text')); } catch { return; }
  if (data && Array.isArray(data.objects)) { loadSetup(data); say('Setup loaded from the clipboard.'); }
  else if (data && data.object && typeof data.object === 'object') {
    const o = cleanObject(data.object);
    // Paste under the pointer so the user chooses a spot clear of other objects.
    if (mouse) pasteObject(o, mouse[0], mouse[1]);
    else pasteObject(o, o.x, o.y + 2 * objRadius(o) + 20);
  }
});

const say = t => { $('#status').textContent = t; };
const setupURL = () => location.href.split(/[?#]/)[0] + '?setup=' + encodeURIComponent(exportSetup());
const copy = (text, what, fallback) =>
  navigator.clipboard.writeText(text).then(() => say(what + ' copied to the clipboard.'), () => say(fallback));
const json = $('#json');
$('#export').onclick = () => { json.select(); copy(json.value, 'Setup JSON', 'Copy the selected text.'); };

// The textarea has transparent text and sits on top of a <pre> that shows the same text coloured.
const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const colour = line => esc(line).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  (m, str, colon, word) => str ? `<span class="${colon ? 'k' : 's'}">${str}</span>${colon || ''}` : `<span class="${word ? 'b' : 'n'}">${m}</span>`);
const paint = () => { $('#hl').innerHTML = json.value.split('\n').map(l => `<div>${colour(l)}</div>`).join(''); json.onscroll(); };
json.onscroll = () => { $('#hl').scrollTop = json.scrollTop; $('#hl').scrollLeft = json.scrollLeft; };

// jsonBad means the box holds text that does not parse. render() then leaves it alone so the edit is not lost.
let jsonBad = false;
function applyJSON() {
  try { loadSetup(JSON.parse(json.value)); jsonBad = false; }
  catch (err) { jsonBad = true; say('Not applied. ' + err.message); }
  $('#editor').classList.toggle('bad', jsonBad);
  return !jsonBad;
}
$('#format').onclick = () => { if (applyJSON()) say('Formatted.'); }; // render() rewrites the box indented
$('#revert').onclick = () => { jsonBad = false; $('#editor').classList.remove('bad'); draw(); say('Showing the current setup.'); };
$('#link').onclick = () => copy(setupURL(), 'Link', 'Copy the link from the address bar.');
// Edits to the JSON apply as soon as the text is valid. render() leaves the box alone while it has focus.
json.oninput = () => { paint(); if (applyJSON()) say('Applied.'); };
json.onblur = draw; // show the cleaned-up values once editing ends

for (const [k, [name, icon]] of Object.entries(SHAPES)) {
  const b = el('button', { title: 'Add ' + name.toLowerCase(), ariaLabel: 'Add ' + name.toLowerCase(), onclick: () => addObject(k) });
  b.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
  $('#shapes').append(b);
}
for (const [btn, panel] of [['#toggle', '#panel'], ['#toggleLeft', '#left']]) {
  $(btn).onclick = e => {
    const p = $(panel);
    p.hidden = !p.hidden;
    e.currentTarget.ariaExpanded = String(!p.hidden);
  };
}

S.cx = Math.max(680, innerWidth / 2); // where new objects appear, clear of the left panel
S.cy = innerHeight / 2;
S.sx = S.cx - 330;
S.sy = S.cy + 80;
S.objects.push(newObject('prism', S.cx, S.cy));
try {
  const q = new URLSearchParams(location.search).get('setup');
  if (q) loadSetup(JSON.parse(q));
} catch (err) { $('#status').textContent = 'Ignored the setup in the link. ' + err.message; }
addEventListener('resize', draw);
buildPanel();
draw();
