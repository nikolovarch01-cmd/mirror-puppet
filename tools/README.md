# Verification without a camera (Windows, headless Chrome)

All commands from the repo root. Python 3 (`py`) and Google Chrome are needed. Nothing here touches the
user's screen.

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
