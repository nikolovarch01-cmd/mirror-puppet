<!-- hand-written: start -->
# Mirror Puppet — code map

The page is `mirror-puppet.html` (style, markup, the import map with the pinned addresses and the build stamp,
one module tag). The code is in `js/`, one file per section, loaded as ES modules through the import map. No
build step, no bundler. `tools/codemap.py` regenerates everything below the markers from the files themselves
(`tools/check.py` runs it after every check), so the line numbers here are always current.

## Where to look

| you want to change… | go to |
|---|---|
| a model address, a colour, an expression name, a constant | `core.js` (constants) |
| what the page's elements are called in the code (`ui`, `chips`, `video`, `overlay`) | `core.js` (dom / state) |
| the neck root, clavicles, spine derived from the face and the pose | `core.js` (derived torso) — used by both the 2D overlay and the 3D puppet |
| how the big files are downloaded and kept on the device (IndexedDB) | `engines.js` (local store) |
| which MediaPipe models run, GPU/CPU, the shape of a detection result | `engines.js` (recognition engines, `createBackend`) |
| hands tied to the body's wrists | `engines.js` (`assignHands`) |
| the loading card, error cards, the automatic engine chain | `engines.js` (engine management) |
| recognition in worker threads: how many threads, the thread's own code, the frame hand-off, the newest-results engine | `threads.js` (`threadPlan`, `landmarkerWorkerSrc`, `grabFrame`, `createThreadedBackend`) |
| the 3D scene: renderer, cameras, lights, grid, the orbit controls | `skeleton.js` (3D scene) |
| the joints-and-bones puppet, image → scene coordinates, smoothing | `skeleton.js` (coordinates, puppet update) |
| the size of the 3D canvas in its box (both views) | `skeleton.js` (`resize`) |
| loading the character GLB, its rest pose, bone names | `character.js` (`loadAvatar`) |
| retargeting for Character 3D | `character.js` (`updateAvatar`) |
| the On-camera fit, hidden regions, the vertex mask | `character.js` (`updateCameraAvatar`, `installRegionMask`, `setRegions`) |
| the Display menu, the Rest pose button | `character.js` (`configureDisplay`, the wiring at its end) |
| the eyeballs and the gaze | `eyes.js` |
| the phone detector (worker), which hand holds, the phone model and its placement | `phone.js` |
| the skeleton drawn over the camera picture, the phone rectangle | `overlay.js` (`draw2D`) |
| the expression list | `overlay.js` (`updateBlend`) |
| the camera stream, front/back, sizes, the camera cards, the picture size | `camera.js` |
| Mirror, Flip, Puppet/Camera switch, Snapshot, header buttons | `camera.js` (controls) |
| the Performance panel: busy % per thread, the GPU estimate, the rows and bars | `monitor.js` (`mon.report` is what a thread calls, `mon.tick` draws once a second) |
| the frame: what happens in which order every frame | `main.js` (`present`, `loop`) |
| the status line | `main.js` (`setStatus`) |
| the console handle the tests use (`window.mirrorPuppet`) and the start-up order | `main.js` (end of file) |
| the build stamp / import map / the file:// notice | `mirror-puppet.html` (tail) and `tools/stamp.py` |

## Seams that are not obvious

- The modules import each other in circles (core → main for `setStatus`, character → main for `present`,
  engines ↔ phone, character ↔ camera). This is safe only because no file touches another file's variables
  while the modules are loading: at load time a file builds its own objects and points event handlers at
  functions. Keep it that way: a new top-level call into another module belongs in `main.js`'s start-up block.
