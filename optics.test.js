// Run with: node optics.test.js
const assert = require('assert');
const O = require('./optics.js');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}`);
const deg = Math.PI / 180;
const noop = () => {};

// Refractive indices against published catalogue values
const n = (name, nm) => O.MATERIALS[name](nm / 1000);
near(n('Crown glass (BK7)', 587.6), 1.5168, 2e-4, 'BK7');
near(n('Flint glass (SF10)', 587.6), 1.7283, 2e-4, 'SF10');
near(n('Fused silica', 587.6), 1.4585, 2e-4, 'silica');
near(n('Water', 589), 1.33336, 1e-4, 'water'); // absolute index, 1.33299 relative to air
near(n('Acrylic (PMMA)', 587.6), 1.491, 1e-3, 'PMMA');
near(n('Diamond', 589), 1.417 + 1, 3e-3, 'diamond');
near(n('Air', 589), 1.000277, 1e-5, 'air');
assert(n('Crown glass (BK7)', 450) > n('Crown glass (BK7)', 650), 'normal dispersion');
const cu = O.cauchy(1.6, 40);
near(cu(0.5876), 1.6, 1e-12, 'cauchy nd');
near((1.6 - 1) / (cu(0.4861) - cu(0.6563)), 40, 1e-9, 'cauchy abbe');

// Fresnel and Snell at one interface
const inc = t => [Math.sin(t), Math.cos(t)], N = [0, -1];
near(O.interact(inc(0), N, 1, 1.5).R, 0.04, 1e-12, 'normal incidence reflectance');
near(O.interact(inc(Math.atan(1.5)), N, 1, 1.5, 'p').R, 0, 1e-12, 'Brewster angle');
const sn = O.interact(inc(40 * deg), N, 1, 1.5);
near(Math.sin(40 * deg), 1.5 * Math.sin(sn.tt), 1e-12, 'Snell');
near(Math.hypot(...sn.trans), 1, 1e-12, 'refracted direction is unit length');
assert.strictEqual(O.interact(inc(45 * deg), N, 1.5, 1).trans, null, 'TIR past 41.8 degrees');
assert(O.interact(inc(41 * deg), N, 1.5, 1).trans, 'refracts below the critical angle');

const body = (kind, p, at) => ({ els: O.makeShape(kind, p), x: 0, y: 0, rot: 0, nIn: 1.5, ...at });
const scene = (kind, p, extra, at) => ({ objs: [body(kind, p, at)], nOut: 1, pol: 'u', refl: false, ...extra });

// Equilateral prism at minimum deviation: D = 2 asin(n sin(A/2)) - A
{
  const sc = scene('prism', { size: 200, apex: 60 });
  const ti = Math.asin(1.5 * 0.5), a = ti - 30 * deg;
  const d = [Math.cos(a), -Math.sin(a)];
  const hx = 100, hy = 200 * Math.cos(30 * deg), mid = [-hx / 2, -hy / 6];
  const ev = [];
  O.trace(sc, [mid[0] - 300 * d[0], mid[1] - 300 * d[1]], d, 1, noop, ev);
  assert.strictEqual(ev.length, 2, 'prism: two surfaces');
  near(ev[0].ti, ti, 1e-9, 'prism incidence angle');
  near(ev[1].tt, ti, 1e-9, 'prism symmetric exit');
  near(Math.acos(d[0] * ev.out[0] + d[1] * ev.out[1]), 2 * ti - 60 * deg, 1e-9, 'prism minimum deviation');
}

// Parallel-sided block: the ray leaves parallel to how it came in
{
  const sc = scene('cube', { w: 100, h: 100 });
  const d = [Math.cos(30 * deg), Math.sin(30 * deg)], ev = [];
  O.trace(sc, [-50 - 100 * d[0], -20 - 100 * d[1]], d, 1, noop, ev);
  assert.strictEqual(ev.length, 2, 'block: two surfaces');
  near(ev[0].tt, Math.asin(0.5 / 1.5), 1e-9, 'block refraction angle');
  near(ev.out[0], d[0], 1e-9, 'block exit dx');
  near(ev.out[1], d[1], 1e-9, 'block exit dy');
}

// Every shape: an axial ray crosses two surfaces undeviated, also when rotated half a turn
for (const kind of ['cylinder', 'cube', 'half', 'convex', 'concave']) {
  for (const rot of [0, Math.PI]) {
    const ev = [];
    O.trace(scene(kind, { size: 80, w: 100, h: 100, lensR: 200 }, {}, { rot }), [-500, 0], [1, 0], 1, noop, ev);
    assert.strictEqual(ev.length, 2, `${kind}: two surfaces`);
    assert(ev[0].entering && !ev[1].entering, `${kind}: enters then exits`);
    near(ev.out[1], 0, 1e-9, `${kind}: axial ray undeviated`);
  }
}

// Two objects: a ray crosses four surfaces, each with its own index, and leaves undeviated
{
  const p = { w: 100, h: 100 }, ev = [];
  const sc = { objs: [body('cube', p), body('cube', p, { x: 300, y: 90, nIn: 2.4 })], nOut: 1, pol: 'u', refl: false };
  const d = [Math.cos(20 * deg), Math.sin(20 * deg)];
  O.trace(sc, [-50 - 100 * d[0], -20 - 100 * d[1]], d, 1, noop, ev);
  assert.strictEqual(ev.length, 4, 'two blocks: four surfaces');
  near(ev[0].tt, Math.asin(Math.sin(20 * deg) / 1.5), 1e-9, 'first block index');
  near(ev[2].tt, Math.asin(Math.sin(20 * deg) / 2.4), 1e-9, 'second block index');
  near(ev.out[1], d[1], 1e-9, 'two blocks: exit parallel');
}

// Convex lens converges an off-axis ray, concave lens diverges it
{
  const out = kind => { const ev = []; O.trace(scene(kind, { size: 80, lensR: 200 }), [-500, -30], [1, 0], 1, noop, ev); return ev.out[1]; };
  assert(out('convex') > 0, 'convex lens bends the ray toward the axis');
  assert(out('concave') < 0, 'concave lens bends the ray away from the axis');
}

// Energy conservation with reflections on: escaping power sums to the input, less the cutoff
{
  let escaped = 0;
  const emit = (a, b, I) => { if (Math.hypot(b[0] - a[0], b[1] - a[1]) > O.FAR * 0.99) escaped += I; };
  O.trace(scene('cylinder', { size: 100 }, { refl: true }), [-500, 60], [1, 0], 1, emit);
  assert(escaped > 0.97 && escaped <= 1 + 1e-9, `energy conserved, got ${escaped}`);
}

// Colour
const dom = nm => { const c = O.wavelengthToRGB(nm); return c.indexOf(Math.max(...c)); };
assert.deepStrictEqual([dom(650), dom(530), dom(450)], [0, 1, 2], 'red, green, blue wavelengths');
assert(O.planck(450, 2700) < O.planck(650, 2700) && O.planck(450, 10000) > O.planck(650, 10000), 'Planck colour shift');

console.log('optics: all checks passed');
