// Mirror Puppet — character: his textured AccuRIG model, loaded on demand; directional retargeting of the
// smoothed landmarks onto its bones (Character 3D); the On-camera fit in image space with unrecognised regions
// hidden by a per-vertex mask; the display switch skeleton / character / on camera; the rest-pose button.
import * as THREE from 'three';
import { NF, BODY_JOINTS, $, ui, state, note, clamp, aspect, dImg } from './core.js';
import { bigFile } from './engines.js';
import { avatar, view, renderer, scene, isOverlay, controls, frontView, grid, body, handRig,
  neck, clavL, clavR, spine, rootJoint, chinJoint, pelvisJoint, spineJoints, head, faceGroup, facePos, resize } from './skeleton.js';
import { eyes, updateEyes } from './eyes.js';
import { stopCamera } from './camera.js';
import { present } from './main.js';

// ---------------------------------------------------------------- textured AccuRIG character
// The recognition engines and point skeleton stay unchanged. Retarget only in this adapter.
const avatarUI = $('avatarMode'), avatarInfo = $('avatarInfo');
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
const canonical = p => { const v = vec(p); if (state.mirror) v.x *= -1; return v; };
function orientation(x, y) {
  if (x.lengthSq() < 1e-10 || y.lengthSq() < 1e-10) return null;
  y.normalize(); x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-10) return null;
  x.normalize(); const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const boneOf = name => avatar.bones.get('CC_Base_' + name);
