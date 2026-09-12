// Mirror Puppet — skeleton: the 3D scene (renderer, cameras, lights, grid), the rigs of joints and bones for
// the body, the hands and the face, image/world → scene coordinates, smoothing, the puppet update per frame,
// and the sizing of the 3D canvas to its box.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IS_MOBILE, NF, BODY_JOINTS, BODY_BONES, SPINE_NAMES, SPINE_STEPS, HAND_BONES, FACE_TESS, FACE_CONT, COLOR,
  $, ui, state, note, clamp, aspect, dImg, d3, torsoFromFace, torsoFromPose, HEAD_IDS } from './core.js';

// ---------------------------------------------------------------- 3D scene
const avatar = { root: null, bones: new Map(), rest: new Map(), promise: null, last: null, tracked: false, hip: null, scale: 1 };
const view = $('view3d');
const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, alpha: true });
renderer.setPixelRatio(IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 2));
view.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', () => note('3D view lost its graphics context (low memory)'));
renderer.domElement.addEventListener('webglcontextrestored', () => { note('3D view restored'); resize(); });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1317);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30);
const overlayCamera = new THREE.OrthographicCamera(-.5,.5,.5,-.5,.01,100);
overlayCamera.position.z=10;
const isOverlay = () => $('avatarMode').value === 'overlay';
const renderCamera = () => isOverlay() ? overlayCamera : camera;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.3; controls.maxDistance = 8;
function frontView() {
  if ($('avatarMode').value === 'character' && avatar.root) {
    avatar.root.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(avatar.root,true), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const ar=Math.max(.25,view.clientWidth/Math.max(1,view.clientHeight));
    const distance=1.18*Math.max(size.y,size.x/ar)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))+size.z/2;
    camera.position.set(center.x,center.y,center.z+distance);controls.target.copy(center);
  } else { camera.position.set(0,0.15,1.9);controls.target.set(0,.1,0); }
  controls.update();
}
frontView();
scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x1a2027, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(1.5, 2.5, 2); scene.add(sun);
const grid = new THREE.GridHelper(4, 20, 0x2c3944, 0x1b232b); grid.position.y = -0.85; scene.add(grid);

const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const matBone = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.05 });
const matJoint = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: new THREE.Color(c).multiplyScalar(0.25) });
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function setBone(mesh, a, b, r) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  if (len < 1e-4) { mesh.visible = false; return; }
  mesh.visible = true;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(r, len, r);
  mesh.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len));
}
// A rig: joints (spheres) + bones (cylinders) over a point table `pts`
function makeRig(jointIds, bones, nPts, color, rJoint, rBone) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const jm = matJoint(color), bm = matBone(color);
  const joints = jointIds.map(() => { const m = new THREE.Mesh(sphereGeo, jm); m.scale.setScalar(rJoint); group.add(m); return m; });
  const boneMeshes = bones.map(() => { const m = new THREE.Mesh(cylGeo, bm); group.add(m); return m; });
  const pts = Array.from({ length: nPts }, () => new THREE.Vector3());
  return {
    group, pts,
    update(ok) {
      jointIds.forEach((id, k) => { const on = !ok || ok(id); joints[k].visible = on; if (on) joints[k].position.copy(pts[id]); });
      bones.forEach(([a, b], k) => { if (ok && !(ok(a) && ok(b))) { boneMeshes[k].visible = false; return; } setBone(boneMeshes[k], pts[a], pts[b], rBone); });
    },
  };
}
const body = makeRig(BODY_JOINTS, BODY_BONES, 33, COLOR.body, 0.022, 0.013);
const handRig = { L: makeRig([...Array(21).keys()], HAND_BONES, 21, COLOR.L, 0.009, 0.0055),
                  R: makeRig([...Array(21).keys()], HAND_BONES, 21, COLOR.R, 0.009, 0.0055) };
const torsoMat = matBone(COLOR.body), torsoJointMat = matJoint(COLOR.body);
const mkBone = () => { const m = new THREE.Mesh(cylGeo, torsoMat); m.visible = false; scene.add(m); return m; };
const mkJoint = r => { const m = new THREE.Mesh(sphereGeo, torsoJointMat); m.scale.setScalar(r); m.visible = false; scene.add(m); return m; };
const neck = mkBone(), clavL = mkBone(), clavR = mkBone(), spine = mkBone();
const rootJoint = mkJoint(0.024), chinJoint = mkJoint(0.014), pelvisJoint = mkJoint(0.024);
const spineJoints = SPINE_STEPS.map((_,i) => { const m=mkJoint(.019);m.name='Guide_CC_Base_'+SPINE_NAMES[i];return m; });
const head = new THREE.Mesh(sphereGeo, matBone(COLOR.face)); head.scale.setScalar(0.085); head.visible = false; scene.add(head);
let lastPW = null;   // the last pose (world) result, for the visibility of its points

