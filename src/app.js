import {
  fmtLen, scaleFromRef, measure, snapAxis, offsetSegment, arrowHead, uprightAngle,
  gridTicks, gridLabel, detectGrid, buildPdf, footerText,
} from './lib.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const RED = '#cd0000', INK = '#23233f';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/';

const st = {
  img: null, w: 0, h: 0, name: 'drawing',
  scale: { sx: null, sy: null },
  mode: 'lin', pending: null, hover: null,
  dims: [], calRef: null, origin: null,
  pages: [], pdfDoc: null,
};

function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), ms);
}

const padOf = () => Math.round(0.07 * Math.max(st.w, st.h));
const fontPx = () => Number($('fsize').value) * Math.max(1, Math.max(st.w, st.h) / 1000);
const units = () => $('units').value;
const gridFt = () => Math.max(0.25, Number($('gridft').value) || 2);
const gridIn = () => gridFt() * 12;

function layout() {
  const pad = padOf(), foot = Math.round(fontPx() * 3);
  return { pad, foot, W: st.w + 2 * pad, H: st.h + 2 * pad + foot };
}

function setImage(src, w, h, name) {
  st.img = src; st.w = w; st.h = h; st.name = name;
  st.dims = []; st.pending = null; st.calRef = null; st.origin = null; st.gridBox = null;
  st.scale = { sx: null, sy: null };
  $('fsize').value = Math.max(10, Math.min(80, Math.round(Math.min(w, h) / 40 / Math.max(1, Math.max(w, h) / 1000))));
  const { W, H } = layout(); cv.width = W; cv.height = H; cv.hidden = false; $('empty').hidden = true;
  for (const id of ['autograd', 'calx', 'caly', 'mlin', 'mdia', 'setorigin', 'png', 'addpage', 'pdf']) $(id).disabled = false;
  $('fileinfo').textContent = `${name} · ${w} × ${h} px`;
  applyZoom(); setMode('lin'); updateInfo(); draw();
}

function applyZoom() {
  const z = Number($('zoom').value) / 100;
  cv.style.width = `${cv.width * z}px`; cv.style.height = `${cv.height * z}px`;
}

function updateInfo() {
  const { sx, sy } = st.scale;
  const el = $('scaleinfo');
  if (sx && sy) {
    el.className = 'status ok';
    el.textContent = `Scale set: ${(sx).toFixed(3)} px/in (X), ${(sy).toFixed(3)} px/in (Y). One grid square = ${(sx * gridIn()).toFixed(1)} × ${(sy * gridIn()).toFixed(1)} px.`;
  } else {
    el.className = 'status warn';
    el.textContent = 'Scale not set. Use Auto-detect grid or Calibrate X.';
  }
  $('undo').disabled = !st.dims.length; $('clear').disabled = !st.dims.length;
  const ul = $('dimlist'); ul.innerHTML = '';
  st.dims.forEach((d, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span'); span.textContent = `${i + 1}. ${labelFor(d) ?? '(no scale)'}`;
    const b = document.createElement('button'); b.textContent = '×'; b.title = 'Delete';
    b.onclick = () => { st.dims.splice(i, 1); updateInfo(); draw(); };
    li.append(span, b); ul.append(li);
  });
  $('pdfinfo').textContent = `PDF set: ${st.pages.length} page${st.pages.length === 1 ? '' : 's'}`;
}

function labelFor(d) {
  if (!(st.scale.sx && st.scale.sy)) return null;
  const v = measure(d.a, d.b, st.scale);
  return (d.type === 'dia' ? 'Ø' : '') + fmtLen(v, units());
}

function setMode(m) {
  st.mode = m; st.pending = null; st.hover = null;
  $('mlin').classList.toggle('active', m === 'lin');
  $('mdia').classList.toggle('active', m === 'dia');
  $('calx').classList.toggle('active', m === 'calx');
  $('caly').classList.toggle('active', m === 'caly');
  $('setorigin').classList.toggle('active', m === 'origin');
  if (m === 'calx' || m === 'caly') toast(`Click two grid intersections along the ${m === 'calx' ? 'horizontal' : 'vertical'} axis.`);
  if (m === 'origin') toast('Click the bottom-left grid line intersection (0\').');
  draw();
}