const restOf = name => avatar.rest.get('CC_Base_' + name);
function refDirection(name, end) {
  const r = restOf(name), e = restOf(end);
  return e ? e.p.clone().sub(r.p).normalize() : new THREE.Vector3(0, 1, 0).applyQuaternion(r.q);
}
function setWorldRotation(name, q) {
  const b = boneOf(name); if (!b || !q) return;
  const parent = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  b.quaternion.copy(parent.multiply(q)); b.updateWorldMatrix(false, true);
}
function aim(name, end, from, to) {
  if (!from || !to || !boneOf(name)) return;
  const d = to.clone().sub(from); if (d.lengthSq() < 1e-8) return;
  const q = new THREE.Quaternion().setFromUnitVectors(refDirection(name, end), d.normalize());
  setWorldRotation(name, q.multiply(restOf(name).q));
}
function applyFrame(names, target, reference) {
  if (!target || !reference) return;
  const delta = target.clone().multiply(reference.clone().invert());
  for (const name of names) if (boneOf(name)) setWorldRotation(name, delta.clone().multiply(restOf(name).q));
}
function resetAvatar() {
  if (!avatar.root) return;
  for (const [name, b] of avatar.bones) {
    const r = avatar.rest.get(name); b.quaternion.copy(r.localQ); b.position.copy(r.localP); b.scale.copy(r.localS);
  }
  avatar.root.scale.setScalar(avatar.scale); avatar.root.position.set(0, -.02, 0); avatar.root.updateMatrixWorld(true);
  avatar.tracked = false;
}
async function loadAvatar() {
  if (avatar.root) return avatar;
  if (avatar.promise) return avatar.promise;
  avatarInfo.textContent = 'Loading character…';
  avatar.promise = (async () => {
    // Same pinned three.js release; loaded only when a character is requested.
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const bytes = await bigFile(new URL('assets/anatomy-rig.glb?v=1', location.href).href);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const root = new THREE.Group(); root.name = 'TrackedCharacter'; root.add(gltf.scene); scene.add(root);
    root.updateMatrixWorld(true);
    let skinned = 0;
    gltf.scene.traverse(b => {
      if (b.isBone) avatar.bones.set(b.name, b);
      if (b.isSkinnedMesh) { skinned++; b.frustumCulled = false; }
    });
    for (const name of ['Hip','L_Upperarm','R_Upperarm','L_Forearm','R_Forearm','L_Hand','R_Hand','L_Thigh','R_Thigh','L_Calf','R_Calf','L_Foot','R_Foot','Head']) {
      if (!boneOf(name)) { scene.remove(root); avatar.bones.clear(); throw new Error('Missing character bone: ' + name); }
    }
    if (!skinned) throw new Error('Character has no skin');
    // Preserve the authored T pose, not the FBX bind pose (which may be an A pose).
    for (const [name,b] of avatar.bones) avatar.rest.set(name, {
      p: b.getWorldPosition(new THREE.Vector3()), q: b.getWorldQuaternion(new THREE.Quaternion()),
      localQ: b.quaternion.clone(), localP: b.position.clone(), localS: b.scale.clone()
    });
    const box = new THREE.Box3().setFromObject(gltf.scene, true);
    avatar.scale = 1.75 / box.getSize(new THREE.Vector3()).y;
    avatar.hip = restOf('Hip').p.clone();
    gltf.scene.position.sub(avatar.hip);
    avatar.root = root; installRegionMask(root); resetAvatar(); root.visible = avatarUI.value !== 'skeleton';
    document.body.classList.add('character-ready');
    avatarInfo.textContent = 'Body + fingers · face expressions later';
    if (avatar.last) present(avatar.last);
    if (root.visible && !isOverlay()) frontView();
    return avatar;
  })().catch(e => {
    avatar.promise = null; avatarUI.value = 'skeleton'; avatarInfo.textContent = 'Character unavailable · select to retry';
    configureDisplay(); note('Character: ' + e.message); if (avatar.last) present(avatar.last); throw e;
  });
  return avatar.promise;
}
function updateAvatar(res) {
  avatar.last = res;
  const active = avatarUI.value !== 'skeleton' && avatar.root;
  if (avatar.root) avatar.root.visible = !!active;
  if (!active) { updateEyes(null); return; }
  // Hide only the old 3D visualization. Its point calculations and the camera overlay still run.
  for (const g of [body.group,handRig.L.group,handRig.R.group,faceGroup,neck,clavL,clavR,spine,rootJoint,chinJoint,pelvisJoint,head,...spineJoints]) g.visible = false;
  if (isOverlay()) { updateCameraAvatar(res); updateEyes(res); return; }
  setRegions(null);
  const visible = i => res.poseWorld && (res.poseWorld[i].visibility == null || res.poseWorld[i].visibility > .5);
  const bodyReady = ui.body.checked && res.pose && res.poseWorld && [11,12,23,24].every(visible);
  // Solve in an unreflected world, then reflect the completed hierarchy once for Mirror.
  avatar.root.scale.setScalar(avatar.scale);
  for (const [name,b] of avatar.bones) { const r=avatar.rest.get(name); b.quaternion.copy(r.localQ); b.position.copy(r.localP); b.scale.copy(r.localS); }
  if (bodyReady) avatar.root.position.copy(body.pts[23]).add(body.pts[24]).multiplyScalar(.5);
  else avatar.root.position.set(0,-.02,0);
  avatar.root.updateMatrixWorld(true);
  const p = body.pts.map(canonical);
  if (bodyReady) {
  const hips = p[23].clone().add(p[24]).multiplyScalar(.5), chest=p[11].clone().add(p[12]).multiplyScalar(.5);
  const restHips=restOf('L_Thigh').p.clone().add(restOf('R_Thigh').p).multiplyScalar(.5);
  const restChest=restOf('L_Upperarm').p.clone().add(restOf('R_Upperarm').p).multiplyScalar(.5);
  const refFrame=orientation(restOf('L_Thigh').p.clone().sub(restOf('R_Thigh').p),restChest.clone().sub(restHips));
  applyFrame(['Hip','Pelvis'],orientation(p[23].clone().sub(p[24]),chest.clone().sub(hips)),refFrame);
  const chestRef=orientation(restOf('L_Upperarm').p.clone().sub(restOf('R_Upperarm').p),restChest.clone().sub(restHips));
  applyFrame(['Waist','Spine01','Spine02','NeckTwist01','NeckTwist02','Head'],orientation(p[11].clone().sub(p[12]),chest.clone().sub(hips)),chestRef);
  }
  if (ui.body.checked && res.pose && res.poseWorld) for (const [s,shoulder,elbow,wrist,hip,knee,ankle,toe] of [['L',11,13,15,23,25,27,31],['R',12,14,16,24,26,28,32]]) {
    if ([shoulder,elbow].every(visible)) aim(s+'_Upperarm',s+'_Forearm',p[shoulder],p[elbow]);
    if ([elbow,wrist].every(visible)) aim(s+'_Forearm',s+'_Hand',p[elbow],p[wrist]);
    if ([hip,knee].every(visible)) aim(s+'_Thigh',s+'_Calf',p[hip],p[knee]);
    if ([knee,ankle].every(visible)) aim(s+'_Calf',s+'_Foot',p[knee],p[ankle]);
    if ([ankle,toe].every(visible)) aim(s+'_Foot',s+'_ToeBase',p[ankle],p[toe]);
  }
  if (res.face && ui.face.checked) {
    const f = i => canonical(new THREE.Vector3().fromArray(facePos,i*3));
    const target=orientation(f(454).sub(f(234)),f(10).sub(f(152)));
    applyFrame(['Head'],target,new THREE.Quaternion());
  }
  for (const h of res.hands) {
    if (!ui.hands.checked || !h.world) continue;
    const s=h.side, hp=handRig[s].pts.map(canonical), rr=restOf(s+'_Hand').p;
    const target=orientation(hp[5].clone().sub(hp[17]),hp[9].clone().sub(hp[0]));
    const ref=orientation(restOf(s+'_Index1').p.clone().sub(restOf(s+'_Pinky1').p),restOf(s+'_Mid1').p.clone().sub(rr));
    applyFrame([s+'_Hand'],target,ref);
    for (const [finger,start] of [['Thumb',1],['Index',5],['Mid',9],['Ring',13],['Pinky',17]]) {
      for(let j=1;j<=3;j++) aim(s+'_'+finger+j,j<3?s+'_'+finger+(j+1):null,hp[start+j-1],hp[start+j]);
    }
  }
  avatar.root.scale.x = state.mirror ? -avatar.scale : avatar.scale;
  updateEyes(res);
  avatar.root.updateMatrixWorld(true); avatar.tracked=!!((ui.body.checked && res.poseWorld && BODY_JOINTS.some(visible)) || (res.face && ui.face.checked) || (res.hands.length && ui.hands.checked));
  avatarInfo.textContent = bodyReady ? 'Tracking body + fingers · face expressions later'
    : avatar.tracked ? 'Tracking visible parts · face expressions later' : 'Waiting for person · face expressions later';
}
// Image-space fitting uses the same contained video rectangle as the camera.
// Depth is inferred from landmarks, not a physical depth sensor.
function regionOf(name) {
  name=name.replace('CC_Base_','');
  const side=name.match(/^([LR])_/);
  if (!side) return /Head|Facial|Eye|Jaw|Teeth|Tongue|Neck/.test(name)?'head':'torso';
  const s=side[1];
  if (/Upperarm/.test(name)) return s+'upper';
  if (/Forearm|Elbow/.test(name)) return s+'fore';
  if (/Hand|Thumb|Index|Mid|Ring|Pinky/.test(name)) return s+'hand';
  if (/Thigh/.test(name)) return s+'thigh';
  if (/Calf|Knee/.test(name)) return s+'calf';
  if (/Foot|Toe/.test(name)) return s+'foot';
  if (/Eye/.test(name)) return 'head';
  return 'torso';
}
function installRegionMask(root) {
  avatar.masks=[];
  root.traverse(o=>{
    if (!o.isSkinnedMesh) return;
    const g=o.geometry, idx=g.attributes.skinIndex, weights=g.attributes.skinWeight;
    const regions=o.skeleton.bones.map(b=>regionOf(b.name));
    const attr=new THREE.Float32BufferAttribute(new Float32Array(idx.count).fill(1),1);
    g.setAttribute('trackedVisibility',attr);
    // The model's own eyeballs are hidden for good and our moving eyes take their place. The rig's eye bones sit
    // lower than the sculpted eyes, so the eyeballs are looked for in the mesh itself: separate, roundish pieces
    // (connected components) near the eye bones. Their centres are remembered in each eye bone's own frame.
    const eye=new Uint8Array(idx.count);
    if (boneOf('L_Eye') && boneOf('R_Eye')) {
      root.updateMatrixWorld(true);
      const pos=g.attributes.position, v=new THREE.Vector3();
      const bones={L:boneOf('L_Eye'),R:boneOf('R_Eye')}, centres={L:bones.L.getWorldPosition(new THREE.Vector3()),R:bones.R.getWorldPosition(new THREE.Vector3())};
      const ipd=centres.L.distanceTo(centres.R);
      const world=new Float32Array(pos.count*3);
      for(let k=0;k<pos.count;k++){ v.fromBufferAttribute(pos,k); o.applyBoneTransform(k,v); v.applyMatrix4(o.matrixWorld); world[k*3]=v.x; world[k*3+1]=v.y; world[k*3+2]=v.z; }
      // connected components over the triangles
      const parent=new Int32Array(pos.count); for(let k=0;k<pos.count;k++)parent[k]=k;
      const find=k=>{ while(parent[k]!==k){ parent[k]=parent[parent[k]]; k=parent[k]; } return k; };
      const union=(a,b)=>{ a=find(a); b=find(b); if(a!==b)parent[a]=b; };
      const ix=g.index?g.index.array:null, n=g.index?g.index.count:pos.count;
      for(let t=0;t<n;t+=3){ const a=ix?ix[t]:t,b=ix?ix[t+1]:t+1,c=ix?ix[t+2]:t+2; union(a,b); union(b,c); }
      // size up every component that has a vertex near an eye bone
      const comps=new Map();
      for(let k=0;k<pos.count;k++){
        v.set(world[k*3],world[k*3+1],world[k*3+2]);
        if(v.distanceTo(centres.L)>1.2*ipd && v.distanceTo(centres.R)>1.2*ipd) continue;
        const rt=find(k); let c=comps.get(rt); if(!c){ c={n:0,min:new THREE.Vector3(1e9,1e9,1e9),max:new THREE.Vector3(-1e9,-1e9,-1e9)}; comps.set(rt,c); }
        c.n++; c.min.min(v); c.max.max(v);
      }
      avatar.meshEyes={};
      for(const sd of ['L','R']){
        let best=null;
        for(const [rt,c] of comps){
          const size=c.max.clone().sub(c.min), ext=Math.max(size.x,size.y,size.z), low=Math.min(size.x,size.y,size.z);
          if(c.n<12 || ext<0.2*ipd || ext>0.7*ipd || low/ext<0.5) continue;      // small, round: an eyeball
          const centre=c.min.clone().add(c.max).multiplyScalar(0.5), d=centre.distanceTo(centres[sd]);
          if(d<0.9*ipd && (!best || d<best.d)) best={rt,centre,r:ext/2,d};
        }
        if(best){
          for(let k=0;k<pos.count;k++) if(find(k)===best.rt){ eye[k]=1; attr.setX(k,0); }
          // the eyeball centre in the eye bone's own frame (so it follows the head)
          const b=bones[sd], q=b.getWorldQuaternion(new THREE.Quaternion()).invert(), sc=b.getWorldScale(new THREE.Vector3()).x||1;
          avatar.meshEyes[sd]={ local:best.centre.clone().sub(centres[sd]).applyQuaternion(q).divideScalar(sc), r:best.r, world:best.centre.clone() };
        } else {   // no separate eyeball found: hide what sits around the bone, as before
          const r=ipd*0.36;
          for(let k=0;k<pos.count;k++){ v.set(world[k*3],world[k*3+1],world[k*3+2]); if(v.distanceTo(centres[sd])<r){ eye[k]=1; attr.setX(k,0); } }
        }
      }
      console.log('eyes in the mesh:', ['L','R'].map(sd=>avatar.meshEyes[sd]?sd+' found r='+(avatar.meshEyes[sd].r/ipd).toFixed(2)+' ipd':sd+' not found').join(', '));
      attr.needsUpdate=true;
    }
    avatar.masks.push({attr,idx,weights,regions,eye});
    for (const m of Array.isArray(o.material)?o.material:[o.material]) {
      m.onBeforeCompile=shader=>{
        shader.vertexShader='attribute float trackedVisibility; varying float vTrackedVisibility;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTrackedVisibility=trackedVisibility;');
        shader.fragmentShader='varying float vTrackedVisibility;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (vTrackedVisibility < 0.45) discard;');
      };
      m.customProgramCacheKey=()=> 'tracked-regions-v1'; m.needsUpdate=true;
    }
  });
}
function setRegions(visible) {
  const key=visible?[...visible].sort().join(','):'all';
  if (key===avatar.regionKey) return;
  avatar.regionKey=key; avatar.visibleRegions=visible?new Set(visible):null;
  for(const {attr,idx,weights,regions,eye} of avatar.masks||[]) {
    for(let i=0;i<attr.count;i++) {
      let value=visible?0:1;
      if(visible) for(let j=0;j<4;j++) if(visible.has(regions[idx.getComponent(i,j)])) value+=weights.getComponent(i,j);
      if(eye&&eye[i]) value=0;
      attr.setX(i,value);
    }
    attr.needsUpdate=true;
  }
}
function pinBone(name,target) {
  const b=boneOf(name); if(!b || !target) return;
  b.position.copy(b.parent.worldToLocal(target.clone())); b.updateWorldMatrix(false,true);
}
function updateCameraAvatar(res) {
  avatar.imagePoints ||= new Map();
  const used=new Set(), regions=new Set();
  const finite=p=>p && [p.x,p.y,p.z??0].every(Number.isFinite);
  const good=p=>finite(p) && (p.visibility==null || p.visibility>.5) && (p.presence==null || p.presence>.5);
  const point=(p,key,z=p.z??0)=>{
    used.add(key);
    const v=new THREE.Vector3(p.x-.5,-(p.y-.5)*aspect(),-z), old=avatar.imagePoints.get(key);
    if(old) v.lerp(old,Number(ui.smooth.value)/100);
    avatar.imagePoints.set(key,v.clone()); return v;
  };
  const p=Array.from({length:33},(_,i)=>ui.body.checked && good(res.pose?.[i])?point(res.pose[i],'p'+i):null);
  const hands=ui.hands.checked?(res.hands||[]).filter(h=>h.img?.length===21 && h.img.every(finite)):[];
  const face=ui.face.checked && res.face?.length===NF && res.face.every(finite)?res.face:null;
  const mid=(a,b)=>a.clone().add(b).multiplyScalar(.5);
  const refMid=(a,b)=>mid(restOf(a).p,restOf(b).p);
  const chest=p[11]&&p[12]?mid(p[11],p[12]):null, hips=p[23]&&p[24]?mid(p[23],p[24]):null;
  const restChest=refMid('L_Upperarm','R_Upperarm'), restHips=refMid('L_Thigh','R_Thigh');
  let scale=avatar.cameraScale || avatar.scale;
  // Prefer broad, reliable body measurements; use a hand only when it is all we see.
  const measures=[];
  if(chest) measures.push([p[11],p[12],'L_Upperarm','R_Upperarm']);
  if(chest && hips) measures.push([chest,hips,null,null,restChest.distanceTo(restHips)]);
  if(!measures.length) for(const [a,b,n,e] of [[11,13,'L_Upperarm','L_Forearm'],[12,14,'R_Upperarm','R_Forearm'],[13,15,'L_Forearm','L_Hand'],[14,16,'R_Forearm','R_Hand'],[23,25,'L_Thigh','L_Calf'],[24,26,'R_Thigh','R_Calf']]) {
    if(p[a]&&p[b]) measures.push([p[a],p[b],n,e]);
  }
  if(measures.length) {
    const values=measures.map(([a,b,n,e,d])=>a.distanceTo(b)/(d||restOf(n).p.distanceTo(restOf(e).p))).filter(v=>v>1e-5 && Number.isFinite(v));
    if(values.length) scale=values.reduce((a,b)=>a+b,0)/values.length;
  } else if(face && boneOf('L_Eye') && boneOf('R_Eye')) {
    scale=dImg(face[468],face[473])/restOf('L_Eye').p.distanceTo(restOf('R_Eye').p);
  } else if(hands.length) {
    const h=hands[0]; scale=dImg(h.img[0],h.img[9])/restOf(h.side+'_Hand').p.distanceTo(restOf(h.side+'_Mid1').p);
  }
  scale=clamp(scale,avatar.scale*.05,avatar.scale*8); avatar.cameraScale=scale;
  avatar.root.scale.setScalar(scale); avatar.root.position.set(0,0,0);
  for(const [name,b] of avatar.bones) {const r=avatar.rest.get(name);b.quaternion.copy(r.localQ);b.position.copy(r.localP);b.scale.copy(r.localS);}
  avatar.root.updateMatrixWorld(true);
  if(hips) avatar.root.position.copy(hips).sub(restHips.clone().sub(avatar.hip).multiplyScalar(scale));
  else if(chest) avatar.root.position.copy(chest).sub(restChest.clone().sub(avatar.hip).multiplyScalar(scale));
  avatar.root.updateMatrixWorld(true);
  if(chest) {
    regions.add('torso');
    const up=hips?chest.clone().sub(hips):new THREE.Vector3(0,1,0);
    const ref=orientation(restOf('L_Upperarm').p.clone().sub(restOf('R_Upperarm').p),restChest.clone().sub(restHips));
    const target=orientation(p[11].clone().sub(p[12]),up);
    applyFrame(['Hip','Pelvis','Waist','Spine01','Spine02','NeckTwist01','NeckTwist02','Head'],target,ref);
    // Recenter after rotating the spine; shoulders may be visible without the pelvis.
    const actual=mid(boneOf('L_Upperarm').getWorldPosition(new THREE.Vector3()),boneOf('R_Upperarm').getWorldPosition(new THREE.Vector3()));
    avatar.root.position.add(chest.clone().sub(actual)); avatar.root.updateMatrixWorld(true);
  }
  for(const [s,sh,el,wr,hi,kn,an,to] of [['L',11,13,15,23,25,27,31],['R',12,14,16,24,26,28,32]]) {
    for(const [name,end,a,b,region] of [['Upperarm','Forearm',sh,el,'upper'],['Forearm','Hand',el,wr,'fore'],['Thigh','Calf',hi,kn,'thigh'],['Calf','Foot',kn,an,'calf'],['Foot','ToeBase',an,to,'foot']]) {
      if(!p[a] || !p[b]) continue;
      regions.add(s+region); aim(s+'_'+name,s+'_'+end,p[a],p[b]);
      pinBone(s+'_'+name,p[a]); pinBone(s+'_'+end,p[b]);
    }
  }
  if(face) {
    regions.add('head');
    const faceDz = (res.pose && p[0]) ? res.pose[0].z - face[1].z : 0;   // face depth -> body depth
    const f=i=>point(face[i],'f'+i,(face[i].z||0)+faceDz);
    applyFrame(['Head'],orientation(f(454).sub(f(234)),f(10).sub(f(152))),new THREE.Quaternion());
    const left=boneOf('L_Eye'),right=boneOf('R_Eye');
    if(left&&right) {
      const eL = (eyes.centre && eyes.centre.L) || left, eR = (eyes.centre && eyes.centre.R) || right;
      const eyesAt=mid(f(468),f(473)), actual=mid(eL.getWorldPosition(new THREE.Vector3()),eR.getWorldPosition(new THREE.Vector3()));
      pinBone('Head',boneOf('Head').getWorldPosition(new THREE.Vector3()).add(eyesAt.sub(actual)));
    } else pinBone('Head',f(152));
  }
  for(const h of hands) {
    const s=h.side, wrist=p[s==='L'?15:16], z0=wrist?-wrist.z:0;
    const hp=h.img.map((v,i)=>point(v,s+i,z0+(v.z||0)-(h.img[0].z||0)));
    regions.add(s+'hand');
    const ref=orientation(restOf(s+'_Index1').p.clone().sub(restOf(s+'_Pinky1').p),restOf(s+'_Mid1').p.clone().sub(restOf(s+'_Hand').p));
    applyFrame([s+'_Hand'],orientation(hp[5].clone().sub(hp[17]),hp[9].clone().sub(hp[0])),ref);
    pinBone(s+'_Hand',hp[0]);
    for(const [finger,start] of [['Thumb',1],['Index',5],['Mid',9],['Ring',13],['Pinky',17]]) for(let j=1;j<=3;j++) {
      const n=s+'_'+finger+j;
      aim(n,j<3?s+'_'+finger+(j+1):null,hp[start+j-1],hp[start+j]); pinBone(n,hp[start+j-1]);
    }
  }
  for(const key of avatar.imagePoints.keys()) if(!used.has(key)) avatar.imagePoints.delete(key);
  avatar.regionSeen ||= new Map(); avatar.frameNo = (avatar.frameNo || 0) + 1;
  for (const r of regions) avatar.regionSeen.set(r, avatar.frameNo);
  const stable = new Set([...avatar.regionSeen].filter(([, f]) => avatar.frameNo - f < 12).map(([r]) => r));
  setRegions(stable);
  avatar.root.scale.x=state.mirror?-scale:scale;
  if(state.mirror) avatar.root.position.x*=-1;
  avatar.root.updateMatrixWorld(true); avatar.tracked=regions.size>0; avatar.root.visible=avatar.tracked;
  avatarInfo.textContent=avatar.tracked?'Tracking visible parts · depth estimated':'Show a hand, face or body to track';
}

