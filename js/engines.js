// Mirror Puppet — recognition: the local store for the big files (IndexedDB), the MediaPipe engines (three
// separate models or the combined one), hands tied to the body's wrists, and the engine management (loading
// card, the automatic chain, error cards).
import { FilesetResolver, FaceLandmarker, HandLandmarker, PoseLandmarker, HolisticLandmarker } from '@mediapipe/tasks-vision';
import { MPV, MODEL, UA, $, ui, dImg } from './core.js';
import { resetSmoothing } from './skeleton.js';
import { ensurePhoneDetector } from './phone.js';
import { setStatus } from './main.js';

// ---------------------------------------------------------------- recognition engines
// Every engine returns the same shape: { face, blend, pose, poseWorld, hands:[{side:'L'|'R', attached, img, world}] }
// ---------------------------------------------------------------- local store for the big files
// Google's storage lets a browser keep a model for one hour and phones empty their caches often, so every big
// file (the two wasm files and the models) is fetched once, kept in the page's own database and read from
// there on later visits. If the database is not available the files are simply fetched again.
const STORE = { db: 'mirror-puppet-v1', name: 'files' };
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(STORE.db, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE.name);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
  });
}
async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE.name).objectStore(STORE.name).get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function idbPut(key, val) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE.name, 'readwrite').objectStore(STORE.name).put(val, key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
const dl = { done: 0, total: 0, seen: new Set(), fromStore: 0 };
function setProg() {
  const el = document.getElementById('prog'); if (!el) return;
  el.textContent = dl.total ? 'downloading ' + (dl.done / 1e6).toFixed(0) + ' / ' + (dl.total / 1e6).toFixed(0) + ' MB · kept on this device for next time'
    : (dl.fromStore ? 'from this device, no download' : 'checking this device');
}
async function fetchBig(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('download failed (' + resp.status + ') ' + url.split('/').pop());
  const total = +resp.headers.get('content-length') || 0;
  if (total && !dl.seen.has(url)) { dl.seen.add(url); dl.total += total; }
  if (!resp.body || !resp.body.getReader) { const b = new Uint8Array(await resp.arrayBuffer()); dl.done += b.length; setProg(); return b; }
  const reader = resp.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; dl.done += value.length; setProg(); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
async function bigFile(url) {          // Uint8Array, from the local store when it is there
  let buf = null;
  try { buf = await idbGet(url); } catch {}
  if (buf) { dl.fromStore++; setProg(); return new Uint8Array(buf); }
  const bytes = await fetchBig(url);
  try { await idbPut(url, bytes.buffer); } catch {}
  return bytes;
}
let fileset = null;
async function getFileset() {
  if (fileset) return fileset;
  try {   // the wasm loader and binary from the store, handed to MediaPipe as blob addresses
    const simd = FilesetResolver.isSimdSupported ? await FilesetResolver.isSimdSupported() : true;
    const base = MPV + '/wasm/vision_wasm_' + (simd ? '' : 'nosimd_') + 'internal';
    const [js, wasm] = await Promise.all([bigFile(base + '.js'), bigFile(base + '.wasm')]);
    fileset = { wasmLoaderPath: URL.createObjectURL(new Blob([js], { type: 'text/javascript' })),
                wasmBinaryPath: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })), local: true };
  } catch (e) { console.warn('wasm from the store failed, using the CDN', e); fileset = await FilesetResolver.forVisionTasks(MPV + '/wasm'); }
  return fileset;
}

async function createBackend(key) {
  const [kind, delegate] = key.split(':');
  const fs = await getFileset();
  if (kind === 'holistic') {
    // On the GPU the expression part of the combined model fails ("No support of const"),
    // so there the expressions are switched off; the face mesh itself still follows the face.
    const lm = await HolisticLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetBuffer: await bigFile(MODEL.holistic), delegate }, runningMode: 'VIDEO', outputFaceBlendshapes: delegate !== 'GPU' });
    return {
      key, label: 'combined · ' + delegate,
      detect(v, ts) {
        const r = lm.detectForVideo(v, ts);
        const hands = [];
        if (ui.hands.checked) {
          if (r.leftHandLandmarks.length) hands.push({ side: 'L', attached: true, img: r.leftHandLandmarks[0], world: r.leftHandWorldLandmarks[0] });
          if (r.rightHandLandmarks.length) hands.push({ side: 'R', attached: true, img: r.rightHandLandmarks[0], world: r.rightHandWorldLandmarks[0] });
        }
        return {
          face: ui.face.checked ? r.faceLandmarks[0] || null : null,
          blend: ui.face.checked && r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories : null,
          pose: r.poseLandmarks[0] || null, poseWorld: r.poseWorldLandmarks[0] || null, hands,
        };
      },
      close() { lm.close(); },
    };
  }
  const [fb, hb, pb] = await Promise.all([bigFile(MODEL.face), bigFile(MODEL.hand), bigFile(MODEL.pose)]);
  const base = b => ({ baseOptions: { modelAssetBuffer: b, delegate }, runningMode: 'VIDEO' });
  const [face, hand, pose] = await Promise.all([
    FaceLandmarker.createFromOptions(fs, { ...base(fb), numFaces: 1, outputFaceBlendshapes: true }),
    HandLandmarker.createFromOptions(fs, { ...base(hb), numHands: 2 }),
    PoseLandmarker.createFromOptions(fs, { ...base(pb), numPoses: 1 }),
  ]);
  return {
    key, label: '3 models · ' + delegate,
    detect(v, ts) {
      const out = { face: null, blend: null, pose: null, poseWorld: null, hands: [] };
      if (ui.face.checked) {
        const r = face.detectForVideo(v, ts);
        out.face = r.faceLandmarks[0] || null;
        out.blend = r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories : null;
      }
      if (ui.body.checked) {
        const r = pose.detectForVideo(v, ts);
        out.pose = r.landmarks[0] || null; out.poseWorld = r.worldLandmarks[0] || null;
      }
      if (ui.hands.checked) {
        const r = hand.detectForVideo(v, ts);
        out.hands = r.landmarks.map((img, i) => ({ side: null, attached: false,
          label: r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].categoryName : 'Right', img, world: r.worldLandmarks[i] }));
        assignHands(out.hands, out.pose);
      }
      return out;
    },
    close() { face.close(); hand.close(); pose.close(); },
  };
}