// ---------- drawing ----------
function lineW() { return Math.max(2, fontPx() / 9); }

function stroke(a, b, w = lineW(), halo = true) {
  ctx.lineCap = 'butt';
  if (halo) { ctx.strokeStyle = '#fff'; ctx.lineWidth = w + 4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  ctx.strokeStyle = RED; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function head(tip, ang) {
  const L = fontPx() * 0.9;
  const pts = arrowHead(tip, ang, L, 0.33);
  ctx.fillStyle = '#fff'; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fill();
  ctx.fillStyle = RED; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
}

function textBox(text, c, ang, color = RED) {
  ctx.save();
  ctx.font = `bold ${Math.round(fontPx())}px system-ui, Arial, sans-serif`;
  const w = ctx.measureText(text).width, h = fontPx();
  ctx.translate(c.x, c.y); ctx.rotate(uprightAngle(ang));
  ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2 - 6, -h / 2 - 5, w + 12, h + 10);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 1);
  ctx.restore();
}

function drawDim(d, text) {
  const off = d.off || 0;
  let a = d.a, b = d.b;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (off) {
    const o = offsetSegment(d.a, d.b, off);
    const sg = off > 0 ? 1 : -1;
    for (const [p, q] of [[d.a, o.a], [d.b, o.b]]) {
      stroke({ x: p.x + o.n.x * 8 * sg, y: p.y + o.n.y * 8 * sg }, { x: q.x + o.n.x * 18 * sg, y: q.y + o.n.y * 18 * sg }, Math.max(1.5, lineW() * 0.6));
    }
    a = o.a; b = o.b;
  }
  stroke(a, b);
  head(b, ang); head(a, ang + Math.PI);
  textBox(text, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ang);
}

function drawGridLabels() {
  if (!$('labels').checked || !st.origin || !(st.scale.sx && st.scale.sy)) return;
  const px = st.scale.sx * gridIn(), py = st.scale.sy * gridIn();
  const { pad } = layout();
  ctx.save();
  const fs = Math.max(10, Math.min(fontPx() * 0.75, px * 0.42)); ctx.font = `bold ${Math.round(fs)}px system-ui, Arial, sans-serif`;
  ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, fs / 9);
  const gb = st.gridBox || { x0: 0, x1: st.w, y0: 0, y1: st.h };
  const cols = gridTicks(st.origin.x, px, st.origin.x, gb.x1, 1);
  const widest = Math.max(...cols.map((t) => ctx.measureText(gridLabel(t.k, gridFt())).width), 1);
  const stagger = widest * 1.15 > px;
  const bottom = $('colside').value === 'bottom';
  cols.forEach((t, i) => {
    const row = stagger && i % 2 ? 1 : 0;
    const y0 = bottom ? st.h : 0, dir = bottom ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(t.pos, y0 + dir * 3); ctx.lineTo(t.pos, y0 + dir * (fs * 0.5 + 3 + row * fs * 1.1)); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(gridLabel(t.k, gridFt()), t.pos, y0 + dir * (fs * 0.5 + 6 + fs * 0.6 + row * fs * 1.1));
  });
  const rows = gridTicks(st.origin.y, py, gb.y0, st.origin.y, -1);
  const right = $('rowside').value === 'right';
  rows.forEach((t) => {
    const x0 = right ? st.w : 0, dir = right ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(x0 + dir * 3, t.pos); ctx.lineTo(x0 + dir * (fs * 0.5 + 3), t.pos); ctx.stroke();
    ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(gridLabel(t.k, gridFt()), x0 + dir * (fs * 0.5 + 6), t.pos);
  });
  ctx.restore();
}

function render(forExport) {
  const { pad, foot, W, H } = layout();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(pad, pad);
  ctx.drawImage(st.img, 0, 0, st.w, st.h);
  drawGridLabels();
  for (const d of st.dims) { const t = labelFor(d); if (t) drawDim(d, t); }
  if (!forExport) {
    if (st.calRef) { ctx.setLineDash([8, 6]); stroke(st.calRef.a, st.calRef.b, 2, false); ctx.setLineDash([]); }
    if (st.origin) { ctx.strokeStyle = '#1f4fd8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(st.origin.x, st.origin.y, 8, 0, 7); ctx.stroke(); }
    if (st.pending) {
      ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(st.pending.x, st.pending.y, 5, 0, 7); ctx.fill();
      if (st.hover) { ctx.setLineDash([6, 5]); stroke(st.pending, st.hover, 2, false); ctx.setLineDash([]); }
    }
  }
  ctx.restore();
  // footer: exactly one scale line
  ctx.fillStyle = RED; ctx.font = `${Math.round(fontPx() * 0.8)}px system-ui, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(footerText(gridFt(), units(), $('labels').checked && !!st.origin), W / 2, H - foot / 2);
}

function draw() { if (st.img) render(false); }

// ---------- interaction ----------
function imgPoint(ev) {
  const r = cv.getBoundingClientRect(); const { pad } = layout();
  return { x: (ev.clientX - r.left) * (cv.width / r.width) - pad, y: (ev.clientY - r.top) * (cv.height / r.height) - pad };
}

cv.addEventListener('mousemove', (ev) => {
  if (!st.pending) return;
  let p = imgPoint(ev);
  if (ev.shiftKey || ($('snap').checked && st.mode !== 'calx' && st.mode !== 'caly')) p = snapAxis(st.pending, p);
  st.hover = p; draw();
});

cv.addEventListener('click', (ev) => {
  if (!st.img) return;
  let p = imgPoint(ev);
  if (st.mode === 'origin') { st.origin = p; st.gridBox = null; $('labels').checked = true; setMode('lin'); return; }
  if (!st.pending) { st.pending = p; draw(); return; }
  const a = st.pending;
  if (st.mode === 'calx' || st.mode === 'caly') {
    const axis = st.mode === 'calx' ? 'x' : 'y';
    p = axis === 'x' ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
    st.calRef = { axis, a, b: p }; st.pending = null; $('calrow').hidden = false; $('calsq').focus(); draw(); return;
  }
  if (ev.shiftKey || $('snap').checked) p = snapAxis(a, p);
  if (Math.hypot(p.x - a.x, p.y - a.y) < 3) { st.pending = null; draw(); return; }
  if (!(st.scale.sx && st.scale.sy)) toast('Set the scale first (auto-detect or calibrate).');
  st.dims.push({ type: st.mode === 'dia' ? 'dia' : 'lin', a, b: p, off: Number($('off').value) || 0 });
  st.pending = null; updateInfo(); draw();
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { st.pending = null; st.calRef = null; $('calrow').hidden = true; setMode('lin'); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && st.dims.length && document.activeElement?.tagName !== 'INPUT') { st.dims.pop(); updateInfo(); draw(); ev.preventDefault(); }
});

$('mlin').onclick = () => setMode('lin');
$('mdia').onclick = () => setMode('dia');
$('calx').onclick = () => setMode('calx');
$('caly').onclick = () => setMode('caly');
$('setorigin').onclick = () => setMode('origin');
$('undo').onclick = () => { st.dims.pop(); updateInfo(); draw(); };
$('clear').onclick = () => { st.dims = []; updateInfo(); draw(); };
for (const id of ['units', 'fsize', 'labels', 'colside', 'rowside', 'gridft']) $(id).addEventListener('input', () => { if (st.img) { const { W, H } = layout(); cv.width = W; cv.height = H; applyZoom(); updateInfo(); draw(); } });
$('zoom').addEventListener('input', applyZoom);

$('calapply').onclick = () => {
  if (!st.calRef) return;
  try {
    const sq = Number($('calsq').value);
    const s = scaleFromRef(st.calRef.a, st.calRef.b, st.calRef.axis, sq * gridIn());
    if (st.calRef.axis === 'x') { st.scale.sx = s; if ($('link').checked || !st.scale.sy) st.scale.sy = s; }
    else { st.scale.sy = s; if (!st.scale.sx) st.scale.sx = s; }
    st.calRef = null; $('calrow').hidden = true; setMode('lin'); updateInfo(); draw();
  } catch (e) { toast(e.message); }
};

$('autograd').onclick = () => {
  const c = document.createElement('canvas'); c.width = st.w; c.height = st.h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(st.img, 0, 0, st.w, st.h);
  const px = g.getImageData(0, 0, st.w, st.h).data; const gray = new Uint8Array(st.w * st.h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) | 0;
  const r = detectGrid(gray, st.w, st.h);
  if (!r.x || !r.y) { toast('Could not find a regular grid. Calibrate by hand instead.'); return; }
  st.scale.sx = r.x.pitch / gridIn(); st.scale.sy = r.y.pitch / gridIn();
  const ratio = st.scale.sy / st.scale.sx;
  let warn = '';
  if (ratio < 0.6 || ratio > 1 / 0.6) { st.scale.sy = st.scale.sx; warn = ' Y spacing looked wrong, so X was used for Y.'; }
  else if (Math.abs(ratio - 1) < 0.01) st.scale.sy = st.scale.sx;
  st.gridBox = { x0: r.x.first, x1: r.x.last, y0: r.y.first, y1: r.y.last };
  st.origin = { x: r.x.first, y: r.y.last }; // bottom-left grid line actually drawn
  updateInfo(); draw();
  toast(`Grid found: ${r.x.pitch.toFixed(2)} × ${r.y.pitch.toFixed(2)} px per square.${warn} Check it against the drawing; use Set origin if the 0' line is off.`, 6000);
};

// ---------- loading ----------
async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not read that image')); img.src = url; });
  setImage(img, img.naturalWidth, img.naturalHeight, file.name);
}

