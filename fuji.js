// Shield – Mount Fuji als SVG, gemeinsam fuer Startseite und Oberflaeche.
// Der Umriss folgt dem echten Berg: eine Exponentialkurve (oben steil, unten weit auslaufend), abgeflachter Krater mit Rand,
// leichte Unruhe im Fels und die kleine Schulter des Hoei-Kraters an der Ostflanke. Dazu eine Schneekappe, deren Zungen den
// Rinnen folgen (also zum Gipfel hin zusammenlaufen), Rinnen und Grate, Licht- und Schattenseite, Dunst am Fuss und eine
// Linsenwolke ueber dem Gipfel. Farben kommen als CSS-Variablen der Seite (Tageszeit-Paletten), nichts ist fest verdrahtet.
(function () {
  'use strict';
  const r1 = n => Math.round(n * 10) / 10;
  const rng = seed => { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };

  // Weiche Kurve durch Punkte (Catmull-Rom -> Bezier)
  function smooth(pts) {
    let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
    }
    return d;
  }

  // Huegelkette: weiche Wellen aus drei Sinusanteilen, nach unten geschlossen
  function ridge(o) {
    const wl = o.wl || 260, r = rng(o.seed || 3), ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    const step = o.step || 36, pts = [];
    for (let x = o.x0; x <= o.x1 + step; x += step) {
      pts.push([x, o.y - o.amp * (0.55 * Math.sin(x / wl + ph[0]) + 0.3 * Math.sin(x / (0.43 * wl) + ph[1]) + 0.15 * Math.sin(x / (0.19 * wl) + ph[2]))]);
    }
    const b = o.bottom || 1000;
    return smooth(pts) + `L${r1(pts[pts.length - 1][0])} ${b}L${r1(pts[0][0])} ${b}Z`;
  }

  // Ferne Gebirgskette mit einzelnen Gipfeln (weiche Spitzen statt Zickzack)
  function range(o) {
    const r = rng(o.seed || 5), pts = [], step = o.step || 90;
    for (let x = o.x0; x <= o.x1 + step; x += step) {
      const peak = r() < 0.45 ? 0.5 + 0.5 * r() : 0.1 * r();
      pts.push([x, o.y - o.amp * peak]);
    }
    const b = o.bottom || 1000;
    return smooth(pts) + `L${r1(pts[pts.length - 1][0])} ${b}L${r1(pts[0][0])} ${b}Z`;
  }

  // o: { cx, baseY, H, L, id, light (-1 links / 1 rechts), v:{body,body2,snow,sun,haze,shade}, snowFrac, hat, seed, reach }
  function render(o) {
    const id = o.id || 'fj', cx = o.cx, baseY = o.baseY, H = o.H, L = o.L, S = H / 560;
    const light = o.light >= 0 ? 1 : -1;
    const V = Object.assign({ body: 'var(--fuji)', body2: 'var(--fuji2)', snow: 'var(--snow)', sun: 'var(--sun)', haze: 'var(--mist)', shade: '#150c28' }, o.v);
    const r = rng(o.seed || 11);
    const wTop = 0.028 * L, Ll = 0.97 * L, Lr = 1.05 * L;
    const X = o.reach || 1.7 * L;
    const yTop = baseY - H;
    const noise = ax => Math.sin(ax * 0.047 + 1.3) * 1.1 + Math.sin(ax * 0.131 + 0.4) * 0.7 + Math.sin(ax * 0.29 + 2.1) * 0.35;

    // Hoehe der Silhouette an der Stelle x (Abstand von der Achse)
    const Y = x => {
      const s = x < 0 ? -1 : 1, ax = Math.abs(x), Ls = s < 0 ? Ll : Lr;
      if (ax <= wTop) { const t = ax / wTop; return yTop + 3.4 * S * (1 - t * t) - 1.4 * S * (x / wTop) * (1 - t * t); } // Krater: Rand und leichte Mulde
      const d = ax - wTop;
      let h = H * Math.exp(-d / Ls);
      h += noise(ax) * S * Math.min(1, d / (0.06 * L)) * Math.exp(-d / (0.9 * L));
      if (s > 0) { const t = (ax - 0.60 * L) / (0.09 * L), t2 = (ax - 0.74 * L) / (0.06 * L); h += H * 0.014 * Math.exp(-t * t) - H * 0.007 * Math.exp(-t2 * t2); } // Hoei-Schulter
      return baseY - h;
    };
    // Abstand von der Achse in der Hoehe y, auf der Seite des Meridians f (fuer Rinnen und Schneezungen)
    const axAt = (y, f) => wTop + (f < 0 ? Ll : Lr) * Math.log(H / Math.max(baseY - y, 1));

    const xs = [];
    for (let x = -X; x < X; x += (Math.abs(x) < 0.3 * L ? 3 : 8)) xs.push(x);
    xs.push(X);
    const sil = xs.map(x => `${r1(cx + x)} ${r1(Y(x))}`);
    const bodyD = `M${r1(cx - X)} ${r1(baseY + 80)}L${sil.join('L')}L${r1(cx + X)} ${r1(baseY + 80)}Z`;

    // ---- Rinnen und Grate: Meridiane des Kegels, nach unten breiter, unterschiedlich lang ----
    const ribs = (n, w0m, growm, startLo, startHi, endMin) => {
      const shade = [], lit = [], hi = [];
      for (let i = 0; i < n; i++) {
        let phi = (-80 + 160 * r()) * Math.PI / 180;
        if (Math.abs(phi) < 0.14) phi += phi < 0 ? -0.3 : 0.3; // keine senkrechten Striche genau in der Mitte
        const f = Math.sin(phi);
        const yS = yTop + H * (startLo + (startHi - startLo) * r()), yEnd = baseY - H * 0.08;
        const yE = yS + (yEnd - yS) * (endMin + (1 - endMin) * r());
        const w0 = (0.9 + 0.9 * r()) * S * w0m, grow = (1.6 + 2.8 * r()) * S * growm;
        const A = [], B = [], C = [], D = [];
        for (let k = 0; k <= 14; k++) {
          const t = k / 14, y = yS + (yE - yS) * t;
          const x = f * axAt(y, f) + Math.sin(t * 7 + i * 1.7) * 2.4 * S * t;
          const w = (w0 + grow * t) * (1 - 0.4 * Math.abs(f)) * Math.min(1, 0.35 + t * 3); // oben spitz zulaufend
          A.push(`${r1(cx + x - w)} ${r1(y)}`); B.unshift(`${r1(cx + x + w)} ${r1(y)}`);
          const o2 = light * w * 1.9; C.push(`${r1(cx + x + o2 - w * 0.5)} ${r1(y)}`); D.unshift(`${r1(cx + x + o2 + w * 0.5)} ${r1(y)}`);
        }
        (Math.sign(f) === light ? lit : shade).push(`M${A.join('L')}L${B.join('L')}Z`);
        if (Math.sign(f) === light || Math.abs(f) < 0.3) hi.push(`M${C.join('L')}L${D.join('L')}Z`);
      }
      return { shade: shade.join(''), lit: lit.join(''), hi: hi.join('') };
    };
    const fine = ribs(15, 1, 1, 0.03, 0.4, 0.35), broad = ribs(7, 3.2, 3.4, 0.08, 0.3, 0.6);

    // ---- Schneekappe: Grenze entlang der Meridiane, Zungen in den Rinnen laufen zum Gipfel zusammen ----
    const sf = o.snowFrac === undefined ? 0.36 : o.snowFrac;
    let snowD = '', rimD = '';
    if (sf > 0) {
      const hS = H * (1 - sf), yS = baseY - hS, capH = H * sf;
      const rS = Math.max(axAt(yS, -1), axAt(yS, 1));
      const tongues = [], nT = 12;
      for (let k = 0; k < nT; k++) {
        const long = r() < 0.4;
        tongues.push({ phi: -80 + 160 * (k + 0.15 + 0.7 * r()) / nT, hw: long ? 1.5 + 1.8 * r() : 1.8 + 2.8 * r(), d: capH * (long ? 0.36 + 0.28 * r() : 0.07 + 0.2 * r()) });
      }
      const low = [];
      for (let deg = 90; deg >= -90; deg -= 0.7) {
        const phi = deg * Math.PI / 180, f = Math.sin(phi), c = Math.cos(phi);
        const base = (Math.sin(deg * 0.21 + 1.1) * 0.5 + Math.sin(deg * 0.47 + 0.3) * 0.3) * 0.04 * H + 0.09 * rS * c; // Grate ragen hinein, Wölbung zur Mitte
        let t = 0;
        for (const g of tongues) { const dd = Math.abs(deg - g.phi) / g.hw; if (dd < 1) t = Math.max(t, g.d * Math.pow(1 - dd, 1.3)); }
        const y = yS + (base + t) * Math.pow(c, 0.55) + noise(deg * 3) * 0.7 * S * c;
        low.push(`${r1(cx + f * axAt(y, f))} ${r1(y)}`);
      }
      const xL = -axAt(yS, -1), xR = axAt(yS, 1), top = [];
      for (let x = xL; x <= xR; x += (Math.abs(x) < 0.3 * L ? 3 : 6)) top.push(`${r1(cx + x)} ${r1(Y(x))}`);
      snowD = `M${top.join('L')}L${low.join('L')}Z`;
      const rim = [], xe = light > 0 ? xR : xL;
      for (let x = light * wTop; Math.abs(x) <= Math.abs(xe); x += light * 4) rim.push(`${r1(cx + x)} ${r1(Y(x))}`);
      rimD = `M${rim.join('L')}`;
    }

    // ---- Farbverlaeufe ----
    const lx1 = light > 0 ? cx - X * 0.9 : cx + X * 0.9, lx2 = light > 0 ? cx + X * 0.9 : cx - X * 0.9; // von Schattenseite nach Lichtseite
    const defs = `<defs>
      <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${r1(yTop)}" x2="0" y2="${r1(baseY)}"><stop offset="0" stop-color="${V.body2}"/><stop offset=".62" stop-color="color-mix(in srgb, ${V.body2} 38%, ${V.body})"/><stop offset="1" stop-color="${V.body}"/></linearGradient>
      <linearGradient id="${id}s" gradientUnits="userSpaceOnUse" x1="${r1(lx1)}" y1="0" x2="${r1(lx2)}" y2="0"><stop offset="0" stop-color="${V.shade}" stop-opacity=".5"/><stop offset=".42" stop-color="${V.shade}" stop-opacity=".2"/><stop offset=".62" stop-color="${V.shade}" stop-opacity="0"/><stop offset="1" stop-color="${V.shade}" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}l" gradientUnits="userSpaceOnUse" x1="${r1(lx2)}" y1="0" x2="${r1(cx)}" y2="0"><stop offset="0" stop-color="${V.sun}" stop-opacity=".4"/><stop offset="1" stop-color="${V.sun}" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}z" gradientUnits="userSpaceOnUse" x1="0" y1="${r1(baseY - H * 0.55)}" x2="0" y2="${r1(baseY)}"><stop offset="0" stop-color="${V.haze}" stop-opacity="0"/><stop offset="1" stop-color="${V.haze}" stop-opacity=".85"/></linearGradient>
      <linearGradient id="${id}r" gradientUnits="userSpaceOnUse" x1="0" y1="${r1(yTop)}" x2="0" y2="${r1(yTop + H * 0.45)}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <radialGradient id="${id}h"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <filter id="${id}f" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${r1(1.5 * S + 0.3)}"/></filter>
      <filter id="${id}g" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${r1(3.2 * S + 0.4)}"/></filter>
      <clipPath id="${id}c"><path d="${bodyD}"/></clipPath>
      ${snowD ? `<clipPath id="${id}n"><path d="${snowD}"/></clipPath>` : ''}
    </defs>`;

    const wX = X + 20, rect = (fill, y0, h) => `<rect x="${r1(cx - wX)}" y="${r1(y0)}" width="${r1(wX * 2)}" height="${r1(h)}" fill="${fill}"/>`;
    let out = defs;
    out += `<g clip-path="url(#${id}c)">`
      + `<path d="${bodyD}" fill="url(#${id}b)"/>`
      + rect(`url(#${id}s)`, yTop - 10, H + 100)
      + rect(`url(#${id}l)`, yTop - 10, H + 100)
      + `<g filter="url(#${id}g)"><path d="${broad.shade}" fill="${V.shade}" fill-opacity=".2"/><path d="${broad.hi}" fill="${V.snow}" fill-opacity=".08"/></g>`
      + `<g filter="url(#${id}f)"><path d="${fine.shade}" fill="${V.shade}" fill-opacity=".2"/><path d="${fine.lit}" fill="${V.shade}" fill-opacity=".11"/><path d="${fine.hi}" fill="${V.snow}" fill-opacity=".1"/></g>`
      + rect(`url(#${id}z)`, baseY - H * 0.55, H * 0.55 + 100)
      + `</g>`;
    if (snowD) {
      out += `<path d="${snowD}" fill="${V.snow}"/>`
        + `<g clip-path="url(#${id}n)">`
        + rect(`url(#${id}s)`, yTop - 10, H)
        + `<g filter="url(#${id}f)"><path d="${fine.shade}${fine.lit}" fill="${V.body}" fill-opacity=".2"/></g>`
        + `<g filter="url(#${id}g)"><path d="${broad.shade}${broad.lit}" fill="${V.body}" fill-opacity=".14"/></g>`
        + `</g>`
        + `<path d="${rimD}" fill="none" stroke="url(#${id}r)" stroke-width="${r1(1.6 * Math.max(S, 0.8))}" stroke-linecap="round"/>`;
    }
    if (o.hat !== false) {
      const hy = yTop + 22 * S, hx = cx + (light > 0 ? -22 : 22) * S;
      out += `<g class="fuji-hat">`
        + `<ellipse cx="${r1(hx)}" cy="${r1(hy)}" rx="${r1(0.36 * L)}" ry="${r1(17 * S)}" fill="url(#${id}h)" opacity=".8"/>`
        + `<ellipse cx="${r1(hx + 26 * S)}" cy="${r1(hy + 20 * S)}" rx="${r1(0.25 * L)}" ry="${r1(13 * S)}" fill="url(#${id}h)" opacity=".75"/>`
        + `<ellipse cx="${r1(hx - 16 * S)}" cy="${r1(hy + 38 * S)}" rx="${r1(0.16 * L)}" ry="${r1(9 * S)}" fill="url(#${id}h)" opacity=".65"/>`
        + `</g>`;
    }
    return out;
  }

  window.ShieldFuji = { render, ridge, range, smooth };
})();
