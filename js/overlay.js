// Mirror Puppet — 2D drawing: the skeleton over the camera picture (body, derived torso, hands with the phone
// rectangle, face mesh and contours) and the expression list under the picture.
import { BODY_JOINTS, BODY_BONES, SPINE_STEPS, HAND_BONES, FACE_TESS, FACE_CONT, CSS, BS_NAME,
  $, overlay, octx, ui, midPt, torsoFromFace, torsoFromPose, HEAD_IDS } from './core.js';
import { holding } from './phone.js';

// ---------------------------------------------------------------- 2D overlay
function strokePairs(pts, pairs, W, H, ok) {
  octx.beginPath();
  for (const [a, b] of pairs) {
    if (ok && !ok(a, b)) continue;
    octx.moveTo(pts[a].x * W, pts[a].y * H); octx.lineTo(pts[b].x * W, pts[b].y * H);
  }
  octx.stroke();
}
function dots(pts, ids, W, H, r, ok) {
  octx.beginPath();
  for (const i of ids) { if (ok && !ok(i)) continue; octx.moveTo(pts[i].x * W + r, pts[i].y * H); octx.arc(pts[i].x * W, pts[i].y * H, r, 0, Math.PI * 2); }
  octx.fill();
}
function draw2D(res) {
  const W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);
  if (!ui.video.checked) { octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H); }
  const s = Math.max(1, W / Math.max(1, overlay.clientWidth)) * 0.8;   // ~2.5 screen px whatever the camera size
  octx.lineCap = 'round'; octx.lineJoin = 'round';
  if (res.pose && ui.body.checked) {
    const p = res.pose, vis = i => (p[i].visibility == null || p[i].visibility > 0.5);
    octx.strokeStyle = CSS.body; octx.lineWidth = 3 * s;
    strokePairs(p, BODY_BONES, W, H, (a, b) => vis(a) && vis(b));
    octx.fillStyle = CSS.body; dots(p, BODY_JOINTS, W, H, 5 * s, vis);
  }
  if (ui.body.checked) {   // neck root below the chin; clavicles to the shoulders; spine to the pelvis
    const p = res.pose, vis = i => p && (p[i].visibility == null || p[i].visibility > 0.5);
    let t = null;
    if (res.face) t = torsoFromFace(res.face[152], res.face[10], res.face[1], res.face[234], res.face[454]);
    else if (p && HEAD_IDS.every(vis)) t = torsoFromPose(p);
    if (t) {
      const line = (a, b) => { octx.beginPath(); octx.moveTo(a.x * W, a.y * H); octx.lineTo(b.x * W, b.y * H); octx.stroke(); };
      octx.strokeStyle = CSS.body; octx.lineWidth = 3 * s;
      line(t.root, t.chin);
      if (vis(11)) line(t.root, p[11]);
      if (vis(12)) line(t.root, p[12]);
      const pelvis = vis(23) && vis(24) ? midPt(p[23], p[24]) : null;
      if (pelvis) line(t.root, pelvis);
      const pts = pelvis ? [t.root, t.chin, pelvis] : [t.root, t.chin];
      if (pelvis) for (const f of SPINE_STEPS) pts.push({x:t.root.x+(pelvis.x-t.root.x)*f,y:t.root.y+(pelvis.y-t.root.y)*f});
      octx.fillStyle = CSS.body; dots(pts, pts.map((_, i) => i), W, H, 5 * s);
    }
  }
  for (const h of res.hands) {
    if (holding(h.side)) {   // a rectangle across the palm, camera dot in a corner
      const q = h.img, X = i => q[i].x * W, Y = i => q[i].y * H;
      const cx = [0, 5, 9, 13, 17].reduce((a, i) => a + X(i), 0) / 5, cy = [0, 5, 9, 13, 17].reduce((a, i) => a + Y(i), 0) / 5;
      let lx = X(5) - X(17), ly = Y(5) - Y(17); const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
      const L = Math.hypot(X(9) - X(0), Y(9) - Y(0)), a = L * 0.735, b = L * 0.36, sx = -ly, sy = lx;
      octx.save(); octx.fillStyle = 'rgba(28,28,30,0.75)'; octx.strokeStyle = '#e4e6ea'; octx.lineWidth = 2 * s;
      octx.beginPath();
      octx.moveTo(cx + lx * a + sx * b, cy + ly * a + sy * b); octx.lineTo(cx - lx * a + sx * b, cy - ly * a + sy * b);
      octx.lineTo(cx - lx * a - sx * b, cy - ly * a - sy * b); octx.lineTo(cx + lx * a - sx * b, cy + ly * a - sy * b); octx.closePath();
      octx.fill(); octx.stroke();
      octx.beginPath(); octx.arc(cx - lx * a * 0.72 + sx * b * 0.5, cy - ly * a * 0.72 + sy * b * 0.5, Math.max(2, L * 0.07), 0, Math.PI * 2); octx.stroke();
      octx.restore();
    }
    octx.strokeStyle = CSS[h.side]; octx.lineWidth = 2.5 * s;
    strokePairs(h.img, HAND_BONES, W, H);
    octx.fillStyle = CSS[h.side]; dots(h.img, [...Array(21).keys()], W, H, 3.5 * s);
  }
  if (res.face) {
    if (ui.mesh.checked) { octx.strokeStyle = CSS.faceLine; octx.lineWidth = 0.8 * s; strokePairs(res.face, FACE_TESS, W, H); }
    octx.strokeStyle = CSS.face; octx.lineWidth = 1.6 * s; strokePairs(res.face, FACE_CONT, W, H);
  }
}

// ---------------------------------------------------------------- expression bars
const bsList = $('bsList'), bsRows = [];
for (let i = 0; i < 6; i++) {
  const row = document.createElement('div'); row.className = 'bs';
  row.innerHTML = '<span class="n"></span><span class="v"></span><span class="b"><i></i></span>';
  bsList.appendChild(row);
  bsRows.push({ row, n: row.children[0], v: row.children[1], b: row.children[2].firstChild });
}
let bsAt = 0;
function updateBlend(cats, hasFace) {
  const now = performance.now(); if (now - bsAt < 120) return; bsAt = now;
  const open = $('expr').classList.contains('open'), arrow = open ? ' \u25be' : ' \u25b8';
  if (!cats || !cats.length) {
    ui.exprTitle.textContent = (hasFace ? 'Expression · none in this mode' : 'Expression · no face') + arrow;
    bsRows.forEach(r => r.row.style.display = 'none'); return;
  }
  const top = cats.filter(c => c.categoryName !== '_neutral').sort((a, b) => b.score - a.score).slice(0, bsRows.length);
  ui.exprTitle.textContent = open || !top[0] ? 'Expression' + arrow
    : 'Expression' + arrow + ' ' + (BS_NAME[top[0].categoryName] || top[0].categoryName) + ' ' + Math.round(top[0].score * 100) + '%';
  bsRows.forEach((r, i) => {
    const c = top[i]; if (!c) { r.row.style.display = 'none'; return; }
    r.row.style.display = ''; r.n.textContent = BS_NAME[c.categoryName] || c.categoryName;
    const pct = Math.round(c.score * 100); r.v.textContent = pct + '%'; r.b.style.width = pct + '%';
  });
}

export { strokePairs, dots, draw2D, updateBlend };