// The face: 478 shared points, drawn as the mesh (thin), the contours (bright) and dots
const facePos = new Float32Array(NF * 3);
const faceAttr = new THREE.BufferAttribute(facePos, 3); faceAttr.setUsage(THREE.DynamicDrawUsage);
const mkGeo = idx => { const g = new THREE.BufferGeometry(); g.setAttribute('position', faceAttr); if (idx) g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx.flat()), 1)); return g; };
const faceGroup = new THREE.Group(); faceGroup.visible = false; scene.add(faceGroup);
const tessLines = new THREE.LineSegments(mkGeo(FACE_TESS), new THREE.LineBasicMaterial({ color: COLOR.faceLine, transparent: true, opacity: 0.45 }));
const contLines = new THREE.LineSegments(mkGeo(FACE_CONT), new THREE.LineBasicMaterial({ color: 0xdff0ff }));
const facePoints = new THREE.Points(mkGeo(null), new THREE.PointsMaterial({ color: COLOR.face, size: 0.0045 }));
for (const o of [tessLines, contLines, facePoints]) { o.frustumCulled = false; faceGroup.add(o); }

// ---------------------------------------------------------------- coordinates
// Image landmarks: x,y in 0..1 of the frame, z in the same units as x, smaller = closer to the camera.
// World landmarks (body, hands): metres, axes like the image (x right, y down, z depth).
// Scene: x right, y up, z towards the viewer. In mirror mode x is flipped so the puppet is a reflection.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
function imgToScene(p, k, out) {           // point in the frame -> a plane facing the viewer, k = metres per frame width
  const sx = state.mirror ? -1 : 1;
  return out.set(sx * (p.x - 0.5) * k, -(p.y - 0.5) * aspect() * k, 0);
}
function deltaToScene(dx, dy, dz, out) {   // a metric offset in world axes -> scene axes
  const sx = state.mirror ? -1 : 1;
  return out.set(sx * dx, -dy, -dz);
}

// Smoothing: an exponential average per point; a part that reappears starts fresh.
const sm = { body: { arr: new Float32Array(33 * 3), on: false }, L: { arr: new Float32Array(21 * 3), on: false },
             R: { arr: new Float32Array(21 * 3), on: false }, face: { arr: new Float32Array(NF * 3), on: false } };
function smoothInto(store, i, v) {
  const a = store.on ? 1 - ui.smooth.value / 100 : 1, k = i * 3, arr = store.arr;
  arr[k] += (v.x - arr[k]) * a; arr[k + 1] += (v.y - arr[k + 1]) * a; arr[k + 2] += (v.z - arr[k + 2]) * a;
  v.set(arr[k], arr[k + 1], arr[k + 2]);
}
function resetSmoothing() { for (const s of Object.values(sm)) s.on = false; avatar.imagePoints?.clear(); }