- `avatar` (the character's state object) is declared in `skeleton.js` with the scene, because the skeleton's
  `resetSmoothing` and `frontView` read it; `character.js` fills it.
- `resize` lives in `skeleton.js` (it sizes the renderer) although the buttons that call it are in `camera.js`.
- `holding(side)` (does this hand hold a phone) is in `phone.js` and is used by the 2D overlay too.
- `present` (in `main.js`) is the one place that decides the order per frame: 2D overlay → body → face → hands →
  torso → chips → expressions → character → phone.
- `tools/split-manifest.json` records which lines of the pre-split page (commit af5f262) became which file.
- The threaded engine (`threads.js`) keeps the engine contract `{ key, label, detect(v, ts), close() }` but its
  `detect()` never waits: it hands the frame to idle threads and returns the newest assembled result, or `null`
  when nothing new arrived since the last frame (then the loop skips `present`, the puppet keeps its pose, the
  3D view still renders). `engine.threads` (1 or 3) marks it; the loop shows the slowest thread's time as the
  recognition time. `useEngine(sel, true)` rebuilds the same key (a new thread plan).
- A camera track the browser ends is restarted by `camera.js` (up to three times a minute); Chrome's video
  capture service can crash under load (seen in headless), so the page must not go dark when it does.
<!-- hand-written: end -->

<!-- everything below is generated by tools/codemap.py — edit the code, not this -->

## Files

| file | lines | what |
|---|---|---|
| `js/core.js` | 95 | core: constants and pinned model addresses, the page's elements and shared state, the small geometry helpers, and the derived torso (neck root, clavicles, spine). Every other module imports from here. |
| `js/engines.js` | 202 | recognition: the local store for the big files (IndexedDB), the MediaPipe engines (three separate models or the combined one), hands tied to the body's wrists, and the engine management (loading card, the automatic chain, error cards). |
| `js/threads.js` | 145 | threads: recognition in worker threads. With enough cores the three models (face, hands, body) each run in their own thread; with two or three cores one thread runs all three in turn; without workers the main thread does it as before. The main thread hands every idle thread a copy of the current frame and draws with the newest results it has, so the picture never waits for recognition. Each thread reports its work to the Performance panel. |
| `js/skeleton.js` | 211 | skeleton: the 3D scene (renderer, cameras, lights, grid), the rigs of joints and bones for the body, the hands and the face, image/world → scene coordinates, smoothing, the puppet update per frame, and the sizing of the 3D canvas to its box. |
| `js/eyes.js` | 75 | eyes: two eyeballs of our own where the character's own eyes were, and the gaze that turns them (Google's eyeLook values when the engine gives them, iris / corner / lid ratios otherwise). |
| `js/character.js` | 371 | character: his textured AccuRIG model, loaded on demand; directional retargeting of the smoothed landmarks onto its bones (Character 3D); the On-camera fit in image space with unrecognised regions hidden by a per-vertex mask; the display switch skeleton / character / on camera; the rest-pose button. |
| `js/phone.js` | 185 | phone: the cell-phone detector in its own worker (fed with bytes from the local store), which hand holds, and the phone (his iPhone model, a slab until it loads) placed from the hand points in every view. |
| `js/overlay.js` | 101 | 2D drawing: the skeleton over the camera picture (body, derived torso, hands with the phone rectangle, face mesh and contours) and the expression list under the picture. |
| `js/camera.js` | 114 | camera and buttons: the camera stream (front / back, sizes, failures on a card), the picture size, mirror, the phone's one-view switch, the snapshot, and the header buttons. |
| `js/monitor.js` | 101 | monitor: what the machine does each second — the main thread, every recognition thread, the video card — shown in the Performance panel (closed by default: one summary line; tap to open the rows with bars). Busy % of a thread = milliseconds it worked in the last second / 1000, so 100 − busy is the room left for more work on that thread. The GPU share is an estimate: the time of GPU-delegate recognition (which includes some CPU pre/post-processing) plus the measured draw time of the 3D view when the browser can time it (EXT_disjoint_timer_query_webgl2); no browser exposes a real GPU utilisation figure. |
| `js/main.js` | 83 | the loop: one frame (recognition → 2D drawing → puppet → character → phone), the status line, the console handle for the tests, and the start-up. The modules import each other in circles (a function defined in a later file is called from an earlier one). That is safe because no module touches another module's variables while the files are still loading: at load time each file only builds its own objects and points event handlers at functions; the calls come later. |
| `mirror-puppet.html` | 159 | style, markup, import map + build stamp, the module tag |

## `js/core.js`

core: constants and pinned model addresses, the page's elements and shared state, the small geometry helpers, and the derived torso (neck root, clavicles, spine). Every other module imports from here.

- imports from: `@mediapipe/tasks-vision` (2: FaceLandmarker, HandLandmarker); `main` (1: setStatus)
- exports: `MPV`, `G`, `IS_MOBILE`, `MODEL`, `NF`, `UA`, `BODY_JOINTS`, `BODY_BONES`, `SPINE_NAMES`, `SPINE_STEPS`, `HAND_BONES`, `FACE_TESS`, `FACE_CONT`, `COLOR`, `CSS`, `BS_NAME`, `$`, `video`, `overlay`, `octx`, `ui`, `chips`, `state`, `note`, `clamp`, `aspect`, `dImg`, `d3`, `midPt`, `addDelta`, `torsoFromFace`, `torsoFromPose`, `HEAD_IDS`