async function loadPdfPage(n) {
  const page = await st.pdfDoc.getPage(n);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 4000 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  setImage(c, c.width, c.height, `${st.pdfName} (page ${n})`);
}

async function loadPdfFile(file) {
  toast('Loading PDF reader...');
  const pdfjs = await import(`${PDFJS}pdf.min.mjs`);
  const wsrc = await (await fetch(`${PDFJS}pdf.worker.min.mjs`)).text();
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([wsrc], { type: 'text/javascript' }));
  st.pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  st.pdfName = file.name;
  $('pdfrow').hidden = false; $('pdfpage').max = st.pdfDoc.numPages; $('pdfpage').value = 1; $('pdfcount').textContent = `of ${st.pdfDoc.numPages}`;
  await loadPdfPage(1);
}

async function handleFile(file) {
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) await loadPdfFile(file);
    else { $('pdfrow').hidden = true; await loadImageFile(file); }
  } catch (e) { toast(e.message || String(e), 6000); }
}

$('file').addEventListener('change', (e) => e.target.files[0] && handleFile(e.target.files[0]));
$('pdfload').onclick = () => st.pdfDoc && loadPdfPage(Math.max(1, Math.min(st.pdfDoc.numPages, Number($('pdfpage').value) || 1)));
$('sample').onclick = async () => {
  const blob = await (await fetch('samples/sample-plan.png')).blob();
  await handleFile(new File([blob], 'sample-plan.png', { type: 'image/png' }));
};
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

// ---------- export ----------
function baseName() { return st.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ().]+/g, '_'); }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const toBlob = (type, q) => new Promise((res) => cv.toBlob(res, type, q));

$('png').onclick = async () => { render(true); const b = await toBlob('image/png'); draw(); download(b, `${baseName()}_dimensioned.png`); };
$('addpage').onclick = async () => {
  render(true); const b = await toBlob('image/jpeg', 0.93); const w = cv.width, h = cv.height; draw();
  st.pages.push({ jpeg: new Uint8Array(await b.arrayBuffer()), w, h, name: st.name }); updateInfo(); toast(`Added. PDF set has ${st.pages.length} page(s).`);
};
$('pdf').onclick = async () => {
  const pages = st.pages.slice();
  if (!pages.length) { render(true); const b = await toBlob('image/jpeg', 0.93); pages.push({ jpeg: new Uint8Array(await b.arrayBuffer()), w: cv.width, h: cv.height }); draw(); }
  download(new Blob([buildPdf(pages)], { type: 'application/pdf' }), `${baseName()}_dimensioned.pdf`);
};

// test hook (used by tests/e2e.mjs)
window.__gd = { st, render, labelFor };
