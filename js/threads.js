// Mirror Puppet — threads: recognition in worker threads. With enough cores the three models (face, hands,
// body) each run in their own thread; with two or three cores one thread runs all three in turn; without
// workers the main thread does it as before. The main thread hands every idle thread a copy of the current
// frame and draws with the newest results it has, so the picture never waits for recognition. Each thread
// reports its work to the Performance panel.
import { FilesetResolver } from '@mediapipe/tasks-vision';
import { MPV, MODEL, $, ui } from './core.js';
import { bigFile, assignHands } from './engines.js';
import { mon } from './monitor.js';

const THREAD_NAME = { face: 'face thread', hand: 'hands thread', pose: 'body thread' };
// How many recognition threads this machine should run: the Threads menu, else by the core count. Measured
// 2026-09-12 (laptop iGPU): three GPU threads at once do not shorten the round -- the three contexts queue on the
// one video card and each takes as long as all three in a row -- so one thread already gives the whole gain
// (the main thread freed) at a third of the memory. Three threads are tried only on big machines (8+ cores,
// usually a real graphics card that can overlap them); a phone reports 4 cores at most and gets one thread.
function threadPlan() {
  const sel = $('optThreads').value;
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') return 0;
  if (sel !== 'auto') return +sel;
  const hc = navigator.hardwareConcurrency || 0;
  return hc >= 8 ? 3 : hc >= 2 ? 1 : 0;
}
// The thread's own code (a classic worker: the library needs importScripts). It receives the library, the wasm
// pair and its models as bytes, builds the landmarkers with the delegate asked for (a refusal fails the whole
// engine and the automatic chain moves on, e.g. to the GPU on the main thread), then answers every frame with
// the parts it was asked for and the milliseconds each part took.
const landmarkerWorkerSrc = "self.exports = {};\n(() => {   // a closure: importScripts drops the library's own top-level names into this scope\n" +
"const tasks = {}; let used = '';\n" +
"const make = async (V, fs, kind, buf, delegate) => {\n" +
"  const base = { baseOptions: { modelAssetBuffer: new Uint8Array(buf), delegate }, runningMode: 'VIDEO' };\n" +
"  if (typeof OffscreenCanvas !== 'undefined') base.canvas = new OffscreenCanvas(1, 1);   // the library's own canvas guess fails on some phone browsers (no 'Version/' in the UA): give it one\n" +
"  if (kind === 'face') return V.FaceLandmarker.createFromOptions(fs, Object.assign(base, { numFaces: 1, outputFaceBlendshapes: true }));\n" +
"  if (kind === 'hand') return V.HandLandmarker.createFromOptions(fs, Object.assign(base, { numHands: 2 }));\n" +
"  return V.PoseLandmarker.createFromOptions(fs, Object.assign(base, { numPoses: 1 }));\n" +
"};\n" +
"const warmUp = t => { t.detectForVideo(new ImageData(64, 64), 1); };   // the first detection compiles the shaders (seconds on a cold start): here, one thread at a time, before 'ready'\n" +
"self.onmessage = async e => {\n" +
"  const m = e.data;\n" +
"  if (m.type === 'init') {\n" +
"    try {\n" +
"      importScripts(URL.createObjectURL(new Blob([m.lib], { type: 'text/javascript' })));\n" +
"      const V = self.exports;\n" +
"      const fs = { wasmLoaderPath: URL.createObjectURL(new Blob([m.js], { type: 'text/javascript' })), wasmBinaryPath: URL.createObjectURL(new Blob([m.wasm], { type: 'application/wasm' })) };\n" +
"      for (const kind of m.kinds) { tasks[kind] = await make(V, fs, kind, m.models[kind], m.delegate); warmUp(tasks[kind]); used = m.delegate; }\n" +
"      self.postMessage({ type: 'ready', delegate: used, gl: typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('webgl2') });\n" +
"    } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }\n" +
"    return;\n" +
"  }\n" +
"  if (m.type === 'frame') {\n" +
"    const out = { type: 'result', ts: m.ts, ms: {} };\n" +
"    try {\n" +
"      for (const kind of m.kinds) {\n" +
"        const t = performance.now(), r = tasks[kind].detectForVideo(m.frame, m.ts);\n" +
"        out.ms[kind] = performance.now() - t;\n" +
"        if (kind === 'face') { out.face = r.faceLandmarks[0] || null; out.blend = r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories : null; }\n" +
"        else if (kind === 'hand') out.hands = r.landmarks.map((img, i) => ({ side: null, attached: false, label: r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].categoryName : 'Right', img, world: r.worldLandmarks[i] }));\n" +
"        else { out.pose = r.landmarks[0] || null; out.poseWorld = r.worldLandmarks[0] || null; }\n" +
"      }\n" +
"    } catch (err) { out.error = String((err && err.message) || err); }\n" +
"    m.frame.close(); self.postMessage(out);\n" +
"  }\n" +
"};\n" +
"})();\n";

// The frame handed to a thread: a copy of the camera picture that can be moved to another thread.
function grabFrame(v) { return createImageBitmap(v); }