- L7 `const` `MPV`
- L8 `const` `G`
- L9 `const` `IS_MOBILE`
- L10 `const` `MODEL`
- L18 `const` `NF` — face mesh points (incl. irises)
- L19 `const` `UA` — short 'Android · Chrome 153' for the cards, so a phone can be reported
- L26 `const` `BODY_JOINTS`
- L27 `const` `BODY_BONES`
- L32 `const` `SPINE_NAMES` — CC_Base_Spine02 / Spine01 / Waist, projected between NeckTwist01 and Hip. Ratios measured from the exported rig's authored pose (same for bo
- L33 `const` `SPINE_STEPS`
- L34 `const` `HAND_BONES`
- L35 `const` `FACE_TESS`
- L36 `const` `FACE_CONT`
- L37 `const` `COLOR`
- L38 `const` `CSS`
- L39 `const` `BS_NAME`

**dom / state**

- L60 `const` `$`
- L61 `const` `video, overlay, octx`
- L62 `const` `ui`
- L65 `const` `chips`
- L66 `const` `state`
- L67 `fn` `note(msg)`
- L68 `on` `window 'error'`
- L69 `on` `window 'unhandledrejection'`
- L70 `const` `clamp`
- L71 `const` `aspect` — image y (0..1) -> width units: y * aspect
- L72 `const` `dImg`
- L73 `const` `d3`

**derived torso**

- L79 `const` `midPt` — The pose model has no neck, chest or clavicles. The neck root is placed below the chin (55 % of the face height) and half a head-depth behin
- L80 `fn` `addDelta(o, a, b, k)`
- L81 `fn` `torsoFromFace(chin, forehead, nose, headL, headR)`
- L86 `fn` `torsoFromPose(p)` — when there is no face mesh: from the eyes, mouth, ears and nose of the pose
- L92 `const` `HEAD_IDS`

## `js/engines.js`

recognition: the local store for the big files (IndexedDB), the MediaPipe engines (three separate models or the combined one), hands tied to the body's wrists, and the engine management (loading card, the automatic chain, error cards).

- imports from: `@mediapipe/tasks-vision` (5: FilesetResolver, FaceLandmarker, HandLandmarker, PoseLandmarker, HolisticLandmarker); `core` (6: MPV, MODEL, UA, $, ui, dImg); `skeleton` (1: resetSmoothing); `phone` (1: ensurePhoneDetector); `main` (1: setStatus); `threads` (2: threadPlan, createThreadedBackend)
- exports: `bigFile`, `getFileset`, `dl`, `createBackend`, `assignHands`, `backend`, `wanted`, `showLoading`, `showCard`, `showError`, `useEngine`, `onDetectError`

- L17 `const` `STORE`
- L18 `fn` `idb()`
- L25 `async fn` `idbGet(key)`
- L26 `async fn` `idbPut(key, val)`
- L27 `const` `dl`
- L28 `fn` `setProg()`
- L33 `async fn` `fetchBig(url)`
- L44 `async fn` `bigFile(url)` — Uint8Array, from the local store when it is there
- L52 `let` `fileset`
- L53 `async fn` `getFileset()`
- L65 `async fn` `createBackend(key)`
- L126 `fn` `assignHands(hands, pose)` — With three separate models the hands are tied to the nearest wrist of the body (in image space); a hand that has no wrist nearby keeps its o

**engine management**

- L150 `const` `CHAIN` — what "automatic" tries, in order
- L151 `const` `engineChain` — no threads on this device: skip them
- L152 `let` `backend, chainPos, wanted`
- L153 `fn` `showLoading(html, kind)`
- L159 `fn` `showCard(title, reason, buttons)` — A card keeps the menu reachable and always offers a way out; long traces stay in the console.
- L164 `fn` `showError(title, e)`
- L168 `async fn` `useEngine(sel, rebuild)` — rebuild: the same key again (a new thread plan)
- L193 `fn` `onDetectError(e)`
- L199 `on` `ui.engine.onchange`
- L200 `on` `$('optThreads').onchange`

## `js/threads.js`

