# Verification without a camera (Windows, headless Chrome)

All commands from the repo root. Python 3 (`py`) and Google Chrome are needed. Nothing here touches the
user's screen.

## 0. One command

```
py tools\check.py
```

Does sections 1 and 5 by itself in about 10–30 s. It starts `tools\testsrv.py` on a free port (8765 if
free), runs headless Chrome with the flags from section 1 against `harness.html`, reads Chrome's
stderr live and stops Chrome (by PID) as soon as the harness prints `DONE` or `ERROR` (or after
`--timeout`, default 150 s), then stops the server. It prints the `HARNESS` lines with the console
prefix stripped (`[…:INFO:CONSOLE:4] "…", source: …` — current Chrome writes `CONSOLE:4]`, older builds
`CONSOLE(4)]`; both are handled), the `files from the local store` line, any line containing
`Uncaught`, `TypeError`, `ReferenceError`, `SyntaxError`, `engine failed` or `detect failed`, the
elapsed seconds and the PNGs written to the repo root (git-ignored). Exit code 0 only if `DONE` was
reached and no error line appeared.

The Chrome profile is `%TEMP%\mirror-puppet-check-profile` and is kept between runs: the first run
downloads the models (~33 MB), the next ones print `files from the local store: N | downloaded MB: 0.0`.
The server sends `Cache-Control: no-store`, so the page itself is never stale — no need to delete
the profile after editing the page.

Flags: `--avatar` runs `avatar-harness.html` (section 5, expects `AVATAR_DONE`); `--phone` uses a
390x844 window and the iPhone user agent (adds `?phone` for `--avatar`); `--harness eyes|overlay|phone`
runs one of the feature harnesses (section 6); **`--all` runs everything in a row** (desktop, avatar,
phone-size desktop, phone-size avatar, eyes, overlay, phone, threads — about 90 s, one summary line each,
exit 1 if any failed). When headless Chrome's fake camera dies at start (its video capture service crashes in
roughly one launch in three on this laptop, "Detected crash of video capture service" in Chrome's log), the
run is launched again automatically (up to three launches) and a `-- note:` line says so. Gate scripts on
check.py's own exit code — `py tools\check.py --all | grep …` returns grep's; `--fresh` deletes the profile first; `--keep` leaves Chrome and the server running and
prints their PIDs; `--timeout N`; `--port N` (preferred server port); `--log FILE` saves Chrome's full
stderr for a closer look.

Before Chrome, every run syntax-checks the `js/` modules with node (Node 24 is installed) and runs
`tools\modcheck.py` (imports/exports between the modules; a name used from another module without an
import is a PROBLEM; the check is approximate — a local variable named like another module's top-level
name shows as a false positive). `--no-static` skips that. After Chrome, `tools\codemap.py` rewrites
`CODE_MAP.md` from the code so the map never lags (`--no-map` skips it; `py tools\codemap.py --check`
tells whether it is behind).

