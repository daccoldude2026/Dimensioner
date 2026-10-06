// Pure helpers for Grid Dimensioner. No DOM access, so they run in the browser and in Node tests.

/** Round to the nearest 1/2 inch. */
export const roundHalf = (v) => Math.round(v * 2) / 2;

/** 108.5 -> 108.5" */
export function fmtIn(v) {
  return `${roundHalf(v)}"`;
}

/** 108.5 -> 9'-0 1/2"   (never 9'-1/2") */
export function ftIn(v) {
  const t = roundHalf(Math.abs(v));
  const f = Math.floor(t / 12);
  const i = t - 12 * f;
  const w = Math.floor(i);
  const half = i - w > 0;
  return `${f}'-${w}${half ? ' 1/2' : ''}"`;
}

/** Format a length in inches. units: 'ft' (feet-inches) or 'in' (inches). */
export function fmtLen(v, units = 'ft') {
  return units === 'ft' ? ftIn(v) : fmtIn(v);
}

/** Per-axis scale from two clicked points along one axis and the real distance between them (inches). */
export function scaleFromRef(a, b, axis, realInches) {
  const px = axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  if (!(px > 0) || !(realInches > 0)) throw new Error('Reference points and distance must be greater than zero');
  return px / realInches; // pixels per inch
}

/** Real length (inches) between two image points, using separate x/y scales (px per inch). */
export function measure(a, b, scale) {
  return Math.hypot((b.x - a.x) / scale.sx, (b.y - a.y) / scale.sy);
}

/** Snap b to a horizontal or vertical run from a. */
export function snapAxis(a, b) {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

/** Parallel copy of segment a-b moved by `off` px along its unit normal (-uy, ux). */
export function offsetSegment(a, b, off) {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / L;
  const ny = (b.x - a.x) / L;
  return {
    a: { x: a.x + nx * off, y: a.y + ny * off },
    b: { x: b.x + nx * off, y: b.y + ny * off },
    n: { x: nx, y: ny },
  };
}

/** Triangle points for an arrowhead at `tip`, pointing along `angle` (radians). */
export function arrowHead(tip, angle, len = 14, half = 0.33) {
  return [
    tip,
    { x: tip.x - len * Math.cos(angle - half), y: tip.y - len * Math.sin(angle - half) },
    { x: tip.x - len * Math.cos(angle + half), y: tip.y - len * Math.sin(angle + half) },
  ];
}

/** Keep text upright: map any angle (radians) into (-90deg, 90deg]. */
export function uprightAngle(rad) {
  let d = (rad * 180) / Math.PI;
  while (d > 90) d -= 180;
  while (d <= -90) d += 180;
  return (d * Math.PI) / 180;
}

/** Positions of grid labels along one axis. k counts grid squares from the origin. */
export function gridTicks(originPx, pitchPx, minPx, maxPx, dir = 1) {
  const out = [];
  if (!(pitchPx > 0)) return out;
  for (let k = 0; k < 10000; k++) {
    const pos = originPx + dir * k * pitchPx;
    if (pos < minPx - 0.5 || pos > maxPx + 0.5) {
      if (k > 0) break;
      continue;
    }
    out.push({ k, pos });
  }
  return out;
}

/** Label text for the k-th grid line: distance from the origin in feet (e.g. 2', 4', 6'). */
export function gridLabel(k, gridFeet = 2) {
  return `${k * gridFeet}'`;
}

/**
 * Estimate grid pitch (px) and phase (px) of evenly spaced grid lines from a 1-D darkness profile
 * (mean of 255-gray along the other axis). Returns null when no periodic grid is found.
 */
export function detectPitch(profile, minPitch = 8) {
  const n = profile.length;
  if (n < minPitch * 6) return null;
  // high-pass: subtract a moving average so slow lighting changes do not dominate
  const w = Math.max(9, Math.round(n / 60) | 1);
  const hp = new Float64Array(n);
  let acc = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + profile[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1);
    hp[i] = profile[i] - (pre[hi] - pre[lo]) / (hi - lo);
    acc += hp[i] * hp[i];
  }
  if (acc < 1e-9) return null;
  // autocorrelation over plausible lags
  const maxLag = Math.floor(n / 4);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minPitch; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += hp[i] * hp[i + lag];
    ac[lag] = s / (n - lag);
  }
  // first strong local maximum (avoid picking multiples of the true pitch)
  let best = -1, bestV = 0;
  for (let lag = minPitch + 1; lag <= maxLag; lag++) if (ac[lag] > bestV) { bestV = ac[lag]; best = lag; }
  if (best < 0) return null;
  let lag0 = best;
  for (let lag = minPitch + 1; lag < best; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0.6 * bestV) { lag0 = lag; break; }
  }
  // phase: best comb alignment
  let phase = 0, phaseV = -Infinity;
  for (let p = 0; p < lag0; p++) {
    let s = 0;
    for (let x = p; x < n; x += lag0) s += hp[x];
    if (s > phaseV) { phaseV = s; phase = p; }
  }
  // refine: pick the local maximum near each predicted line and regress position on index
  const pts = [];
  let hpMax = -Infinity;
  for (let i = 0; i < n; i++) if (hp[i] > hpMax) hpMax = hp[i];
  for (let k = 0; phase + k * lag0 < n; k++) {
    const c = Math.round(phase + k * lag0);
    let bi = -1, bv = -Infinity;
    for (let x = Math.max(0, c - Math.floor(lag0 / 4)); x <= Math.min(n - 1, c + Math.floor(lag0 / 4)); x++) {
      if (hp[x] > bv) { bv = hp[x]; bi = x; }
    }
    if (bi >= 0 && bv > 0.25 * hpMax) pts.push([k, bi]);
  }
  if (pts.length < 4) return null;
  const m = pts.length;
  const sk = pts.reduce((s, p) => s + p[0], 0), sx = pts.reduce((s, p) => s + p[1], 0);
  const skk = pts.reduce((s, p) => s + p[0] * p[0], 0), skx = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const den = m * skk - sk * sk;
  if (Math.abs(den) < 1e-9) return null;
  const pitch = (m * skx - sk * sx) / den;
  const origin = (sx - pitch * sk) / m;
  const first = origin + pitch * pts[0][0], last = origin + pitch * pts[m - 1][0];
  return { pitch, origin, first, last, lines: m, strength: bestV / (acc / n) };
}