threads: recognition in worker threads. With enough cores the three models (face, hands, body) each run in their own thread; with two or three cores one thread runs all three in turn; without workers the main thread does it as before. The main thread hands every idle thread a copy of the current frame and draws with the newest results it has, so the picture never waits for recognition. Each thread reports its work to the Performance panel.

- imports from: `@mediapipe/tasks-vision` (1: FilesetResolver); `core` (4: MPV, MODEL, $, ui); `engines` (2: bigFile, assignHands); `monitor` (1: mon)
- exports: `threadPlan`, `createThreadedBackend`, `grabFrame`

- L11 `const` `THREAD_NAME`
- L17 `fn` `threadPlan()` — How many recognition threads this machine should run: the Threads menu, else by the core count. Measured 2026-09-12 (laptop iGPU): three GPU
- L28 `const` `landmarkerWorkerSrc` — The thread's own code (a classic worker: the library needs importScripts). It receives the library, the wasm pair and its models as bytes, b
- L29 `run` `"const tasks = {}; let used = '';\n" +`
- L30 `run` `"const make = async (V, fs, kind, buf, delegate) => {\n" +`
- L31 `run` `"  const base = { baseOptions: { modelAssetBuffer: new Uint8Array(buf), delegate }, runnin`
- L32 `run` `"  if (typeof OffscreenCanvas !== 'undefined') base.canvas = new OffscreenCanvas(1, 1);   `
- L33 `run` `"  if (kind === 'face') return V.FaceLandmarker.createFromOptions(fs, Object.assign(base, `
- L34 `run` `"  if (kind === 'hand') return V.HandLandmarker.createFromOptions(fs, Object.assign(base, `
- L35 `run` `"  return V.PoseLandmarker.createFromOptions(fs, Object.assign(base, { numPoses: 1 }));\n"`
- L36 `run` `"};\n" +`
- L37 `run` `"const warmUp = t => { t.detectForVideo(new ImageData(64, 64), 1); };   // the first detec`
- L38 `run` `"self.onmessage = async e => {\n" +`
- L39 `run` `"  const m = e.data;\n" +`
- L40 `run` `"  if (m.type === 'init') {\n" +`
- L41 `run` `"    try {\n" +`
- L42 `run` `"      importScripts(URL.createObjectURL(new Blob([m.lib], { type: 'text/javascript' })));`
- L43 `run` `"      const V = self.exports;\n" +`
- L44 `run` `"      const fs = { wasmLoaderPath: URL.createObjectURL(new Blob([m.js], { type: 'text/jav`
- L45 `run` `"      for (const kind of m.kinds) { tasks[kind] = await make(V, fs, kind, m.models[kind],`
- L46 `run` `"      self.postMessage({ type: 'ready', delegate: used, gl: typeof OffscreenCanvas !== 'u`
- L47 `run` `"    } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message`
- L48 `run` `"    return;\n" +`
- L49 `run` `"  }\n" +`
- L50 `run` `"  if (m.type === 'frame') {\n" +`
- L51 `run` `"    const out = { type: 'result', ts: m.ts, ms: {} };\n" +`
- L52 `run` `"    try {\n" +`
- L53 `run` `"      for (const kind of m.kinds) {\n" +`
- L54 `run` `"        const t = performance.now(), r = tasks[kind].detectForVideo(m.frame, m.ts);\n" +`
- L55 `run` `"        out.ms[kind] = performance.now() - t;\n" +`
- L56 `run` `"        if (kind === 'face') { out.face = r.faceLandmarks[0] || null; out.blend = r.faceB`
- L57 `run` `"        else if (kind === 'hand') out.hands = r.landmarks.map((img, i) => ({ side: null, `
- L58 `run` `"        else { out.pose = r.landmarks[0] || null; out.poseWorld = r.worldLandmarks[0] || `
- L59 `run` `"      }\n" +`
- L60 `run` `"    } catch (err) { out.error = String((err && err.message) || err); }\n" +`
- L61 `run` `"    m.frame.close(); self.postMessage(out);\n" +`
- L62 `run` `"  }\n" +`
- L63 `run` `"};\n" +`
- L64 `run` `"})();\n";`
- L67 `fn` `grabFrame(v)` — The frame handed to a thread: a copy of the camera picture that can be moved to another thread.
- L69 `async fn` `startWorker(kinds, delegate, kit, models)`
- L87 `async fn` `createThreadedBackend(delegate)` — The engine: same shape as the others ({ key, label, detect(v, ts), close() }), but detect() never waits.

