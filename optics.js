// Ray optics in a 2D cross-section: dispersion, Snell refraction, Fresnel reflection.
// Plain script so index.html works from file:// and node can require it for tests.
(function (root) {
  'use strict';
  const TAU = 2 * Math.PI, EPS = 1e-6, FAR = 1e4, MAX_DEPTH = 16, MIN_I = 0.002;

  // Sellmeier: n^2 = 1 + sum(B_i L^2 / (L^2 - C_i)), wavelength L in micrometres.
  const sellmeier = (B, C) => um => {
    const l2 = um * um;
    let s = 1;
    for (let i = 0; i < B.length; i++) s += B[i] * l2 / (l2 - C[i]);
    return Math.sqrt(s);
  };

  // Cauchy n = A + B/L^2 fitted to the index at 587.6 nm and the Abbe number.
  const cauchy = (nd, abbe) => {
    const B = (nd - 1) / (abbe * (1 / 0.4861 ** 2 - 1 / 0.6563 ** 2));
    const A = nd - B / 0.5876 ** 2;
    return um => A + B / (um * um);
  };

  const MATERIALS = {
    'Vacuum': () => 1,
    // Ciddor 1996, standard air
    'Air': um => 1 + 0.05792105 / (238.0185 - 1 / (um * um)) + 0.00167917 / (57.362 - 1 / (um * um)),
    // Daimon and Masumura 2007, 20 C
    'Water': sellmeier([0.5684027565, 0.1726177391, 0.02086189578, 0.1130748688],
      [0.005101829712, 0.01821153936, 0.02620722293, 10.69792721]),
    // Malitson 1965
    'Fused silica': sellmeier([0.6961663, 0.4079426, 0.8974794], [0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2]),
    // Sultanova 2009
    'Acrylic (PMMA)': sellmeier([1.1819], [0.011313]),
    // Schott catalogue
    'Crown glass (BK7)': sellmeier([1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]),
    'Flint glass (SF10)': sellmeier([1.62153902, 0.256287842, 1.64447552], [0.0122241457, 0.0595736775, 147.468793]),
    // Peter 1923
    'Diamond': sellmeier([0.3306, 4.3356], [0.175 ** 2, 0.106 ** 2]),
  };

  // One interface. d is the unit ray direction, N the unit normal on the incoming side.
  function interact(d, N, n1, n2, pol) {
    const ci = Math.min(1, -(d[0] * N[0] + d[1] * N[1]));
    const eta = n1 / n2, s2 = eta * eta * (1 - ci * ci);
    const refl = [d[0] + 2 * ci * N[0], d[1] + 2 * ci * N[1]];
    const ti = Math.acos(ci);
    if (s2 >= 1) return { R: 1, refl, trans: null, ti, tt: null }; // total internal reflection
    const ct = Math.sqrt(1 - s2);
    const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
    const rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
    const R = pol === 's' ? rs * rs : pol === 'p' ? rp * rp : (rs * rs + rp * rp) / 2;
    const k = eta * ci - ct;
    return { R, refl, trans: [eta * d[0] + k * N[0], eta * d[1] + k * N[1]], ti, tt: Math.acos(ct) };
  }

  // Shapes are closed boundaries of segments and arcs in local coordinates around an
  // interior origin. Elements are listed in drawing order so the UI can fill the outline.
  function seg(ax, ay, bx, by) {
    let nx = by - ay, ny = ax - bx;
    const l = Math.hypot(nx, ny);
    nx /= l; ny /= l;
    if (nx * ax + ny * ay < 0) { nx = -nx; ny = -ny; } // outward means away from the origin
    return { ax, ay, bx, by, nx, ny };
  }
  // sign is +1 when the material is inside the circle, -1 when it is outside (concave face)
  const arc = (cx, cy, r, a0, a1, sign = 1) => ({ cx, cy, r, a0, a1, sign });
  const poly = pts => pts.map((p, i) => seg(p[0], p[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]));

  function makeShape(kind, p) {
    const s = p.size, PI = Math.PI;
    const R = Math.max(p.lensR || 0, s * 1.02), f = Math.asin(s / R);
    switch (kind) {
      case 'cylinder': return [arc(0, 0, s, 0, TAU)];
      case 'prism': {
        const a = p.apex * PI / 360, hx = s * Math.sin(a), hy = s * Math.cos(a);
        return poly([[0, -2 * hy / 3], [hx, hy / 3], [-hx, hy / 3]]);
      }
      case 'cube': return poly([[-p.w / 2, -p.h / 2], [p.w / 2, -p.h / 2], [p.w / 2, p.h / 2], [-p.w / 2, p.h / 2]]);
      case 'half': {
        const k = 4 * s / (3 * PI);
        return [arc(-k, 0, s, -PI / 2, PI / 2), seg(-k, s, -k, -s)];
      }
      case 'convex': {
        const c = Math.sqrt(R * R - s * s);
        return [arc(c, 0, R, PI - f, PI + f), arc(-c, 0, R, -f, f)];
      }
      case 'concave': {
        const xc = 10 + R, xe = xc - R * Math.cos(f); // 20 px thick at the centre
        return [arc(-xc, 0, R, -f, f, -1), seg(-xe, s, xe, s), arc(xc, 0, R, PI - f, PI + f, -1), seg(xe, -s, -xe, -s)];
      }
    }
    throw new Error('unknown shape ' + kind);
  }

  // Nearest boundary crossing along a local-frame ray. Returns distance and outward normal.
  function hitLocal(els, ox, oy, dx, dy) {
    let bt = Infinity, bn = null;
    for (const e of els) {
      if (e.r === undefined) {
        const ex = e.bx - e.ax, ey = e.by - e.ay, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((e.ax - ox) * ey - (e.ay - oy) * ex) / den;
        const u = ((e.ax - ox) * dy - (e.ay - oy) * dx) / den;
        if (t > EPS && t < bt && u >= 0 && u <= 1) { bt = t; bn = [e.nx, e.ny]; }
      } else {
        const fx = ox - e.cx, fy = oy - e.cy, b = fx * dx + fy * dy;
        const disc = b * b - (fx * fx + fy * fy - e.r * e.r);
        if (disc < 0) continue;
        const q = Math.sqrt(disc);
        for (const t of [-b - q, -b + q]) {
          if (t <= EPS || t >= bt) continue;
          const px = fx + t * dx, py = fy + t * dy;
          let da = (Math.atan2(py, px) - e.a0) % TAU;
          if (da < 0) da += TAU;
          if (da <= e.a1 - e.a0 + 1e-9) { bt = t; bn = [e.sign * px / e.r, e.sign * py / e.r]; }
        }
      }
    }
    return bn && { t: bt, n: bn };
  }

  // Follows a ray and its reflected and refracted children.
  // sc: {objs: [{els, x, y, rot (radians), nIn}], nOut, pol, refl}. emit(a, b, intensity) gets every segment.
  // shortcut: objects are assumed not to overlap, the far side of every surface is nOut or that
  // object's nIn. Track a stack of entered objects if overlapping (nested) media are needed.
  // ev, if given, collects the interfaces along the main path (refracted, or reflected on TIR).
  function trace(sc, o, d, I, emit, ev, depth = 0) {
    let h = null, c, s, nIn;
    for (const ob of sc.objs) {
      const oc = Math.cos(ob.rot), os = Math.sin(ob.rot), lx = o[0] - ob.x, ly = o[1] - ob.y;
      const k = hitLocal(ob.els, oc * lx + os * ly, -os * lx + oc * ly, oc * d[0] + os * d[1], -os * d[0] + oc * d[1]);
      if (k && (!h || k.t < h.t)) { h = k; c = oc; s = os; nIn = ob.nIn; }
    }
    if (!h) {
      emit(o, [o[0] + d[0] * FAR, o[1] + d[1] * FAR], I);
      if (ev) ev.out = d;
      return;
    }
    const p = [o[0] + d[0] * h.t, o[1] + d[1] * h.t];
    emit(o, p, I);
    let N = [c * h.n[0] - s * h.n[1], s * h.n[0] + c * h.n[1]];
    const entering = d[0] * N[0] + d[1] * N[1] < 0;
    if (!entering) N = [-N[0], -N[1]];
    const r = interact(d, N, entering ? sc.nOut : nIn, entering ? nIn : sc.nOut, sc.pol);
    if (ev) ev.push({ p, N, entering, ...r });
    if (depth >= MAX_DEPTH) return;
    if (r.trans && I * (1 - r.R) > MIN_I) trace(sc, p, r.trans, I * (1 - r.R), emit, ev, depth + 1);
    if ((!r.trans || sc.refl) && I * r.R > MIN_I) trace(sc, p, r.refl, I * r.R, emit, r.trans ? null : ev, depth + 1);
  }

  // Wavelength in nm to linear sRGB, using the Wyman, Sloan and Shirley 2013 fit of the
  // CIE 1931 colour matching functions. Out-of-gamut negatives clamp to zero.
  function wavelengthToRGB(nm) {
    const g = (mu, s1, s2) => Math.exp(-0.5 * ((nm - mu) / (nm < mu ? s1 : s2)) ** 2);
    const X = 1.056 * g(599.8, 37.9, 31.0) + 0.362 * g(442.0, 16.0, 26.7) - 0.065 * g(501.1, 20.4, 26.2);
    const Y = 0.821 * g(568.8, 46.9, 40.5) + 0.286 * g(530.9, 16.3, 31.1);
    const Z = 1.217 * g(437.0, 11.8, 36.0) + 0.681 * g(459.0, 26.0, 13.8);
    return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z]
      .map(v => Math.max(0, v));
  }

  // Blackbody spectral radiance, arbitrary units. hc/k = 1.438777e7 nm K.
  const planck = (nm, T) => 1e15 / (nm ** 5 * (Math.exp(1.438777e7 / (nm * T)) - 1));

  const Optics = { MATERIALS, cauchy, interact, makeShape, trace, wavelengthToRGB, planck, FAR };
  if (typeof module !== 'undefined') module.exports = Optics;
  else root.Optics = Optics;
})(this);