// ---------------------------------------------------------------- puppet update
function updateBody(res) {
  const pw = res.poseWorld, pi = res.pose;
  lastPW = pw;
  if (!pw || !pi) { body.group.visible = false; sm.body.on = false; return false; }
  // metres per frame width, read off the shoulders; the shoulder midpoint is placed by its position in the frame
  const dI = dImg(pi[11], pi[12]), dW = d3(pw[11], pw[12]);
  const k = clamp(dI > 1e-3 ? dW / dI : 1, 0.3, 4);
  imgToScene({ x: (pi[11].x + pi[12].x) / 2, y: (pi[11].y + pi[12].y) / 2 }, k, _a);
  const mx = (pw[11].x + pw[12].x) / 2, my = (pw[11].y + pw[12].y) / 2, mz = (pw[11].z + pw[12].z) / 2;
  for (let i = 0; i < 33; i++) {
    deltaToScene(pw[i].x - mx, pw[i].y - my, pw[i].z - mz, _t).add(_a);
    smoothInto(sm.body, i, _t);
    body.pts[i].copy(_t);
  }
  sm.body.on = true;
  body.group.visible = ui.body.checked;
  if (ui.body.checked) body.update(id => (pw[id].visibility == null || pw[id].visibility > 0.5));
  return true;
}
function updateHand(h) {
  const rig = handRig[h.side], store = sm[h.side];
  if (h.attached && sm.body.on) _b.copy(body.pts[h.side === 'L' ? 15 : 16]);
  else {
    const k = clamp(d3(h.world[0], h.world[9]) / Math.max(1e-3, dImg(h.img[0], h.img[9])), 0.3, 4);
    imgToScene(h.img[0], k, _b);
  }
  const w0 = h.world[0];
  for (let i = 0; i < 21; i++) {
    deltaToScene(h.world[i].x - w0.x, h.world[i].y - w0.y, h.world[i].z - w0.z, _t).add(_b);
    smoothInto(store, i, _t);
    rig.pts[i].copy(_t);
  }
  store.on = true; rig.group.visible = true; rig.update();
}
function updateFace(res) {
  const f = res.face;
  if (!f) { faceGroup.visible = false; sm.face.on = false; return false; }
  // scale from the distance between the pupils (63 mm), anchored at the nose of the body when there is one
  const ipd = dImg(f[468], f[473]);
  const k = clamp(ipd > 1e-3 ? 0.063 / ipd : 1, 0.2, 6);
  const n = f[1], asp = aspect();
  if (sm.body.on) _b.copy(body.pts[0]); else imgToScene(n, k, _b);
  for (let i = 0; i < NF; i++) {
    const p = f[i];
    deltaToScene((p.x - n.x) * k, (p.y - n.y) * asp * k, (p.z - n.z) * k, _t).add(_b);
    smoothInto(sm.face, i, _t);
    facePos[i * 3] = _t.x; facePos[i * 3 + 1] = _t.y; facePos[i * 3 + 2] = _t.z;
  }
  faceAttr.needsUpdate = true;
  sm.face.on = true; faceGroup.visible = true; tessLines.visible = ui.mesh.checked;
  return true;
}
function updateTorso(hasBody, hasFace) {
  const parts = [neck, clavL, clavR, spine, rootJoint, chinJoint, pelvisJoint, head, ...spineJoints];
  const visW = i => hasBody && lastPW && (lastPW[i].visibility == null || lastPW[i].visibility > 0.5);
  const fp = i => ({ x: facePos[i * 3], y: facePos[i * 3 + 1], z: facePos[i * 3 + 2] });
  let t = null;
  if (ui.body.checked) {
    if (hasFace) t = torsoFromFace(fp(152), fp(10), fp(1), fp(234), fp(454));
    else if (HEAD_IDS.every(visW)) t = torsoFromPose(body.pts);
  }
  if (!t) { parts.forEach(m => m.visible = false); return; }
  _a.set(t.root.x, t.root.y, t.root.z); _b.set(t.chin.x, t.chin.y, t.chin.z);
  setBone(neck, _a, _b, 0.02);
  rootJoint.visible = true; rootJoint.position.copy(_a);
  chinJoint.visible = true; chinJoint.position.copy(_b);
  head.visible = !hasFace && hasBody; if (head.visible) { head.position.copy(body.pts[0]); head.position.z -= 0.05; }
  if (visW(11)) setBone(clavL, _a, body.pts[11], 0.013); else clavL.visible = false;
  if (visW(12)) setBone(clavR, _a, body.pts[12], 0.013); else clavR.visible = false;
  if (visW(23) && visW(24)) {
    _t.addVectors(body.pts[23], body.pts[24]).multiplyScalar(0.5); setBone(spine, _a, _t, 0.014);
    pelvisJoint.visible = true; pelvisJoint.position.copy(_t);
    spineJoints.forEach((m,i) => { m.visible=true; m.position.lerpVectors(_a,_t,SPINE_STEPS[i]); });
  } else { spine.visible = false; pelvisJoint.visible = false; spineJoints.forEach(m => m.visible=false); }
}

function resize() {
  if (isOverlay()) {
    const picture=document.querySelector('.picture'), W=picture.clientWidth,H=picture.clientHeight;
    if (!W || !H) return;
    const f=Math.min(W/state.W,H/state.H), w=state.W*f,h=state.H*f;
    renderer.setSize(w,h,false);
    Object.assign(renderer.domElement.style,{left:(W-w)/2+'px',top:(H-h)/2+'px',width:w+'px',height:h+'px'});
    overlayCamera.top=aspect()/2;overlayCamera.bottom=-aspect()/2;overlayCamera.updateProjectionMatrix();
    return;
  }
  const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
new ResizeObserver(resize).observe(document.querySelector('.picture')); resize();

export { avatar, view, renderer, scene, camera, overlayCamera, isOverlay, renderCamera, controls, frontView, grid, body, handRig,
  neck, clavL, clavR, spine, rootJoint, chinJoint, pelvisJoint, spineJoints, head, faceGroup, facePos, sm, resetSmoothing,
  updateBody, updateHand, updateFace, updateTorso, resize };