async function startWorker(kinds, delegate, kit, models) {
  const own = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const w = new Worker(URL.createObjectURL(new Blob([landmarkerWorkerSrc], { type: 'text/javascript' })));
  const ready = new Promise((res, rej) => {
    w.onmessage = e => { if (e.data.type === 'ready') res(e.data); else if (e.data.type === 'error') rej(new Error(e.data.message)); };
    w.onerror = e => rej(new Error(e.message || 'worker error'));
    setTimeout(() => rej(new Error('thread timeout')), 90000);
  });
  const bufs = { lib: own(kit.lib), js: own(kit.js), wasm: own(kit.wasm) }, mods = {};
  for (const k of kinds) mods[k] = own(models[k]);
  w.postMessage({ type: 'init', kinds, delegate, models: mods, ...bufs }, [bufs.lib, bufs.js, bufs.wasm, ...Object.values(mods)]);
  let info;
  try { info = await ready; } catch (e) { w.terminate(); throw e; }
  return { w, kinds, delegate: info.delegate, gl: info.gl, busy: false, errors: 0, ms: 0,
           name: kinds.length === 1 ? THREAD_NAME[kinds[0]] : 'recognition thread' };
}

// The engine: same shape as the others ({ key, label, detect(v, ts), close() }), but detect() never waits.
async function createThreadedBackend(delegate) {
  const n = threadPlan();
  if (!n) throw new Error('no threads on this device');
  const simd = FilesetResolver.isSimdSupported ? await FilesetResolver.isSimdSupported() : true;
  const base = MPV + '/wasm/vision_wasm_' + (simd ? '' : 'nosimd_') + 'internal';
  const groups = n >= 3 ? [['face'], ['hand'], ['pose']] : [['face', 'hand', 'pose']];
  const workers = [];
  for (const kinds of groups) {   // one after the other: each thread gets its own copy of the bytes from the store
    const [lib, js, wasm] = await Promise.all([bigFile(MPV + '/vision_bundle.cjs'), bigFile(base + '.js'), bigFile(base + '.wasm')]);
    const models = {};
    for (const k of kinds) models[k] = await bigFile(MODEL[k]);
    try { workers.push(await startWorker(kinds, delegate, { lib, js, wasm }, models)); }
    catch (e) { for (const wk of workers) wk.w.terminate(); throw e; }
  }
  const used = delegate;   // a thread that could not use it failed the engine, and the chain moved on
  const latest = { face: null, blend: null, pose: null, poseWorld: null, hands: [] };
  let fresh = false, closed = false;
  const engine = {
    key: 'threads:' + delegate, label: (n >= 3 ? '3 threads' : '1 thread') + ' · ' + used, threads: n, workers, ms: 0,
    detect(v, ts) {
      const want = { face: ui.face.checked, hand: ui.hands.checked, pose: ui.body.checked };
      for (const wk of workers) {
        const kinds = wk.kinds.filter(k => want[k]);
        if (wk.busy || !kinds.length) continue;
        wk.busy = true;
        grabFrame(v).then(frame => { if (closed) { frame.close(); return; } wk.w.postMessage({ type: 'frame', frame, ts, kinds }, [frame]); })
          .catch(() => { wk.busy = false; });
      }
      if (!want.face) { latest.face = null; latest.blend = null; }
      if (!want.pose) { latest.pose = null; latest.poseWorld = null; }
      if (!want.hand) latest.hands = [];
      if (!fresh) return null;                  // nothing new since the last frame: the picture is drawn, the puppet keeps its pose
      fresh = false;
      const out = { face: latest.face, blend: latest.blend, pose: latest.pose, poseWorld: latest.poseWorld,
                    hands: latest.hands.map(h => ({ side: null, attached: false, label: h.label, img: h.img, world: h.world })) };
      if (out.hands.length) assignHands(out.hands, out.pose);
      return out;
    },
    close() { closed = true; for (const wk of workers) { wk.w.terminate(); mon.forget(wk.name); } },
  };
  for (const wk of workers) {
    wk.w.onmessage = e => {
      const r = e.data; if (r.type !== 'result') return;
      wk.busy = false;
      let total = 0; for (const k in r.ms) total += r.ms[k];
      wk.ms = total; mon.report(wk.name, total, { kind: 'thread', delegate: wk.delegate });
      engine.ms = Math.max(...workers.map(x => x.ms));
      if (r.error) { wk.errors++; console.warn('thread detect failed', wk.name, r.error); if (wk.errors > 10 && engine.onError) engine.onError(new Error(wk.name + ': ' + r.error)); return; }
      wk.errors = 0;
      if ('face' in r) { latest.face = r.face; latest.blend = r.blend; }
      if ('hands' in r) latest.hands = r.hands;
      if ('pose' in r) { latest.pose = r.pose; latest.poseWorld = r.poseWorld; }
      fresh = true;
    };
    wk.w.onerror = e => { console.warn('thread died', wk.name, e.message); if (engine.onError) engine.onError(new Error(wk.name + ' stopped: ' + (e.message || ''))); };
  }
  return engine;
}
export { threadPlan, createThreadedBackend, grabFrame };
