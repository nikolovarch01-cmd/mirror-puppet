// Mirror Puppet — camera and buttons: the camera stream (front / back, sizes, failures on a card), the picture
// size, mirror, the phone's one-view switch, the snapshot, and the header buttons.
import { IS_MOBILE, $, video, overlay, ui, state, note } from './core.js';
import { showCard, backend } from './engines.js';
import { avatar, renderer, scene, isOverlay, renderCamera, frontView, resetSmoothing, resize } from './skeleton.js';
import { avatarUI } from './character.js';
import { setStatus } from './main.js';

// ---------------------------------------------------------------- camera
let stream = null, currentDeviceId = undefined, currentFacing = 'user', restarts = [], camGen = 0;   // restarts: when the browser ended a track and we started again; camGen: the latest start or stop wins
window.addEventListener('orientationchange', () => { if (IS_MOBILE && state.running) setTimeout(() => startCamera(currentDeviceId), 400); });
async function startCamera(deviceId, facing) {
  stopCamera();
  const my = ++camGen;   // a second start (Flip, a restart, a tap) or a stop while this one waits for the camera: this one gives way
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    note('the camera works only on a secure address: on this computer open-local.cmd, on a phone the https address or the live page'); return;
  }
  // a phone gets a 4:3 picture (taller on its screen); a computer the usual 16:9
  const size = IS_MOBILE ? { width: { ideal: 1280 }, height: { ideal: 960 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
  currentDeviceId = deviceId;
  const pick = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing || currentFacing };
  let last = null;
  for (const c of [{ audio: false, video: { ...pick, ...size } }, { audio: false, video: pick }, { audio: false, video: true }]) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(c);
      if (my !== camGen) { s.getTracks().forEach(t => t.stop()); return; }   // overtaken while waiting: not ours any more
      stream = s; last = null; break;
    }
    catch (e) { last = e; if (my !== camGen) return; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; }
  }
  if (!stream) {
    const why = { NotAllowedError: 'camera access was not allowed for this page', NotFoundError: 'no camera found',
      NotReadableError: 'the camera is in use by another app', SecurityError: 'the page is not on a secure address' }[last && last.name]
      || (last ? last.name + ': ' + last.message : 'unknown reason');
    note('camera did not start: ' + why);
    showCard('The camera did not start', why, [{ label: 'Try again', primary: true, onClick: () => startCamera(deviceId) }, { label: 'Close' }], 'camera');
    return;
  }
  // a front camera shows a reflection, a back camera shows the world as it is
  const track = stream.getVideoTracks()[0], st = track.getSettings ? track.getSettings() : {};
  const back = st.facingMode === 'environment' || (!st.facingMode && /back|rear|environment/i.test(track.label || ''));
  currentFacing = back ? 'environment' : 'user';
  setMirror(!back);
  // a track the browser ends on its own (the app went to the background, the device was taken away, Chrome's
  // capture service crashed): start again, up to three times a minute; after that the card
  const mine = stream;
  track.onended = () => {
    if (video.srcObject !== mine) return;   // stop() never fires this, and a stop nulls srcObject: the stream's identity is the guard
    const now = performance.now();
    restarts = restarts.filter(t => now - t < 60000);
    if (restarts.length < 3) { restarts.push(now); note('the camera stopped, starting it again'); setTimeout(() => { if (video.srcObject === mine) startCamera(deviceId, facing); }, 300); }
    else { stopCamera(); showCard('The camera keeps stopping', 'the browser ended the camera stream three times in a minute', [{ label: 'Try again', primary: true, onClick: () => startCamera(deviceId, facing) }, { label: 'Close' }], 'camera'); }
  };
  video.srcObject = stream;
  try { await video.play(); }
  catch (e) { if (my === camGen) showCard('Tap to start the camera', '', [{ label: 'Start', primary: true, onClick: () => video.play().catch(err => note('camera did not start: ' + err.name)) }], 'camera'); }
  if (my !== camGen) return;   // overtaken during play(): the newer start or the stop owns the state now
  state.running = true; ui.btnCam.textContent = 'Stop camera'; resetSmoothing(); if (backend && backend.reset) backend.reset(); setStatus();
  listCameras();
}
function stopCamera() {
  camGen++;   // a start still waiting for the camera gives way
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null; state.running = false; ui.btnCam.textContent = 'Start camera'; setStatus();
}
async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (devs.length < 2) return;
    ui.camSel.innerHTML = '';
    devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('camera ' + (i + 1)); ui.camSel.appendChild(o); });
    const cur = stream && stream.getVideoTracks()[0].getSettings().deviceId;
    if (cur) ui.camSel.value = cur;
    ui.camSel.hidden = false;
  } catch {}
}
// The picture size is read whenever it changes (a phone turned, a camera that starts with a tiny first frame).
function syncSize() {
  if (!video.videoWidth || (video.videoWidth === state.W && video.videoHeight === state.H)) return;
  state.W = video.videoWidth; state.H = video.videoHeight;
  overlay.width = state.W; overlay.height = state.H;
  document.documentElement.style.setProperty('--ar', state.W + ' / ' + state.H);   // the phone layout sizes the picture box by it
  resetSmoothing(); if (backend && backend.reset) backend.reset(); resize(); setStatus();
}
video.addEventListener('loadedmetadata', syncSize);
video.addEventListener('resize', syncSize);
ui.camSel.onchange = () => startCamera(ui.camSel.value);
ui.btnCam.onclick = () => state.running ? stopCamera() : startCamera(ui.camSel.hidden ? undefined : ui.camSel.value);

