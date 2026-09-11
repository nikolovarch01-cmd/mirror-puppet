# Starting prompt for the next agent (Codex)

Paste this as the first message, then add the actual task after it.

---

You are continuing the **Mirror Puppet** project (this repository). Before anything else, read
`HANDOFF.md` in full, then `tools/README.md`. They hold the architecture, the pinned versions, the
coordinate system, the verified facts and the traps; do not rediscover them by trial and error.

Rules that hold for every change:

1. `mirror-puppet.html` stays a single dependency-free file with the pinned CDN versions; no build step.
2. UI text is English. The owner reads Bulgarian and does not read code — report to him in short plain
   sentences, no code in the text.
3. On phones: one view at a time, never crop the camera picture, expression panel closed by default.
4. Verify without a camera first (`tools/README.md`, headless Chrome with the fake camera and the
   synthetic figure); then the owner tests live and sends screenshots. Say clearly what was verified
   and what was not.
5. Deploy = commit + `git push origin main` (GitHub Pages, ~1 minute). Never commit `cert.pem`/`key.pem`.
6. Helper buttons and toggles are welcome without asking. Anything that leaves the owner's machine
   (publishing elsewhere, accounts, sending) needs his explicit word.

Task:
