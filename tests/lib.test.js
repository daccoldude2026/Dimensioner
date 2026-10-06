import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundHalf, fmtIn, ftIn, fmtLen, scaleFromRef, measure, snapAxis, offsetSegment,
  arrowHead, uprightAngle, gridTicks, gridLabel, detectPitch, detectGrid, buildPdf, footerText,
} from '../src/lib.js';

test('rounds to nearest 1/2 inch', () => {
  assert.equal(roundHalf(108.26), 108.5);
  assert.equal(roundHalf(108.24), 108);
  assert.equal(fmtIn(108.5), '108.5"');
  assert.equal(fmtIn(280), '280"');
});

test('feet-inches formatting, including the 1/2" case', () => {
  assert.equal(ftIn(1200), "100'-0\"");
  assert.equal(ftIn(108.5), "9'-0 1/2\"");
  assert.equal(ftIn(263), "21'-11\"");
  assert.equal(ftIn(1160.5), "96'-8 1/2\"");
  assert.equal(ftIn(12.5), "1'-0 1/2\"");
  assert.equal(ftIn(143.75), "12'-0\""); // rounds up to the next 1/2" first
  assert.equal(fmtLen(108.5, 'in'), '108.5"');
  assert.equal(fmtLen(108.5, 'ft'), "9'-0 1/2\"");
});

test('scale from two reference points and per-axis measuring', () => {
  const sx = scaleFromRef({ x: 100, y: 50 }, { x: 484, y: 50 }, 'x', 240); // 10 squares of 24"
  assert.ok(Math.abs(sx - 1.6) < 1e-9);
  const sy = scaleFromRef({ x: 10, y: 100 }, { x: 10, y: 400 }, 'y', 150);
  assert.equal(sy, 2);
  const scale = { sx, sy };
  assert.ok(Math.abs(measure({ x: 0, y: 0 }, { x: 320, y: 0 }, scale) - 200) < 1e-9);
  assert.ok(Math.abs(measure({ x: 0, y: 0 }, { x: 0, y: 100 }, scale) - 50) < 1e-9);
  assert.throws(() => scaleFromRef({ x: 1, y: 1 }, { x: 1, y: 9 }, 'x', 24));
  assert.throws(() => scaleFromRef({ x: 1, y: 1 }, { x: 9, y: 1 }, 'x', 0));
});

test('snap to axis', () => {
  assert.deepEqual(snapAxis({ x: 0, y: 0 }, { x: 10, y: 3 }), { x: 10, y: 0 });
  assert.deepEqual(snapAxis({ x: 0, y: 0 }, { x: 2, y: 9 }), { x: 0, y: 9 });
});

test('offset segment moves along the normal', () => {
  const o = offsetSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
  assert.deepEqual(o.a, { x: 0, y: 5 });
  assert.deepEqual(o.b, { x: 10, y: 5 });
  const v = offsetSegment({ x: 0, y: 0 }, { x: 0, y: 10 }, 5);
  assert.ok(Math.abs(v.a.x + 5) < 1e-9); // downward vertical, positive offset goes left
});

test('arrow head and upright text', () => {
  const h = arrowHead({ x: 0, y: 0 }, 0, 10, 0.3);
  assert.equal(h.length, 3);
  assert.ok(h[1].x < 0 && h[2].x < 0);
  const deg = (r) => (r * 180) / Math.PI;
  assert.ok(Math.abs(deg(uprightAngle(Math.PI)) - 0) < 1e-9);
  assert.ok(Math.abs(deg(uprightAngle(-Math.PI / 2)) - 90) < 1e-9);
  assert.ok(Math.abs(deg(uprightAngle(Math.PI / 2)) - 90) < 1e-9);
  assert.ok(Math.abs(deg(uprightAngle(Math.PI * 0.75)) + 45) < 1e-9);
});