// ---------------------------------------------------------------- controls
function setMirror(on) { ui.mirror.checked = on; state.mirror = on; document.body.classList.toggle('mirror', on); resetSmoothing(); }
ui.mirror.onchange = () => setMirror(ui.mirror.checked);
ui.btnFlip.onclick = () => startCamera(undefined, currentFacing === 'user' ? 'environment' : 'user');
ui.video.onchange = () => document.body.classList.toggle('novideo', !ui.video.checked);
$('front').onclick = frontView;
$('btnTools').onclick = () => document.querySelector('header').classList.toggle('open');
$('exprTitle').onclick = () => $('expr').classList.toggle('open');
// On a phone there is one view at a time: the camera picture or the puppet
ui.btnView.onclick = () => {
  if (isOverlay()) { avatarUI.value='character'; document.body.classList.add('puppet'); avatarUI.onchange(); return; }
  if (document.body.classList.contains('puppet') && avatarUI.value==='character') { avatarUI.value='overlay'; document.body.classList.remove('puppet'); avatarUI.onchange(); return; }
  const puppet = document.body.classList.toggle('puppet');
  ui.btnView.textContent = puppet ? 'Camera' : 'Puppet';
  resize();
  if (puppet && avatarUI.value === 'character' && avatar.root) frontView();
};
ui.btnSnap.onclick = () => {
  const W = state.W, H = state.H, c = document.createElement('canvas'); c.width = W * (isOverlay()?1:2); c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#0f1317'; g.fillRect(0, 0, c.width, c.height);
  g.save(); if (state.mirror) { g.translate(W, 0); g.scale(-1, 1); }
  if (ui.video.checked && video.readyState >= 2) g.drawImage(video, 0, 0, W, H);
  if (!isOverlay() || $('optGuides').checked || !avatar.root) g.drawImage(overlay, 0, 0, W, H); g.restore();
  renderer.render(scene, renderCamera());
  const t = renderer.domElement, f = Math.min(W / t.width, H / t.height), tw = t.width * f, th = t.height * f;
  if (isOverlay()) g.drawImage(t,0,0,W,H);
  else g.drawImage(t, W + (W - tw) / 2, (H - th) / 2, tw, th);
  const a = document.createElement('a');
  a.download = 'mirror-puppet-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.png';
  a.href = c.toDataURL('image/png'); a.click();
};
export { startCamera, stopCamera, listCameras, syncSize, setMirror };