The desktop harness also verifies that all nine modules arrived with one and the same `?v=` build stamp
through the import map (`HARNESS modules 9 stamps … OK`). Before a push run **`py tools\stamp.py`** —
it renews the stamp in the page; `--show` prints it, `--check` complains when a js file is newer than the
stamp. `open-local.cmd` (→ `tools\open_local.py`) serves the folder on 127.0.0.1:8770 and opens the page
in the default browser — the way to open the page on this computer now that it is split into modules
(file:// cannot load them). `tools\split-manifest.json` records which lines of the pre-split page
(commit af5f262) became which module.

## 1. Desktop harness — load, detect on a fake camera, render a synthetic figure

```
py tools\testsrv.py 8765
```

(serves the repo root, accepts `POST /save/<name>` with a data URL and writes the file; sends
`Cache-Control: no-store`). In a second shell:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --no-first-run --window-size=1400,800 ^
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required ^
  --enable-unsafe-swiftshader --enable-logging=stderr --v=0 --user-data-dir=%TEMP%\chrome-h1 ^
  http://127.0.0.1:8765/tools/harness.html 2>&1 | findstr /C:"HARNESS" /C:"Uncaught" /C:"TypeError" /C:"engine failed" /C:"detect failed"
```

Kill Chrome after ~90 s (it does not exit on its own). `harness.html` loads the app in an iframe, waits
for `window.mirrorPuppet.backend`, prints the status, stops the camera, injects a synthetic person
(33 pose, 2×21 hand, 478 face points with realistic proportions), renders 25 frames and posts
`three.png` (puppet, front), `three-side.png` (puppet, side) and `overlay.png` (2D overlay) into the
repo root. Look at the PNGs. Expected log lines: `app ready … engine sep:GPU`, `visible objects 116`,
`chips face,body,left hand,right hand`, `DONE`, no errors. Delete `%TEMP%\chrome-h1` between runs when
the page changed (the profile caches aggressively). A second run in the same profile must print
`files from the local store: 5 | downloaded MB: 0.0` (the IndexedDB store works).

## 2. Phone-size run

Same Chrome flags with `--window-size=390,844` and a mobile user agent, e.g.
`--user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"`,
plus `--screenshot=%CD%\mobile.png` to get the layout. To keep the page alive until the screenshot,
serve it with `tools\holdsrv.py 8766 30` and add `<img src="/hold" style="display:none">` to a test copy
of the page: `/hold` answers after 30 s, which delays the load event. Virtual-time budgets do not advance
the fake camera — do not use them.

## 3. Camera-refused run

Add `--deny-permission-prompts` (and drop the two fake-media flags) to see the "The camera did not start"
card. The card must stay on screen after the models finish loading, and the header must stay clickable.

## 4. Real checks that only a person can do

Face, hands and body on a real camera; the Flip button and the orientation change on a phone; the
Snapshot button on iOS. Ask the owner; he tests live and sends screenshots.

## 5. Character and rig guides

Use the same server and Chrome command with `/tools/avatar-harness.html`. Expect `AVATAR_DONE`
and no `AVATAR_ERROR`; `window.avatarTest` contains the done/checks/error result. The GLB adds
17.81 MiB on first selection and is cached in IndexedDB. Skeleton mode must not download it.

Inspect `avatar-legacy.png`, `avatar-character.png`, `avatar-character-side.png`. Run
`/tools/avatar-harness.html?phone` with the phone UA for the 390 px iframe checks and
`avatar-mobile-character.png`. Original harness now has visible synthetic feet; with the three
rig-proportioned spine guides its expected visible object count becomes 129 (previously 116).

Checks: original face/body/hands, visible spine guides, 2D overlay unchanged across display modes,
101 bones, finite skinned vertices, limb/foot direction agreement, arm/finger response, head/hands
without hips, mirror, missing detections, reset and switch back. Phone checks retain single view,
contain video, closed expressions and no horizontal overflow.

In a restricted Windows sandbox, a fresh isolated headless Chrome profile may require
`--no-sandbox --disable-gpu-sandbox`. A fake capture-service failure is separate from synthetic
render/retarget tests and must be reported. Do not treat phone-sized headless tests as a real phone
performance benchmark. Face and eye deformation is deliberately not implemented in this version.

## 6. Feature harnesses (eyes, on-camera mode, phone)

Three more pages cover the later features: `py tools\check.py --harness eyes` (or `overlay`, `phone`)
runs one; `--all` runs them after the two main harnesses. By hand: the warm profile
(`%TEMP%\mirror-puppet-check-profile`), a server on another port, e.g. `py tools\testsrv.py 8771`, and the
Chrome command from section 1 with `http://127.0.0.1:8771/tools/<name>.html`; stop Chrome when
`HARNESS DONE` prints (timeout 150 s):

- `eyes-harness.html` — eyeballs built on the eye bones, gaze right / up / straight (landmark path,
  `res.blend` is nulled on purpose), head close-up renders `eyes.png` / `eyes-near.png` / `eyes-only.png`.
  Expect `eyes in the mesh: L found … R found …`, yaw ±0.60 (negative when the view is mirrored), pitch 0.40.
- `overlay-harness.html` — On camera: the 3D canvas moves into the picture, regions keep 12 frames after a
  part is lost, Guides toggle, switching back to Skeleton.
- `phone-harness.html` — detector ready in the worker (`worker true`), two agreeing passes needed, weak and
  wide boxes ignored, fixed-size phone upright in the hand with its back to the viewer, renders
  `phone-*.png` and `phone-alone.png` (lights are hidden in that last render, so it is dark on purpose).

All three set a 1280×720 synthetic size when the fake camera's first frame is 2×2.

- `threads-harness.html` (`--harness threads`, also in `--all`) — recognition in worker threads: the automatic
  engine picks three threads on this machine, results flow (fps > 0 on the fake camera), the Performance panel
  has a row per thread, the Threads menu rebuilds the engine (off → main thread, 1 → one thread, auto → three).
  It runs ~40 s (it waits for steady-state numbers).
- `diag-harness.html` (`--harness diag`, not in `--all`) — asserts nothing: one line every half second with the
  engine, the camera track, the frame loop and the threads, plus every media event of the `<video>` and every
  assignment of its `srcObject` with a stack. Use it with `--fresh` to see a cold start (shader compilation).
  Found with it on 2026-09-12: under headless SwiftShader a cold start of three GPU threads compiled shaders
  for ~7 s and the fake camera's track **ended** meanwhile — hence the warm-up inside each thread before
  "ready" and the automatic restart of an ended camera track in camera.js.
