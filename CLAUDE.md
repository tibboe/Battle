# CLAUDE.md

Context and working agreement for Claude Code on this project. Read this before doing
anything.

## What this is
A 2D auto-battler lane-pusher with roguelite meta-progression (working title:
Lanebreaker). Full design is in `GAME_DESIGN.md`. **You are not building the whole
design.** You are building one milestone at a time. Milestone 1 (Horde Core) is
**complete**. Milestone 2 (tiered elevation) was **parked** — the Tiny Swords pack can't
do broad stairs, so the battlefield is staying a **single flat lane** (a grass island on
open water). The current milestone is defined in `MILESTONE_3.md` (Armies & Production) —
that file is the source of truth for scope right now.

## Roles
- The human is the **creative director**: they decide how it should feel, play it, and
  give feedback.
- You are the **builder**: you scaffold, write, and run the code, and explain choices in
  plain language.

## Tech stack (do not swap without asking)
- **Phaser 4** + **TypeScript** + **Vite**
- Output is a browser game, later wrapped as an Android PWA. Keep everything web-first.

## Project setup
If the repo is not yet scaffolded, scaffold from the **official** Phaser template — do
not hand-roll the Vite config:

```bash
npx degit phaserjs/template-vite-ts .
npm install
```

(The official "Create Phaser Game" CLI — `npm create @phaserjs/game@latest` — is an
equivalent alternative; either is fine.) The template includes a `log.js` telemetry
script that pings the Phaser team's server with the template name and Phaser version. It
collects no personal data, but if the director prefers no telemetry, delete `log.js` and
its reference in `package.json` — note this to them rather than deciding silently.

### Setup decisions made (initial session)
- **Phaser 4.** The official template now ships Phaser 4.0.0 (not 3). Director chose to
  keep it; docs above updated to say Phaser 4.
- **Telemetry removed.** `log.js` was deleted and the `dev`/`build` scripts no longer
  reference it, so neither phones home.
- **LAN host enabled.** `vite/config.dev.mjs` sets `server.host = true` so `npm run dev`
  is reachable from the director's phone over wifi.

## Commands
- `npm run dev` — dev server with hot reload (template defaults to port 8080).
- `npm run dev -- --host` — same, but exposed on the local network. Needed so the
  director can open the game on their **Android phone** over wifi. If the template's vite
  config overrides this, set `host: true` in the dev config.
- `npm run build` — production build into `/dist`.

## How the director tests
Primary loop: they open the LAN URL in Chrome on their Android phone while `dev --host`
is running, and watch changes live. So: **keep the build runnable at all times**, and
keep the layout sane on the phone screen in the chosen orientation (Milestone 1 — Horde
Core uses **landscape** with a horizontal lane). Don't leave the project in a broken
state at the end of a session.

## Working agreement
- **One milestone at a time.** Build exactly what the current milestone file specifies.
  Do not start on later-milestone features (extra unit types, upgrades, meta-progression,
  multiple lanes) until told to. If you finish early, polish and stabilise what exists.
- **Keep it playable after every session.** Each session should end with something the
  director can run and try.
- **Ask before adding dependencies or new systems.** Prefer Phaser built-ins and plain
  TypeScript over new libraries.
- **Make game data editable.** Unit stats, spawn rates, base HP, etc. live in a small
  config file/object, not scattered as magic numbers — later milestones will extend it.
- **Favour clear over clever.** This is a fun side project; readable code the director can
  reason about beats abstraction.
- **Explain as you go.** When you make a design or structural choice, say why in one or
  two sentences.
- Commit at the end of each milestone (or meaningful chunk) with a short message.

## Pointers
- `GAME_DESIGN.md` — vision, unit system, full roadmap.
- `MILESTONE_3.md` — what to build right now (Armies & Production), with acceptance criteria.
- `MILESTONE_2.md` — PARKED (tiered elevation); kept for reference, not being built.
- `MILESTONE_1.md` — completed (Horde Core); kept for reference.
- `ASSET_SPEC.md` — sprite contract (frame size, tags, origin, export format). Placeholder
  art must obey it so real art drops in with no code changes.
