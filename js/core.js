// Mirror Puppet — core: constants and pinned model addresses, the page's elements and shared state, the small
// geometry helpers, and the derived torso (neck root, clavicles, spine). Every other module imports from here.
import { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { setStatus } from './main.js';

// ---------------------------------------------------------------- constants
const MPV = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const G = 'https://storage.googleapis.com/mediapipe-models/';
const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const MODEL = {
  face: G + 'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: G + 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  pose: G + (IS_MOBILE ? 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
                       : 'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'),
  holistic: G + 'holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task',
  phone: G + 'object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',   // finds a 'cell phone' in the picture
};
const NF = 478;                                   // face mesh points (incl. irises)
const UA = (() => {                               // short 'Android · Chrome 153' for the cards, so a phone can be reported
  const u = navigator.userAgent;
  const os = /iPhone|iPad/.test(u) ? 'iPhone/iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : '';
  const m = u.match(/(Edg|OPR|CriOS|FxiOS|Chrome|Firefox|Version)\/(\d+)/);
  const names = { Edg: 'Edge', OPR: 'Opera', CriOS: 'Chrome', FxiOS: 'Firefox', Version: 'Safari' };
  return [os, m ? (names[m[1]] || m[1]) + ' ' + m[2] : ''].filter(Boolean).join(' · ');
})();
const BODY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const BODY_BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [31, 27], [28, 30], [30, 32], [32, 28]];
// CC_Base_Spine02 / Spine01 / Waist, projected between NeckTwist01 and Hip.
// Ratios measured from the exported rig's authored pose (same for both display modes).
// These points are inferred, not additional MediaPipe detections.
const SPINE_NAMES = ['Spine02','Spine01','Waist'];
const SPINE_STEPS = [0.48130966564214805, 0.717881114259437, 0.8127676330943147];
const HAND_BONES = HandLandmarker.HAND_CONNECTIONS.map(c => [c.start, c.end]);
const FACE_TESS = FaceLandmarker.FACE_LANDMARKS_TESSELATION.map(c => [c.start, c.end]);
const FACE_CONT = [...FaceLandmarker.FACE_LANDMARKS_CONTOURS, ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS].map(c => [c.start, c.end]);
const COLOR = { face: 0xa9d3ff, faceLine: 0x6f9cc8, body: 0x9be29b, L: 0x4fd8ff, R: 0xffb347 };
const CSS = { face: '#a9d3ff', faceLine: 'rgba(111,156,200,0.45)', body: '#9be29b', L: '#4fd8ff', R: '#ffb347' };
const BS_NAME = {
  browDownLeft: 'brow down (left)', browDownRight: 'brow down (right)', browInnerUp: 'brows up (inner)',
  browOuterUpLeft: 'brow up (left)', browOuterUpRight: 'brow up (right)', cheekPuff: 'cheeks puffed',
  cheekSquintLeft: 'cheek squint (left)', cheekSquintRight: 'cheek squint (right)', eyeBlinkLeft: 'blink (left)',
  eyeBlinkRight: 'blink (right)', eyeLookDownLeft: 'look down (left)', eyeLookDownRight: 'look down (right)',
  eyeLookInLeft: 'look in (left)', eyeLookInRight: 'look in (right)', eyeLookOutLeft: 'look out (left)',
  eyeLookOutRight: 'look out (right)', eyeLookUpLeft: 'look up (left)', eyeLookUpRight: 'look up (right)',
  eyeSquintLeft: 'eye squint (left)', eyeSquintRight: 'eye squint (right)', eyeWideLeft: 'eye wide (left)',
  eyeWideRight: 'eye wide (right)', jawForward: 'jaw forward', jawLeft: 'jaw left', jawOpen: 'mouth open',
  jawRight: 'jaw right', mouthClose: 'mouth closed', mouthDimpleLeft: 'dimple (left)', mouthDimpleRight: 'dimple (right)',
  mouthFrownLeft: 'frown (left)', mouthFrownRight: 'frown (right)', mouthFunnel: 'mouth funnel',
  mouthLeft: 'mouth left', mouthLowerDownLeft: 'lower lip down (left)', mouthLowerDownRight: 'lower lip down (right)',
  mouthPressLeft: 'lips pressed (left)', mouthPressRight: 'lips pressed (right)', mouthPucker: 'pucker',
  mouthRight: 'mouth right', mouthRollLower: 'lower lip rolled in', mouthRollUpper: 'upper lip rolled in',
  mouthShrugLower: 'lower lip up', mouthShrugUpper: 'upper lip up', mouthSmileLeft: 'smile (left)',
  mouthSmileRight: 'smile (right)', mouthStretchLeft: 'mouth stretch (left)', mouthStretchRight: 'mouth stretch (right)',
  mouthUpperUpLeft: 'upper lip up (left)', mouthUpperUpRight: 'upper lip up (right)', noseSneerLeft: 'nose sneer (left)',
  noseSneerRight: 'nose sneer (right)', tongueOut: 'tongue out',
};