## `js/skeleton.js`

skeleton: the 3D scene (renderer, cameras, lights, grid), the rigs of joints and bones for the body, the hands and the face, image/world → scene coordinates, smoothing, the puppet update per frame, and the sizing of the 3D canvas to its box.

- imports from: `three` (1: THREE); `three/addons/controls/OrbitControls.js` (1: OrbitControls); `core` (21 names)
- exports: `avatar`, `view`, `renderer`, `scene`, `camera`, `overlayCamera`, `isOverlay`, `renderCamera`, `controls`, `frontView`, `grid`, `body`, `handRig`, `neck`, `clavL`, `clavR`, `spine`, `rootJoint`, `chinJoint`, `pelvisJoint`, `spineJoints`, `head`, `faceGroup`, `facePos`, `sm`, `resetSmoothing`, `updateBody`, `updateHand`, `updateFace`, `updateTorso`, `resize`

- L10 `const` `avatar`
- L11 `const` `view`
- L12 `const` `renderer`
- L13 `run` `renderer.setPixelRatio(IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 2));`
- L14 `run` `view.appendChild(renderer.domElement);`
- L15 `on` `renderer.domElement 'webglcontextlost'`
- L16 `on` `renderer.domElement 'webglcontextrestored'`
- L17 `const` `scene`
- L18 `run` `scene.background = new THREE.Color(0x0f1317);`
- L19 `const` `camera`
- L20 `const` `overlayCamera`
- L21 `run` `overlayCamera.position.z=10;`
- L22 `const` `isOverlay`
- L23 `const` `renderCamera`
- L24 `const` `controls`
- L25 `run` `controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.3; `
- L26 `fn` `frontView()`
- L36 `run` `frontView();`
- L37 `run` `scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x1a2027, 1.6));`
- L38 `const` `sun`
- L39 `const` `grid`
- L41 `const` `sphereGeo`
- L42 `const` `cylGeo`
- L43 `const` `matBone`
- L44 `const` `matJoint`
- L45 `const` `_up, _dir`
- L46 `fn` `setBone(mesh, a, b, r)`
- L56 `fn` `makeRig(jointIds, bones, nPts, color, rJoint, rBone)` — A rig: joints (spheres) + bones (cylinders) over a point table `pts`
- L70 `const` `body`
- L71 `const` `handRig`
- L73 `const` `torsoMat, torsoJointMat`
- L74 `const` `mkBone`
- L75 `const` `mkJoint`
- L76 `const` `neck, clavL, clavR, spine`
- L77 `const` `rootJoint, chinJoint, pelvisJoint`
- L78 `const` `spineJoints`
- L79 `const` `head`
- L80 `let` `lastPW` — the last pose (world) result, for the visibility of its points
- L83 `const` `facePos` — The face: 478 shared points, drawn as the mesh (thin), the contours (bright) and dots
- L84 `const` `faceAttr`
- L85 `const` `mkGeo`
- L86 `const` `faceGroup`
- L87 `const` `tessLines`
- L88 `const` `contLines`
- L89 `const` `facePoints`
- L90 `run` `for (const o of [tessLines, contLines, facePoints]) { o.frustumCulled = false; faceGroup.a`

**coordinates**

- L96 `const` `_a, _b, _t` — Image landmarks: x,y in 0..1 of the frame, z in the same units as x, smaller = closer to the camera. World landmarks (body, hands): metres, 
- L97 `fn` `imgToScene(p, k, out)` — point in the frame -> a plane facing the viewer, k = metres per frame width
- L101 `fn` `deltaToScene(dx, dy, dz, out)` — a metric offset in world axes -> scene axes
- L107 `const` `sm` — Smoothing: an exponential average per point; a part that reappears starts fresh.
- L109 `fn` `smoothInto(store, i, v)`
- L114 `fn` `resetSmoothing()`

**puppet update**

- L117 `fn` `updateBody(res)`
- L136 `fn` `updateHand(h)`
- L151 `fn` `updateFace(res)`
- L169 `fn` `updateTorso(hasBody, hasFace)`
- L193 `fn` `resize()`
- L206 `on` `ResizeObserver`
- L207 `on` `ResizeObserver`

## `js/eyes.js`

eyes: two eyeballs of our own where the character's own eyes were, and the gaze that turns them (Google's eyeLook values when the engine gives them, iris / corner / lid ratios otherwise).

