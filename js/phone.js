// Mirror Puppet — phone: the cell-phone detector in its own worker (fed with bytes from the local store), which
// hand holds, and the phone (his iPhone model, a slab until it loads) placed from the hand points in every view.
import * as THREE from 'three';
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { MPV, MODEL, $, video, ui, chips, state, note } from './core.js';
import { bigFile, getFileset } from './engines.js';
import { avatar, scene, isOverlay, handRig, requestRender } from './skeleton.js';
import { mon } from './monitor.js';

// ---------------------------------------------------------------- a phone in the hand
// When he films his reflection in a mirror, the character holds a phone. An object detector finds
// 'cell phone' boxes every 4th frame; a box near a hand's palm marks that hand as holding (kept for
// 30 frames). The slab is placed from the 21 hand points alone, so the same maths serves the 2D
// overlay, the 3D puppet and the character on the camera: long edge across the palm (index -> pinky),
// lying on the palm side where the thumb curls, sized by the hand length (wrist -> middle knuckle).
const phone = { det: null, worker: null, busy: false, delegate: '', seen: { L: -1e9, R: -1e9 }, cand: { L: 0, R: 0 }, frame: 0, hold: 45, meshes: {}, lastHands: [] };
// The detector runs in a worker (its own thread), so the picture never stalls while it thinks; the main
// thread only sends a frame every 4th frame while a hand is in view, and takes the boxes back when they come.
const phoneWorkerSrc = "self.exports = {}; let ObjectDetector = null;\n" +
"let det = null;\n" +
"self.onmessage = async e => {\n" +
"  const m = e.data;\n" +
"  if (m.type === 'init') {\n" +
"    try {\n" +
"      importScripts(URL.createObjectURL(new Blob([m.lib], { type: 'text/javascript' }))); ObjectDetector = self.exports.ObjectDetector;\n" +
"      const fs = { wasmLoaderPath: URL.createObjectURL(new Blob([m.js], { type: 'text/javascript' })), wasmBinaryPath: URL.createObjectURL(new Blob([m.wasm], { type: 'application/wasm' })) };\n" +
"      const opts = d => ({ baseOptions: { modelAssetBuffer: new Uint8Array(m.model), delegate: d }, runningMode: 'IMAGE', scoreThreshold: 0.4, maxResults: 4, categoryAllowlist: ['cell phone'] });\n" +
"      try { det = await ObjectDetector.createFromOptions(fs, opts('GPU')); self.postMessage({ type: 'ready', delegate: 'GPU' }); }\n" +
"      catch (err) { det = await ObjectDetector.createFromOptions(fs, opts('CPU')); self.postMessage({ type: 'ready', delegate: 'CPU' }); }\n" +
"    } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }\n" +
"    return;\n" +
"  }\n" +
"  if (m.type === 'frame') {\n" +
"    let boxes = []; const t = performance.now();\n" +
"    try { if (det) boxes = det.detect(m.bitmap).detections.map(d => ({ originX: d.boundingBox.originX, originY: d.boundingBox.originY, width: d.boundingBox.width, height: d.boundingBox.height, score: d.categories[0] ? d.categories[0].score : 0 })); }\n" +
"    catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }\n" +
"    m.bitmap.close(); self.postMessage({ type: 'boxes', boxes, ms: performance.now() - t });\n" +
"  }\n" +
"};\n";
async function ensurePhoneDetector() {
  if (phone.worker || phone.det || phone.loading) return; phone.loading = true;
  try {
    const simd = FilesetResolver.isSimdSupported ? await FilesetResolver.isSimdSupported() : true;
    const base = MPV + '/wasm/vision_wasm_' + (simd ? '' : 'nosimd_') + 'internal';
    const [model, js, wasm, lib] = await Promise.all([bigFile(MODEL.phone), bigFile(base + '.js'), bigFile(base + '.wasm'), bigFile(MPV + '/vision_bundle.cjs')]);
    const own = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    try {
      const w = new Worker(URL.createObjectURL(new Blob([phoneWorkerSrc], { type: 'text/javascript' })));
      const ready = new Promise((res, rej) => {
        w.onmessage = e => { if (e.data.type === 'ready') res(e.data.delegate); else if (e.data.type === 'error') rej(new Error(e.data.message)); };
        w.onerror = e => rej(new Error(e.message || 'worker error'));
        setTimeout(() => rej(new Error('worker timeout')), 60000);
      });
      const bufs = [own(model), own(js), own(wasm), own(lib)];
      w.postMessage({ type: 'init', model: bufs[0], js: bufs[1], wasm: bufs[2], lib: bufs[3] }, bufs);
      phone.delegate = await ready; phone.worker = w;
      w.onmessage = e => {
        if (e.data.type === 'boxes') { phone.busy = false; mon.report('phone thread', e.data.ms || 0, { kind: 'thread', delegate: phone.delegate }); acceptBoxes(e.data.boxes, phone.lastHands); }
        else if (e.data.type === 'error') { console.warn('phone detector (worker):', e.data.message); phone.busy = false; }
      };
      w.onerror = e => { console.warn('phone worker died', e.message); phone.worker = null; phone.busy = false; };
    } catch (e) {   // no worker (old browser): the detector runs on the main thread, less often
      console.warn('phone detector worker failed, running inline', e);
      const opts = d => ({ baseOptions: { modelAssetBuffer: await_(model), delegate: d }, runningMode: 'VIDEO', scoreThreshold: 0.4, maxResults: 4, categoryAllowlist: ['cell phone'] });
      const fs = await getFileset();
      try { phone.det = await ObjectDetector.createFromOptions(fs, opts('GPU')); phone.delegate = 'GPU (inline)'; }
      catch (e2) { phone.det = await ObjectDetector.createFromOptions(fs, opts('CPU')); phone.delegate = 'CPU (inline)'; }
    }
  } catch (e) { console.error('phone detector failed', e); note('phone detector did not start'); }
  phone.loading = false;
}
const await_ = u8 => u8;   // (the inline fallback reuses the model bytes as they are)
function detectPhones(ts, hands) {   // every 4th frame, only in 'auto', only while a hand is in the picture
  if ($('optPhone').value !== 'auto' || !hands.length || (phone.frame % 4)) return;
  phone.lastHands = hands;
  if (phone.worker) {
    if (phone.busy) return; phone.busy = true;
    createImageBitmap(video).then(bm => phone.worker.postMessage({ type: 'frame', bitmap: bm }, [bm])).catch(() => { phone.busy = false; });
  } else if (phone.det) {
    const t = performance.now();
    try { acceptBoxes(phone.det.detectForVideo(video, ts).detections.map(d => ({ originX: d.boundingBox.originX, originY: d.boundingBox.originY, width: d.boundingBox.width, height: d.boundingBox.height, score: d.categories[0] ? d.categories[0].score : 0 })), hands); }
    catch (e) { console.warn('phone detect failed', e); phone.det = null; }
    mon.report('phone (main thread)', performance.now() - t, { kind: 'main', delegate: phone.delegate.split(' ')[0] });
  }
}
// A box counts for a hand only if: it is at least 50 % sure, it is shaped like a phone (long side 1.4-2.8 x
// the short side, not most of the picture), and the palm centre lies inside the box grown by 30 %. Each box
// goes to one hand only, the one nearest its centre. A hand holds after two agreeing passes in a row, and
// keeps holding for `hold` frames after the last one.
function acceptBoxes(boxes, hands) {
  phone.lastCount = boxes.length;
  const W = state.W, H = state.H, hit = { L: false, R: false };
  for (const b of boxes) {
    if (b.score < 0.45) continue;
    const long = Math.max(b.width, b.height), short = Math.min(b.width, b.height);
    if (short < 1 || long / short < 1.4 || long / short > 2.8 || long > 0.7 * Math.max(W, H)) continue;
    let best = null;
    for (const h of hands) {
      const cx = (h.img[0].x + h.img[9].x) / 2 * W, cy = (h.img[0].y + h.img[9].y) / 2 * H, gx = b.width * 0.3, gy = b.height * 0.3;
      if (cx < b.originX - gx || cx > b.originX + b.width + gx || cy < b.originY - gy || cy > b.originY + b.height + gy) continue;
      const d = Math.hypot(b.originX + b.width / 2 - cx, b.originY + b.height / 2 - cy);
      if (!best || d < best.d) best = { h, d };
    }
    if (best) hit[best.h.side] = true;
  }
  for (const s of ['L', 'R']) { if (hit[s]) { phone.cand[s]++; if (phone.cand[s] >= 2) phone.seen[s] = phone.frame; } else phone.cand[s] = 0; }
}
const phoneMat = new THREE.MeshStandardMaterial({ color: 0xe6e7ea, roughness: 0.35, metalness: 0.15 });   // a white back, like his
const islandMat = new THREE.MeshStandardMaterial({ color: 0xd2d3d8, roughness: 0.5 });
const lensMat = new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.2, metalness: 0.6 });
// The real look: 'aiPhone 15 Pro - Low Poly smartphone' by hysokana (Sketchfab, CC BY-NC 4.0), 14.6 x 7 x 0.8 cm in metres,
// screen towards +z. It is turned so the back (cameras) faces +z like the slab, scaled 10x into hand-length units, and
// swapped in for the slab of both hands once loaded. Loaded only when a phone is first shown.
async function loadPhoneModel() {
  if (phone.model || phone.modelLoading) return; phone.modelLoading = true;
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const bytes = await bigFile(new URL('assets/phone.glb?v=1', location.href).href);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const m = gltf.scene; m.scale.setScalar(10);
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    m.position.sub(c);                                   // centred on the phone body
    if (size.x < size.y) m.rotation.z = Math.PI / 2;      // long edge along x, whatever the file's orientation
    // the back (cameras) must face +z: if the screen mesh sits on the +z side, turn the phone around
    m.updateMatrixWorld(true);
    let screen = null; m.traverse(o => { if (o.isMesh && /Screen/i.test(o.name)) screen = o; });
    if (screen) { const sc = new THREE.Box3().setFromObject(screen).getCenter(new THREE.Vector3()), bc = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); if (sc.z > bc.z) m.rotation.x += Math.PI; }
    phone.model = m;
    for (const side of ['L', 'R']) if (phone.meshes[side]) dressPhone(phone.meshes[side]);
    requestRender();
  } catch (e) { console.warn('phone model failed, keeping the slab', e); }
  phone.modelLoading = false;
}
function dressPhone(g) {
  if (!phone.model || g.userData.dressed) return;
  g.userData.dressed = true; g.children.slice().forEach(ch => g.remove(ch)); g.add(phone.model.clone());
}
function phoneMesh(side) {   // sized in units of the hand length: 1.47 x 0.72 x 0.08 (14.7 x 7.2 x 0.8 cm for a 10 cm hand)
  if (phone.meshes[side]) return phone.meshes[side];
  loadPhoneModel();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.47, 0.72, 0.08), phoneMat));
  const island = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.05), islandMat); island.position.set(-0.5, 0.14, 0.055); g.add(island);
  const lensGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 16); lensGeo.rotateX(Math.PI / 2);
  for (const [x, y] of [[-0.585, 0.06], [-0.415, 0.06], [-0.5, 0.225]]) { const l = new THREE.Mesh(lensGeo, lensMat); l.position.set(x, y, 0.09); g.add(l); }
  g.visible = false; scene.add(g); phone.meshes[side] = g; dressPhone(g); return g;
}
const _pc = new THREE.Vector3(), _pl = new THREE.Vector3(), _ps = new THREE.Vector3(), _pn = new THREE.Vector3(), _pf = new THREE.Vector3(), _pm = new THREE.Matrix4();
function phoneFrame(pts) {   // pts: 21 Vector3-like points -> { c, long, short, normal, L }
  _pc.set(0, 0, 0); for (const i of [0, 5, 9, 13, 17]) _pc.add(pts[i]); _pc.multiplyScalar(0.2);
  _pl.subVectors(pts[5], pts[17]).normalize();
  _pf.subVectors(pts[9], pts[0]); const L = _pf.length(); if (L < 1e-6) return null;
  _pn.crossVectors(_pl, _pf).normalize();
  _ps.subVectors(pts[4], _pc); if (_pn.dot(_ps) < 0) _pn.negate();   // the palm side is where the thumb tip curls to
  _ps.crossVectors(_pn, _pl).normalize();
  return { c: _pc, long: _pl, short: _ps, normal: _pn, L };
}
function holding(side) { return $('optPhone').value === side || ($('optPhone').value === 'auto' && phone.frame - phone.seen[side] < phone.hold); }
// The phone is a fixed size (1.47 hand lengths long) and always in the hand: on the palm side, tilted with
// the palm, its long edge along whichever palm axis stands more upright, its back towards the viewer.
function updatePhones(res) {
  phone.frame++;
  let any = false;
  for (const side of ['L', 'R']) {
    const m = phoneMesh(side), h = res.hands.find(x => x.side === side);
    if (!h || !holding(side) || !ui.hands.checked) { m.visible = false; continue; }
    let pts, flip = false;
    if (isOverlay() && avatar.root && avatar.imagePoints) {
      pts = Array.from({ length: 21 }, (_, i) => avatar.imagePoints.get(side + i)); flip = state.mirror;
      if (pts.some(v => !v)) { m.visible = false; continue; }
    } else pts = handRig[side].pts;
    const f = phoneFrame(pts); if (!f) { m.visible = false; continue; }
    if (flip) { f.c.x *= -1; f.long.x *= -1; f.short.x *= -1; f.short.negate(); f.normal.crossVectors(f.long, f.short); }   // reflected, still right-handed
    const up = Math.abs(f.long.y) >= Math.abs(f.short.y) ? f.long.clone() : f.short.clone(); if (up.y < 0) up.negate();
    const sideV = new THREE.Vector3().crossVectors(f.normal, up).normalize(); up.crossVectors(sideV, f.normal).normalize();
    m.position.copy(f.c).addScaledVector(f.normal, f.L * 0.35);
    _pm.makeBasis(up, sideV, f.normal); m.quaternion.setFromRotationMatrix(_pm);   // right-handed: x = long edge (up), z = back towards the viewer
    m.scale.setScalar(f.L);
    m.visible = true; any = true;
  }
  chips.phone.classList.toggle('on', any);
  chips.phone.textContent = 'phone' + (phone.worker ? '' : phone.det ? ' · inline' : phone.loading ? ' · loading' : ' · off') + (phone.lastCount ? ' · sees ' + phone.lastCount : '');
}
$('optPhone').onchange = () => { if ($('optPhone').value === 'auto') ensurePhoneDetector(); };

export { phone, ensurePhoneDetector, detectPhones, acceptBoxes, phoneFrame, holding, updatePhones };
