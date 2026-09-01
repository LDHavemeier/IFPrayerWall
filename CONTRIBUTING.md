# Contributing

Thanks for helping build this out. It's a small static app — no build step, no package manager
required — so the loop is short.

## Getting set up

```bash
git clone <this-repo>
cd <this-repo>
python3 -m http.server 8080   # or: npx serve .
```

Open `http://localhost:8080`. To test install/offline behavior on your phone, use your computer's
LAN IP instead of `localhost` while both devices are on the same Wi-Fi.

## Before you open a PR

- **Bump `CACHE_NAME` in `sw.js`** if you touched `index.html`, `css/styles.css`, `js/app.js`,
  `manifest.webmanifest`, or anything in `icons/` — otherwise phones with the app already
  installed will keep serving the old cached version.
- **Check both data paths.** Most logic runs through the same `DB` interface whether it's the
  real Claude.ai store or the local mock — but if you touch `js/app.js`'s data calls, sanity
  check them against both `createLocalMockDb()` (this repo, standalone) and, if you have access,
  the Claude.ai artifact version.
- **Keep it framework-free** unless a PR is specifically about introducing one — the whole point
  right now is that anyone can open `js/app.js` and read it top to bottom.
- **Match the brand tokens** at the top of `css/styles.css` (`--if-blue`, `--gold`, etc.) rather
  than hardcoding new colors.
- Test on an actual phone (or your browser's device emulation) before requesting review — this
  is a mobile-first app and desktop-only testing misses real bugs.

## Branch / PR conventions

- Branch names: `feature/short-description` or `fix/short-description`.
- Keep PRs scoped to one thing — a backend adapter and a UI tweak should be two PRs.
- Describe **what changed and why**, and call out anything a reviewer should manually test on a
  phone (install flow, offline behavior, a new sheet/modal, etc.).
- If your change touches the [Roadmap](README.md#roadmap) items, check the box in the same PR.

## Reporting bugs / ideas

Open an issue with what you expected vs. what happened, and which device/browser you were on.
For feature ideas that touch real member data (auth, the shared backend), please flag them for
discussion before building — privacy matters a lot for this project.
