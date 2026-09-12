// Mirror Puppet — eyes: two eyeballs of our own where the character's own eyes were, and the gaze that turns
// them (Google's eyeLook values when the engine gives them, iris / corner / lid ratios otherwise).
import * as THREE from 'three';
import { ui, state, clamp } from './core.js';
import { avatar } from './skeleton.js';
import { boneOf, restOf } from './character.js';

// ---------------------------------------------------------------- moving pupils
// The character's eye bones carry no skin, so two eyeballs of our own sit on them: a white ball, an iris
// and a pupil, turned to where the recognised irises look. Gaze per eye from the iris centre against the
// eye corners and lids (MediaPipe: right iris 468, corners 133 inner / 33 outer, lids 159 / 145; left iris
// 473, corners 362 / 263, lids 386 / 374). Yaw + = towards the person's right, pitch + = up.
const eyes = { L: null, R: null, yaw: { L: 0, R: 0 }, pitch: { L: 0, R: 0 } };
const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35 });
const irisMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.5 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.3 });
const _eq = new THREE.Quaternion(), _ee = new THREE.Euler(), _em = new THREE.Matrix4();
function buildEyes() {
  if (eyes.L || !boneOf('L_Eye') || !boneOf('R_Eye') || !boneOf('Head')) return;
  const ipd = restOf('L_Eye').p.distanceTo(restOf('R_Eye').p);
  const me = avatar.meshEyes || {};
  const r = me.L && me.R ? Math.max(me.L.r, me.R.r) * 1.04 : ipd * 0.24;   // the model's own eyeball size when it was found
  // the face plane: across = right eye -> left eye, up = jaw (or head) -> between the eyes; forward = its normal
  const eyeMid = restOf('L_Eye').p.clone().add(restOf('R_Eye').p).multiplyScalar(0.5);
  // the rest pose stands upright, so the head's up is the world's up; across = right eye -> left eye
  const across = restOf('L_Eye').p.clone().sub(restOf('R_Eye').p).normalize();
  let up = new THREE.Vector3(0, 1, 0); up.addScaledVector(across, -up.dot(across)).normalize();
  const forward = new THREE.Vector3().crossVectors(across, up).normalize();   // out of the face for a right-handed (across, up, forward)
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const world = new THREE.Quaternion().setFromRotationMatrix(_em.makeBasis(right, up, forward));
  for (const side of ['L', 'R']) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), eyeWhite));
    const iris = new THREE.Mesh(new THREE.CircleGeometry(r * 0.46, 24), irisMat); iris.position.z = r * 1.0; g.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.2, 20), pupilMat); pupil.position.z = r * 1.01; g.add(pupil);
    g.userData.base = restOf(side + '_Eye').q.clone().invert().multiply(world);   // looking straight ahead, in the bone's frame
    g.quaternion.copy(g.userData.base); g.visible = false;
    // the eye bones sit at the end of a scaled chain: undo that scale so the ball keeps its size in the model's units
    const chain = Math.abs(boneOf(side + '_Eye').getWorldScale(new THREE.Vector3()).x / (avatar.root.scale.x || 1)) || 1;
    g.scale.setScalar(1 / chain);
    // where the model's own eyeball was, in the bone's frame (or, without one, pushed forward out of the socket)
    if (me[side]) g.position.copy(me[side].local); else g.position.set(0, 0, 1).applyQuaternion(g.userData.base).multiplyScalar(0.12 * ipd / chain);
    const centre = new THREE.Object3D(); centre.position.copy(g.position); boneOf(side + '_Eye').add(centre); eyes.centre = eyes.centre || {}; eyes.centre[side] = centre;
    boneOf(side + '_Eye').add(g); eyes[side] = g;
  }
}
function gazeFrom(f) {
  const ratio = (v, a, b) => Math.abs(b - a) < 1e-6 ? 0.5 : (v - a) / (b - a);
  return {
    R: { yaw: (ratio(f[468].x, f[133].x, f[33].x) - 0.5) * 2.4, pitch: (0.5 - ratio(f[468].y, f[159].y, f[145].y)) * 1.6 },
    L: { yaw: -(ratio(f[473].x, f[362].x, f[263].x) - 0.5) * 2.4, pitch: (0.5 - ratio(f[473].y, f[386].y, f[374].y)) * 1.6 },
  };
}
function gazeFromBlend(cats) {   // Google's own gaze values (eyeLookIn/Out/Up/Down per eye, 0..1)
  const v = n => { const c = cats.find(x => x.categoryName === n); return c ? c.score : 0; };
  return {
    R: { yaw: (v('eyeLookOutRight') - v('eyeLookInRight')) * 0.7, pitch: (v('eyeLookUpRight') - v('eyeLookDownRight')) * 0.6 },
    L: { yaw: (v('eyeLookInLeft') - v('eyeLookOutLeft')) * 0.7, pitch: (v('eyeLookUpLeft') - v('eyeLookDownLeft')) * 0.6 },
  };
}
function updateEyes(res) {
  if (!eyes.L) buildEyes();
  if (!eyes.L) return;
  const on = !!(avatar.root && avatar.root.visible);
  eyes.L.visible = eyes.R.visible = on;
  if (!on) return;
  const g = res && res.face && ui.face.checked ? (res.blend && res.blend.length ? gazeFromBlend(res.blend) : gazeFrom(res.face)) : { L: { yaw: 0, pitch: 0 }, R: { yaw: 0, pitch: 0 } };
  for (const side of ['L', 'R']) {
    eyes.yaw[side] += (clamp(g[side].yaw * (state.mirror ? -1 : 1), -0.6, 0.6) - eyes.yaw[side]) * 0.5;   // the mirrored character is a reflection
    eyes.pitch[side] += (clamp(g[side].pitch, -0.4, 0.4) - eyes.pitch[side]) * 0.5;
    _eq.setFromEuler(_ee.set(-eyes.pitch[side], eyes.yaw[side], 0, 'YXZ'));
    eyes[side].quaternion.copy(eyes[side].userData.base).multiply(_eq);
  }
}
export { eyes, buildEyes, gazeFrom, gazeFromBlend, updateEyes };