// With three separate models the hands are tied to the nearest wrist of the body (in image space);
// a hand that has no wrist nearby keeps its own label and is placed by its image position.
function assignHands(hands, pose) {
  if (pose) {
    const wr = { L: pose[15], R: pose[16] };
    const cand = [];
    for (const h of hands) for (const s of ['L', 'R']) {
      if (wr[s].visibility != null && wr[s].visibility < 0.3) continue;
      cand.push({ h, s, d: dImg(h.img[0], wr[s]) });
    }
    cand.sort((a, b) => a.d - b.d);
    const usedS = new Set(), usedH = new Set();
    for (const c of cand) {
      if (c.d > 0.12 || usedS.has(c.s) || usedH.has(c.h)) continue;
      c.h.side = c.s; c.h.attached = true; usedS.add(c.s); usedH.add(c.h);
    }
  }
  const taken = new Set(hands.filter(h => h.side).map(h => h.side));
  for (const h of hands) if (!h.side) {
    let s = h.label === 'Left' ? 'L' : 'R';
    if (taken.has(s)) s = s === 'L' ? 'R' : 'L';
    h.side = s; taken.add(s);
  }
}

// ---------------------------------------------------------------- engine management
const CHAIN = ['sep:GPU', 'sep:CPU', 'holistic:CPU'];   // what "automatic" tries, in order
let backend = null, chainPos = 0, wanted = null;
function showLoading(html, kind) {
  ui.loading.dataset.kind = kind || 'loading';
  ui.loading.innerHTML = '<div class="box">' + html + '<small style="display:block;margin-top:10px;opacity:.55">' + UA + '</small></div>';
  ui.loading.classList.remove('hidden');
}
// A card keeps the menu reachable and always offers a way out; long traces stay in the console.
function showCard(title, reason, buttons) {
  showLoading('<b>' + title + '</b>' + (reason ? '<br><small>' + String(reason).replace(/</g, '&lt;') + '</small>' : '')
    + '<div class="row">' + buttons.map(b => '<button' + (b.primary ? ' class="primary"' : '') + '>' + b.label + '</button>').join('') + '</div>', 'card');
  ui.loading.querySelectorAll('button').forEach((el, i) => el.onclick = () => { ui.loading.classList.add('hidden'); if (buttons[i].onClick) buttons[i].onClick(); setStatus(); });
}
function showError(title, e) {
  const reason = String((e && e.message) || e || '').split('===')[0].replace(/\s+/g, ' ').trim().slice(0, 160);
  showCard(title, reason, [{ label: 'Back to automatic', primary: true, onClick: () => { ui.engine.value = 'auto'; chainPos = 0; useEngine('auto'); } }, { label: 'Close' }]);
}
async function useEngine(sel) {
  const key = sel === 'auto' ? CHAIN[chainPos] : sel;
  if (backend && backend.key === key) { ui.loading.classList.add('hidden'); return; }
  wanted = key;
  showLoading('Loading the recognition models…<br><small id="prog">checking this device</small>');
  const old = backend; backend = null; if (old) old.close();
  try {
    let b;
    try { b = await createBackend(key); }
    catch (e) {
      if (!(fileset && fileset.local)) throw e;
      console.warn('engine failed with the stored wasm, retrying from the CDN', e);
      fileset = await FilesetResolver.forVisionTasks(MPV + '/wasm');
      b = await createBackend(key);
    }
    console.log('files from the local store:', dl.fromStore, '| downloaded MB:', (dl.done / 1e6).toFixed(1));
    if (wanted !== key) { b.close(); return; }
    backend = b; wanted = null; resetSmoothing(); if (ui.loading.dataset.kind !== 'card') ui.loading.classList.add('hidden'); setStatus();
    if ($('optPhone').value === 'auto') ensurePhoneDetector();
  } catch (e) {
    console.error('engine failed', key, e);
    if (sel === 'auto' && chainPos < CHAIN.length - 1) { chainPos++; return useEngine('auto'); }
    wanted = null; showError('This engine did not start', e); setStatus();
  }
}
function onDetectError(e) {
  console.error('detect failed', backend && backend.key, e);
  const old = backend; backend = null; if (old) try { old.close(); } catch {}
  if (ui.engine.value === 'auto' && chainPos < CHAIN.length - 1) { chainPos++; useEngine('auto'); }
  else { showError('Recognition stopped', e); setStatus(); }
}
ui.engine.onchange = () => { chainPos = 0; useEngine(ui.engine.value); };

export { bigFile, getFileset, dl, createBackend, assignHands, backend, wanted, showLoading, showCard, showError, useEngine, onDetectError };