test('grid ticks and labels are distances in feet, not square counts', () => {
  const t = gridTicks(100, 38.4, 100, 100 + 38.4 * 5, 1);
  assert.equal(t.length, 6);
  assert.equal(gridLabel(0, 2), "0'");
  assert.equal(gridLabel(3, 2), "6'");
  assert.equal(gridLabel(50, 2), "100'");
  const down = gridTicks(500, 50, 100, 500, -1);
  assert.equal(down.length, 9);
  assert.deepEqual(gridTicks(0, 0, 0, 100), []);
});

function syntheticGrid(w, h, px, py, ox, oy) {
  const g = new Uint8Array(w * h).fill(235);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.abs(((x - ox) % px + px) % px), dy = Math.abs(((y - oy) % py + py) % py);
    if (Math.min(dx, px - dx) < 1 || Math.min(dy, py - dy) < 1) g[y * w + x] = 90;
  }
  // some clutter so it is not a perfect grid
  for (let y = 100; y < 220; y++) for (let x = 150; x < 330; x++) g[y * w + x] = (x * 7 + y * 13) % 255;
  return g;
}

test('detects grid pitch and origin on both axes', () => {
  const g = syntheticGrid(1000, 800, 38.4, 38.4, 20, 15);
  const r = detectGrid(g, 1000, 800);
  assert.ok(r.x && r.y);
  assert.ok(Math.abs(r.x.pitch - 38.4) < 0.3, `x pitch ${r.x.pitch}`);
  assert.ok(Math.abs(r.y.pitch - 38.4) < 0.3, `y pitch ${r.y.pitch}`);
  assert.ok(r.x.first >= 0 && r.x.last > r.x.first);
  const frac = (v, p) => ((v % p) + p) % p;
  const ex = Math.min(frac(r.x.origin - 20, 38.4), 38.4 - frac(r.x.origin - 20, 38.4));
  assert.ok(ex < 1.5, `x phase error ${ex}`);
});

test('different pitch per axis (elevation grids)', () => {
  const g = syntheticGrid(1200, 700, 76.8, 51.2, 30, 10);
  const r = detectGrid(g, 1200, 700);
  assert.ok(Math.abs(r.x.pitch - 76.8) < 0.5, `x pitch ${r.x.pitch}`);
  assert.ok(Math.abs(r.y.pitch - 51.2) < 0.5, `y pitch ${r.y.pitch}`);
});

test('no grid returns null', () => {
  const flat = new Float64Array(500).fill(10);
  assert.equal(detectPitch(flat), null);
});

test('PDF writer produces a valid-looking multi-page file', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdf([{ jpeg, w: 300, h: 200 }, { jpeg, w: 400, h: 100 }]);
  const s = new TextDecoder('latin1').decode(pdf);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
  assert.ok(s.includes('/Count 2'));
  assert.ok(s.includes('/MediaBox [0 0 400 100]'));
  const sx = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(sx).startsWith('xref'));
});

test('footer is a single scale line', () => {
  assert.equal(footerText(2, 'ft', true), "Scale: grid = 2'-0\" x 2'-0\" (grid labels in feet). Dimensions in feet-inches, nearest 1/2\".");
  assert.ok(!footerText(2, 'in', false).includes('\n'));
});

test('first/last strong grid lines ignore a blank margin around the grid', () => {
  // grid drawn only between x=40..1240 and y=40..1000 on a 1280x1040 white page
  const w = 1280, h = 1040, g = new Uint8Array(w * h).fill(255);
  for (let y = 40; y <= 1000; y++) for (let x = 40; x <= 1240; x++) {
    if ((x - 40) % 40 === 0 || (y - 40) % 40 === 0) g[y * w + x] = 120; else g[y * w + x] = 236;
  }
  const r = detectGrid(g, w, h);
  assert.ok(Math.abs(r.x.first - 40) < 1.5, `first x ${r.x.first}`);
  assert.ok(Math.abs(r.x.last - 1240) < 1.5, `last x ${r.x.last}`);
  assert.ok(Math.abs(r.y.last - 1000) < 1.5, `last y ${r.y.last}`);
  assert.ok(Math.abs(r.x.pitch - 40) < 0.2);
});