// ---------------------------------------------------------------- dom / state
const $ = id => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), octx = overlay.getContext('2d');
const ui = { face: $('optFace'), hands: $('optHands'), body: $('optBody'), mesh: $('optMesh'), mirror: $('optMirror'),
  video: $('optVideo'), smooth: $('optSmooth'), engine: $('optEngine'), camSel: $('camSel'), status: $('status'),
  btnCam: $('btnCam'), btnSnap: $('btnSnap'), btnView: $('btnView'), btnFlip: $('btnFlip'), loading: $('loading'), exprTitle: $('exprTitle') };
const chips = { face: $('chipFace'), body: $('chipBody'), L: $('chipL'), R: $('chipR'), phone: $('chipPhone') };
const state = { W: 640, H: 480, mirror: true, running: false, note: '', noteAt: 0 };
function note(msg) { state.note = msg; state.noteAt = performance.now(); setStatus(); }
window.addEventListener('error', ev => note('error: ' + String(ev.message || ev.error || '').slice(0, 120)));
window.addEventListener('unhandledrejection', ev => note('error: ' + String((ev.reason && ev.reason.message) || ev.reason || '').slice(0, 120)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const aspect = () => state.H / state.W;                       // image y (0..1) -> width units: y * aspect
const dImg = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect());
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ---------------------------------------------------------------- derived torso
// The pose model has no neck, chest or clavicles. The neck root is placed below the chin (55 % of the face
// height) and half a head-depth behind it; the clavicles run from there to the shoulder joints, the spine down
// to the pelvis. The same arithmetic serves image points (2D) and scene points (3D).
const midPt = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.z != null ? (a.z + b.z) / 2 : undefined });
function addDelta(o, a, b, k) { o.x += (a.x - b.x) * k; o.y += (a.y - b.y) * k; if (o.z != null && a.z != null) o.z += (a.z - b.z) * k; return o; }
function torsoFromFace(chin, forehead, nose, headL, headR) {
  const root = { x: chin.x, y: chin.y, z: chin.z };
  addDelta(root, chin, forehead, 0.55); addDelta(root, midPt(headL, headR), nose, 0.5);
  return { chin: { x: chin.x, y: chin.y, z: chin.z }, root };
}
function torsoFromPose(p) {   // when there is no face mesh: from the eyes, mouth, ears and nose of the pose
  const em = midPt(p[2], p[5]), mm = midPt(p[9], p[10]), earm = midPt(p[7], p[8]);
  const chin = addDelta({ ...mm }, mm, em, 0.5);
  const root = addDelta(addDelta({ ...mm }, mm, em, 1.9), earm, p[0], 0.5);
  return { chin, root };
}
const HEAD_IDS = [0, 2, 5, 7, 8, 9, 10];

export { MPV, G, IS_MOBILE, MODEL, NF, UA, BODY_JOINTS, BODY_BONES, SPINE_NAMES, SPINE_STEPS, HAND_BONES, FACE_TESS, FACE_CONT, COLOR, CSS, BS_NAME,
  $, video, overlay, octx, ui, chips, state, note, clamp, aspect, dImg, d3, midPt, addDelta, torsoFromFace, torsoFromPose, HEAD_IDS };
