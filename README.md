# Indianola First — Prayer Wall

A congregation-only prayer wall PWA for Indianola First. Share a need, choose who it's routed
to, pray for one another in real time, and celebrate answered prayer as a praise report.

This repo is a **mobile-testing build** of the prototype originally built as a Claude artifact.
It's structured as a normal static PWA so it can be installed on a phone, reviewed, and iterated
on through pull requests.

## ⚠️ Read this before you demo it

This build's data layer is **local-device storage only** (see "How data works" below). That's
enough to click through every feature on one phone, but it is **not yet a shared, multi-person
prayer wall** — two people testing on two phones will each see their own separate copy of the
data. Turning this into a real shared app for the congregation needs a backend (Firebase,
Supabase, or similar) — see [Roadmap](#roadmap).

## Features

- **Routing** — prayers go to a chosen team (Pastoral & Staff, Wednesday Night, Congregation-Wide,
  or any custom team an admin adds), with admin control over which teams exist and whether
  they're currently accepting requests.
- **Engagement** — a one-tap "I'm praying" commitment with a live count, threaded updates on
  each need, and journey-tracking through Just shared → In process → Answered.
- **Praise reports** — every answered prayer gets a testimony and a permanent home in the Praise
  tab, with a "carried for N days" note and a celebrate reaction.
- **Check-ins** — needs that go quiet for a few days (admin-configurable) surface a gentle
  "how's this going?" prompt to the requester, and a soft nudge to team members.
- **Urgent needs** — flagged instantly to the whole congregation (no approval gate — speed
  matters more than moderation here), with an admin review queue afterward.
- **Ministry notes** — sync sermon/small-group notes in from a leader's own connected Granola
  account (only functional inside the Claude.ai artifact runtime — see [Roadmap](#roadmap)).
- **Installable PWA** — real `manifest.webmanifest` + service worker, home-screen icons, and a
  "Present for Sunday" full-screen QR code + install screen for handing out during service.

## How data works

`js/app.js` talks to a small `DB` interface (`doc()`, `collection()`, `get()`, `set()`,
`onSnapshot()`, …). Two implementations exist today:

1. **`window.claude.use('db')`** — the real, shared, realtime store Claude.ai provides when this
   app runs as a Claude artifact. This is what makes the wall multi-person there.
2. **`createLocalMockDb()`** (in `js/app.js`) — a localStorage-backed fallback used automatically
   whenever `window.claude` isn't present, which is *always true* on a plain GitHub Pages /
   phone-browser deployment. It implements the same interface so the whole UI works, just
   single-device.

The app picks whichever is available at boot — no config needed — so this repo runs standalone
for UI/UX testing today, and the real backend is a drop-in replacement later (see Roadmap).

The same applies to **Granola sync** (`js/app.js`, `openGranolaSyncSheet`): it calls
`window.claude.use('mcp')`, which only exists inside the Claude.ai runtime. Outside it, the
button shows a clear "Granola isn't connected for this view" message instead of breaking.

## Local development

No build step — it's static HTML/CSS/JS. A service worker requires `http(s)://` or
`localhost`, so don't just double-click `index.html`; serve it:

```bash
# any static server works, e.g.:
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080` on your laptop, or on your phone via your computer's LAN IP
(same Wi-Fi network) to test "Add to Home Screen" for real.

**Testing tip:** if you change `css/styles.css`, `js/app.js`, or any cached file, bump
`CACHE_NAME` in `sw.js` (e.g. `v1` → `v2`) so the service worker doesn't keep serving the old
version to phones that already installed it.

## Deploying (GitHub Pages)

`.github/workflows/pages-deploy.yml` deploys the repo root to GitHub Pages automatically on every
push to `main`. To turn it on:

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Source**, choose **GitHub Actions**.
3. Push to `main` (or re-run the workflow) — the site publishes at
   `https://<your-org>.github.io/<repo-name>/`.

Once it's live, the "Present for Sunday" screen (**Me → 📣 Sunday install screen**) generates a
QR code pointing at whatever URL the app is actually running on — no code change needed when the
Pages URL is set.

## Project structure

```
index.html                 shell: head/meta/manifest links, mounts js/app.js
manifest.webmanifest        PWA install metadata
sw.js                        service worker — app-shell caching only, no prayer data
css/styles.css               all styling (brand tokens as CSS variables at the top)
js/app.js                    the whole app: state, rendering, DB access, event handling
icons/                       generated from the brand mark (cross + flame), all PWA sizes
.github/workflows/           CI: GitHub Pages auto-deploy on push to main
```

`js/app.js` is one file by design for now (it's still small enough to read top-to-bottom) — see
Roadmap for splitting it up as features grow.

## Admin access (testing)

The first person to sign in on a fresh install becomes admin automatically. After that, entering
the staff passcode `IF-STAFF-26` at sign-in also grants admin. **Change this passcode**
(`ADMIN_PASSCODE` near the top of `js/app.js`) before this is used with anyone outside your
testing group — it's a placeholder, not real auth.

## Roadmap

Good first PRs, roughly in priority order:

- [ ] **Real shared backend.** Replace `createLocalMockDb()`'s role with a Firebase/Supabase
      adapter behind the same `DB` interface, so the wall is actually shared across members
      outside the Claude.ai runtime. This is the big one — everything else is UI on top of it.
- [ ] **Real authentication.** Sign-in today is a name/email form with no verification, and the
      admin passcode is a shared secret in client code. Needs real auth (magic link email, or
      your provider of choice) before any real member data touches it.
- [ ] **Push notifications** for check-ins and urgent needs when the app isn't open — needs Web
      Push + a small server component; the in-app check-in prompts are today's stand-in.
- [ ] **Granola sync outside Claude.ai** — a real Granola OAuth + API integration so "Sync from
      Granola" works from this standalone build too, not only inside a Claude artifact.
- [ ] Split `js/app.js` into modules as it grows (state / views / db-adapter / sheets).
- [ ] Accessibility pass (focus trapping in sheets, ARIA roles, screen-reader labels).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Brand

Built from Indianola First's official brand guidelines (v3.0, Sept 2023) — "Heartland Blue"
`#022E40`, off-white `#F0F1F2`, and the secondary palette for status colors. Headings use Oswald
as a free stand-in for Mission Gothic; body text uses Manrope as a stand-in for Forma DJR Micro.