/** Detect grid pitch on both axes from grayscale pixels (Uint8 array, row-major). */
export function detectGrid(gray, width, height) {
  const col = new Float64Array(width), row = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = 255 - gray[y * width + x];
      col[x] += v / height;
      row[y] += v / width;
    }
  }
  return { x: detectPitch(col), y: detectPitch(row) };
}

/** Minimal PDF writer: one JPEG per page, page size = image size in points. */
export function buildPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let len = 0;
  const push = (u8) => { chunks.push(u8); len += u8.length; };
  const text = (s) => push(enc.encode(s));
  const obj = (n, fn) => { offsets[n] = len; text(`${n} 0 obj\n`); fn(); text('endobj\n'); };
  text('%PDF-1.4\n');
  const np = pages.length;
  // objects: 1 catalog, 2 pages, then per page: page, content, image
  obj(1, () => text('<< /Type /Catalog /Pages 2 0 R >>\n'));
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(2, () => text(`<< /Type /Pages /Kids [${kids}] /Count ${np} >>\n`));
  pages.forEach((p, i) => {
    const pn = 3 + i * 3, cn = pn + 1, im = pn + 2;
    obj(pn, () => text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>\n`));
    const content = `q ${p.w} 0 0 ${p.h} 0 0 cm /Im0 Do Q\n`;
    obj(cn, () => { text(`<< /Length ${content.length} >>\nstream\n`); text(content); text('endstream\n'); });
    obj(im, () => {
      text(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg); text('\nendstream\n');
    });
  });
  const total = 2 + np * 3;
  const xref = len;
  text(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) text(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** The single footer line required by the house rules. */
export function footerText(gridFeet, units, labelsInFeet) {
  const g = `${gridFeet}'-0" x ${gridFeet}'-0"`;
  const lab = labelsInFeet ? ' (grid labels in feet)' : '';
  return `Scale: grid = ${g}${lab}. Dimensions in ${units === 'ft' ? 'feet-inches' : 'inches'}, nearest 1/2".`;
}