- imports from: `three` (1: THREE); `core` (3: ui, state, clamp); `skeleton` (1: avatar); `character` (2: boneOf, restOf)
- exports: `eyes`, `buildEyes`, `gazeFrom`, `gazeFromBlend`, `updateEyes`

- L13 `const` `eyes`
- L14 `const` `eyeWhite`
- L15 `const` `irisMat`
- L16 `const` `pupilMat`
- L17 `const` `_eq, _ee, _em`
- L18 `fn` `buildEyes()`
- L47 `fn` `gazeFrom(f)`
- L54 `fn` `gazeFromBlend(cats)` — Google's own gaze values (eyeLookIn/Out/Up/Down per eye, 0..1)
- L61 `fn` `updateEyes(res)`

## `js/character.js`

character: his textured AccuRIG model, loaded on demand; directional retargeting of the smoothed landmarks onto its bones (Character 3D); the On-camera fit in image space with unrecognised regions hidden by a per-vertex mask; the display switch skeleton / character / on camera; the rest-pose button.

- imports from: `three` (1: THREE); `core` (9 names); `engines` (1: bigFile); `skeleton` (22 names); `eyes` (2: eyes, updateEyes); `camera` (1: stopCamera); `main` (1: present)
- exports: `avatarUI`, `avatarInfo`, `boneOf`, `restOf`, `orientation`, `applyFrame`, `aim`, `resetAvatar`, `loadAvatar`, `updateAvatar`, `setRegions`, `configureDisplay`

- L15 `const` `avatarUI, avatarInfo`
- L16 `const` `vec`
- L17 `const` `canonical`
- L18 `fn` `orientation(x, y)`
- L25 `const` `boneOf`
- L26 `const` `restOf`
- L27 `fn` `refDirection(name, end)`
- L31 `fn` `setWorldRotation(name, q)`
- L36 `fn` `aim(name, end, from, to)`
- L42 `fn` `applyFrame(names, target, reference)`
- L47 `fn` `resetAvatar()`
- L55 `async fn` `loadAvatar()`
- L96 `fn` `updateAvatar(res)`
- L153 `fn` `regionOf(name)` — Image-space fitting uses the same contained video rectangle as the camera. Depth is inferred from landmarks, not a physical depth sensor.
- L167 `fn` `installRegionMask(root)`
- L234 `fn` `setRegions(visible)`
- L248 `fn` `pinBone(name,target)`
- L252 `fn` `updateCameraAvatar(res)`
- L345 `fn` `configureDisplay()`
- L357 `on` `avatarUI.onchange`
- L364 `on` `$('optGuides').onchange`
- L365 `on` `$('avatarRest').onclick`

## `js/phone.js`

phone: the cell-phone detector in its own worker (fed with bytes from the local store), which hand holds, and the phone (his iPhone model, a slab until it loads) placed from the hand points in every view.

- imports from: `three` (1: THREE); `@mediapipe/tasks-vision` (2: FilesetResolver, ObjectDetector); `core` (8 names); `engines` (2: bigFile, getFileset); `skeleton` (4: avatar, scene, isOverlay, handRig); `monitor` (1: mon)
- exports: `phone`, `ensurePhoneDetector`, `detectPhones`, `acceptBoxes`, `phoneFrame`, `holding`, `updatePhones`

