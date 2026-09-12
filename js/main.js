// Mirror Puppet — the loop: one frame (recognition → 2D drawing → puppet → character → phone), the status line,
// the console handle for the tests, and the start-up.
// The modules import each other in circles (a function defined in a later file is called from an earlier one).
// That is safe because no module touches another module's variables while the files are still loading: at load
// time each file only builds its own objects and points event handlers at functions; the calls come later.
import * as THREE from 'three';
import { $, video, overlay, octx, ui, chips, state, note } from './core.js';
import { backend, wanted, useEngine, onDetectError } from './engines.js';
import { avatar, view, renderer, scene, camera, overlayCamera, isOverlay, renderCamera, controls, handRig, sm,
  updateBody, updateHand, updateFace, updateTorso, resize, requestRender, takeRender } from './skeleton.js';
import { eyes } from './eyes.js';
import { loadAvatar, updateAvatar, configureDisplay } from './character.js';
import { phone, acceptBoxes, detectPhones, updatePhones } from './phone.js';
import { draw2D, updateBlend } from './overlay.js';
import { startCamera, stopCamera, syncSize } from './camera.js';
import { mon } from './monitor.js';
import { threadPlan } from './threads.js';

// ---------------------------------------------------------------- one frame
function present(res) {
  const overlayHidden = isOverlay() && avatar.root && !$('optGuides').checked && document.body.classList.contains('character-ready');
  if (overlayHidden) { if (!overlay.dataset.blank) { octx.clearRect(0, 0, overlay.width, overlay.height); overlay.dataset.blank = '1'; } }
  else { overlay.dataset.blank = ''; draw2D(res); }
  const hasBody = updateBody(res);
  const hasFace = updateFace(res);
  const seen = { L: false, R: false };
  for (const h of res.hands) if (!seen[h.side]) { seen[h.side] = true; updateHand(h); }
  for (const s of ['L', 'R']) if (!seen[s]) { handRig[s].group.visible = false; sm[s].on = false; }
  updateTorso(hasBody, hasFace);
  chips.face.classList.toggle('on', hasFace);
  chips.body.classList.toggle('on', hasBody && ui.body.checked);
  chips.L.classList.toggle('on', seen.L); chips.R.classList.toggle('on', seen.R);
  updateBlend(res.blend, hasFace);
  updateAvatar(res);
  updatePhones(res);
  requestRender();   // a new pose: the 3D view is drawn on the next frame
}

// ---------------------------------------------------------------- loop
let fps = 0, frames = 0, fpsAt = performance.now(), lastVT = -1, lastTs = 0, renderedAt = 0;
const perf = { detect: 0, draw: 0 };   // ms per frame: recognition, then drawing (smoothed)
function setStatus(msg) {
  const engine = backend ? backend.label : (wanted ? 'loading model' : 'no engine · pick one in the menu');
  const parts = [engine, state.running ? fps + ' fps · ' + Math.round(perf.detect) + ' + ' + Math.round(perf.draw) + ' ms' : 'camera off', state.W + '×' + state.H];
  if (state.note && performance.now() - state.noteAt < 15000) parts.push(state.note);
  ui.status.textContent = msg || parts.join(' · ');
}
function loop() {
  requestAnimationFrame(loop);
  if (backend && state.running && video.readyState >= 2 && video.currentTime !== lastVT && video.videoWidth >= 32) {
    lastVT = video.currentTime; syncSize();
    let ts = Math.round(performance.now()); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
    let res = null;
    const t0 = performance.now();
    try { res = backend.detect(video, ts); } catch (e) { onDetectError(e); }
    if (res) detectPhones(ts, res.hands);
    const t1 = performance.now();
    if (res) { try { present(res); frames++; } catch (e) { console.error('present failed', e); note('draw error: ' + String((e && e.message) || e).slice(0, 80)); } }
    const t2 = performance.now();
    perf.detect += (t1 - t0 - perf.detect) * 0.1; if (res) perf.draw += (t2 - t1 - perf.draw) * 0.1;   // the draw time only when something was drawn
    if (backend && backend.threads) perf.detect = backend.ms;   // with threads the recognition time is the slowest thread's, not the hand-off
    mon.report('main', t2 - t0, { kind: 'main' });
    if (backend && !backend.threads) mon.report('recognition (main thread)', t1 - t0, { kind: 'main', delegate: backend.key.split(':')[1] });
  }
  const now = performance.now();
  if (now - fpsAt >= 1000) { fps = Math.round(frames * 1000 / (now - fpsAt)); frames = 0; fpsAt = now; setStatus(); mon.tick(now); }
  const turned = controls.enabled && controls.update();   // true while a drag or its damping moves the 3D view
  const wanted = takeRender();
  if ((wanted || turned || now - renderedAt >= 1000) && (isOverlay() || (view.clientWidth && view.clientHeight))) {
    renderedAt = now;
    const r0 = performance.now(); mon.gpuBegin(); renderer.render(scene, renderCamera()); mon.gpuEnd(); mon.renders++;
    mon.report('main', performance.now() - r0, { kind: 'main' });
  }
}

// a small handle for testing from the console
window.mirrorPuppet = { THREE, state, phone, eyes, mon, threadPlan, acceptBoxes, present, startCamera, stopCamera, renderer, scene, camera, overlayCamera, renderCamera, resize, avatar, loadAvatar, canvases: () => ({ overlay, three: renderer.domElement }), get backend() { return backend; } };

configureDisplay(); loadAvatar().catch(() => {});
loop();
useEngine(ui.engine.value);
startCamera();

// the build stamp (the ?v= of this file, see tools/stamp.py) shown in Settings, so a phone screenshot tells which build it runs
const BUILD = new URL(import.meta.url).searchParams.get('v') || 'local';
$('build').textContent = 'build ' + BUILD; window.mirrorPuppet.build = BUILD;
export { present, setStatus, perf };