function configureDisplay() {
  const on=isOverlay(), picture=document.querySelector('.picture');
  document.body.classList.toggle('oncamera',on);
  renderer.domElement.classList.toggle('character-canvas',on);
  (on?picture:view).appendChild(renderer.domElement);
  (on?picture:view).appendChild(avatarInfo);
  scene.background=on?null:new THREE.Color(0x0f1317); grid.visible=!on; controls.enabled=!on;
  renderer.setClearColor(0x0f1317,on?0:1);
  if (!on) renderer.domElement.style.cssText='';
  ui.btnView.textContent=on?'3D view':document.body.classList.contains('puppet')?'On camera':'Puppet';
  resize();
}
avatarUI.onchange = async () => {
  configureDisplay();
  if (avatarUI.value !== 'skeleton') { try { await loadAvatar(); } catch { return; } }
  if (avatar.root) avatar.root.visible = avatarUI.value !== 'skeleton';
  if (avatar.last) present(avatar.last);
  if (!isOverlay()) frontView();
};
$('optGuides').onchange=()=>document.body.classList.toggle('guides',$('optGuides').checked);
$('avatarRest').onclick = async () => {
  stopCamera(); avatarUI.value='character'; document.body.classList.add('puppet');
  await avatarUI.onchange(); setRegions(null); resetAvatar(); frontView();
  avatarInfo.textContent='Rest pose · start camera to track';
};

export { avatarUI, avatarInfo, boneOf, restOf, orientation, applyFrame, aim, resetAvatar, loadAvatar, updateAvatar, setRegions, configureDisplay };