- L16 `const` `phone`
- L19 `const` `phoneWorkerSrc` — The detector runs in a worker (its own thread), so the picture never stalls while it thinks; the main thread only sends a frame every 4th fr
- L20 `run` `"let det = null;\n" +`
- L21 `run` `"self.onmessage = async e => {\n" +`
- L22 `run` `"  const m = e.data;\n" +`
- L23 `run` `"  if (m.type === 'init') {\n" +`
- L24 `run` `"    try {\n" +`
- L25 `run` `"      importScripts(URL.createObjectURL(new Blob([m.lib], { type: 'text/javascript' })));`
- L26 `run` `"      const fs = { wasmLoaderPath: URL.createObjectURL(new Blob([m.js], { type: 'text/jav`
- L27 `run` `"      const opts = d => ({ baseOptions: { modelAssetBuffer: new Uint8Array(m.model), dele`
- L28 `run` `"      try { det = await ObjectDetector.createFromOptions(fs, opts('GPU')); self.postMessa`
- L29 `run` `"      catch (err) { det = await ObjectDetector.createFromOptions(fs, opts('CPU')); self.p`
- L30 `run` `"    } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message`
- L31 `run` `"    return;\n" +`
- L32 `run` `"  }\n" +`
- L33 `run` `"  if (m.type === 'frame') {\n" +`
- L34 `run` `"    let boxes = []; const t = performance.now();\n" +`
- L35 `run` `"    try { if (det) boxes = det.detect(m.bitmap).detections.map(d => ({ originX: d.boundin`
- L36 `run` `"    catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) `
- L37 `run` `"    m.bitmap.close(); self.postMessage({ type: 'boxes', boxes, ms: performance.now() - t `
- L38 `run` `"  }\n" +`
- L39 `run` `"};\n";`
- L40 `async fn` `ensurePhoneDetector()`
- L72 `const` `await_` — (the inline fallback reuses the model bytes as they are)
- L73 `fn` `detectPhones(ts, hands)` — every 4th frame, only in 'auto', only while a hand is in the picture
- L90 `fn` `acceptBoxes(boxes, hands)` — A box counts for a hand only if: it is at least 50 % sure, it is shaped like a phone (long side 1.4-2.8 x the short side, not most of the pi
- L108 `const` `phoneMat` — a white back, like his
- L109 `const` `islandMat`
- L110 `const` `lensMat`
- L114 `async fn` `loadPhoneModel()` — The real look: 'aiPhone 15 Pro - Low Poly smartphone' by hysokana (Sketchfab, CC BY-NC 4.0), 14.6 x 7 x 0.8 cm in metres, screen towards +z.
- L133 `fn` `dressPhone(g)`
- L137 `fn` `phoneMesh(side)` — sized in units of the hand length: 1.47 x 0.72 x 0.08 (14.7 x 7.2 x 0.8 cm for a 10 cm hand)
- L147 `const` `_pc, _pl, _ps, _pn, _pf, _pm`
- L148 `fn` `phoneFrame(pts)` — pts: 21 Vector3-like points -> { c, long, short, normal, L }
- L157 `fn` `holding(side)`
- L160 `fn` `updatePhones(res)` — The phone is a fixed size (1.47 hand lengths long) and always in the hand: on the palm side, tilted with the palm, its long edge along which
- L183 `on` `$('optPhone').onchange`

## `js/overlay.js`

2D drawing: the skeleton over the camera picture (body, derived torso, hands with the phone rectangle, face mesh and contours) and the expression list under the picture.

- imports from: `core` (16 names); `phone` (1: holding)
- exports: `strokePairs`, `dots`, `draw2D`, `updateBlend`

- L8 `fn` `strokePairs(pts, pairs, W, H, ok)`
- L16 `fn` `dots(pts, ids, W, H, r, ok)`
- L21 `fn` `draw2D(res)`

**expression bars**

- L76 `const` `bsList, bsRows`
- L77 `run` `for (let i = 0; i < 6; i++) {`
- L83 `let` `bsAt`
- L84 `fn` `updateBlend(cats, hasFace)`

## `js/camera.js`

camera and buttons: the camera stream (front / back, sizes, failures on a card), the picture size, mirror, the phone's one-view switch, the snapshot, and the header buttons.

- imports from: `core` (7 names); `engines` (1: showCard); `skeleton` (8 names); `character` (1: avatarUI); `main` (1: setStatus)
- exports: `startCamera`, `stopCamera`, `listCameras`, `syncSize`, `setMirror`

- L10 `let` `stream, currentDeviceId, currentFacing, restarts` — restarts: when the browser ended a track and we started again
- L11 `on` `window 'orientationchange'`
- L12 `async fn` `startCamera(deviceId, facing)`
- L55 `fn` `stopCamera()`
- L59 `async fn` `listCameras()`
- L71 `fn` `syncSize()` — The picture size is read whenever it changes (a phone turned, a camera that starts with a tiny first frame).
- L78 `on` `video 'loadedmetadata'`
- L79 `on` `video 'resize'`
- L80 `on` `ui.camSel.onchange`
- L81 `on` `ui.btnCam.onclick`

**controls**

- L84 `fn` `setMirror(on)`
- L85 `on` `ui.mirror.onchange`
- L86 `on` `ui.btnFlip.onclick`
- L87 `on` `ui.video.onchange`
- L88 `on` `$('front').onclick`
- L89 `on` `$('btnTools').onclick`
- L90 `on` `$('exprTitle').onclick`
- L92 `on` `ui.btnView.onclick` — On a phone there is one view at a time: the camera picture or the puppet
- L100 `on` `ui.btnSnap.onclick`

## `js/monitor.js`

monitor: what the machine does each second — the main thread, every recognition thread, the video card — shown in the Performance panel (closed by default: one summary line; tap to open the rows with bars). Busy % of a thread = milliseconds it worked in the last second / 1000, so 100 − busy is the room left for more work on that thread. The GPU share is an estimate: the time of GPU-delegate recognition (which includes some CPU pre/post-processing) plus the measured draw time of the 3D view when the browser can time it (EXT_disjoint_timer_query_webgl2); no browser exposes a real GPU utilisation figure.

- imports from: `core` (1: $); `skeleton` (1: renderer)
- exports: `mon`

- L10 `const` `KIND_ORDER`
- L11 `const` `mon`
- L89 `fn` `initGpu()`
- L100 `on` `$('perfTitle').onclick`

## `js/main.js`

the loop: one frame (recognition → 2D drawing → puppet → character → phone), the status line, the console handle for the tests, and the start-up. The modules import each other in circles (a function defined in a later file is called from an earlier one). That is safe because no module touches another module's variables while the files are still loading: at load time each file only builds its own objects and points event handlers at functions; the calls come later.

- imports from: `three` (1: THREE); `core` (8 names); `engines` (4: backend, wanted, useEngine, onDetectError); `skeleton` (16 names); `eyes` (1: eyes); `character` (3: loadAvatar, updateAvatar, configureDisplay); `phone` (4: phone, acceptBoxes, detectPhones, updatePhones); `overlay` (2: draw2D, updateBlend); `camera` (3: startCamera, stopCamera, syncSize); `monitor` (1: mon)
- exports: `present`, `setStatus`, `perf`

- L19 `fn` `present(res)`

**loop**

- L38 `let` `fps, frames, fpsAt, lastVT, lastTs`
- L39 `const` `perf` — ms per frame: recognition, then drawing (smoothed)
- L40 `fn` `setStatus(msg)`
- L46 `fn` `loop()`
- L73 `run` `window.mirrorPuppet = { THREE, state, phone, eyes, mon, acceptBoxes, present, startCamera,` — a small handle for testing from the console
- L75 `run` `configureDisplay(); loadAvatar().catch(() => {});`
- L76 `run` `loop();`
- L77 `run` `useEngine(ui.engine.value);`
- L78 `run` `startCamera();`
- L81 `const` `BUILD` — the build stamp (the ?v= of this file, see tools/stamp.py) shown in Settings, so a phone screenshot tells which build it runs
- L82 `run` `$('build').textContent = 'build ' + BUILD; window.mirrorPuppet.build = BUILD;`

## `mirror-puppet.html` — elements by id

- L84 `#btnCam` button
- L85 `#btnView` button
- L86 `#btnFlip` button — Front / back camera
- L87 `#btnTools` button
- L89 `#camSel` select — Which camera
- L90 `#optFace` input
- L91 `#optHands` input
- L92 `#optBody` input
- L93 `#optMesh` input
- L94 `#optMirror` input
- L95 `#optVideo` input
- L96 `#optSmooth` input
- L97 `#optEngine` select
- L106 `#optThreads` select
- L107 `#avatarMode` select
- L108 `#optGuides` input
- L109 `#optPhone` select — A phone in the hand: found automatically, or forced
- L110 `#avatarRest` button — Stop camera and inspect the character rest pose
- L111 `#btnSnap` button — Saves a picture of both views
- L112 `#build` span
- L114 `#status` span
- L117 `#cam` section
- L119 `#video` video
- L120 `#overlay` canvas
- L121 `#chipFace` span
- L121 `#chipBody` span
- L121 `#chipL` span
- L121 `#chipR` span
- L121 `#chipPhone` span
- L123 `#expr` div
- L123 `#exprTitle` h2
- L123 `#bsList` div
- L124 `#perf` div — What the machine does each second: main thread, recognition threads, video card
- L124 `#perfTitle` h2
- L124 `#perfList` div
- L126 `#view3d` section
- L127 `#avatarInfo` div
- L128 `#front` button
- L129 `#hint` div
- L131 `#loading` div
- L131 `#prog` small

