# CLAUDE.md

Context and working agreement for Claude Code on this project. Read this before doing
anything.

## What this is
A 2D auto-battler lane-pusher with roguelite meta-progression (working title:
Lanebreaker). Full design is in `GAME_DESIGN.md`. **You are not building the whole
design.** You are building one milestone at a time. Milestone 1 (Horde Core) is
**complete**. Milestone 2 (tiered elevation) was **parked** — the Tiny Swords pack can't
do broad stairs, so the battlefield is staying a **single flat lane** (a grass island on
open water). Milestone 3 (Armies & Production) is **complete** — five unit types with a
weapon×armour counter matrix, buildings that produce units on a 3×3 grid, and tap-a-building
upgrades/abilities. Milestone 4 (Economy — peasants, resources, building/upgrade costs) is
**complete**: peasants gather gold/stone/wood from finite nodes, everything costs resources,
the player allocates workers per resource and buys per-unit / Castle / peasant upgrades, and
the enemy runs its own gathering economy. A polish pass on top added a unified bottom
**selection HUD** (tap a building/slot → its options), a top HUD (resource + worker readouts,
Castle health bars, a 🛠 Dev toggle that hides the tuning/inspector tools), and combat-feel
work (unit flow, arcing/sticking arrows, swing-pause-swing pacing with idle poses, per-unit
health bars). The next milestone, **`MILESTONE_5.md` (Siege & Base Assault — door→breach→sack→
repair, sackable production buildings)**, is specced but **not started** — don't build it until
told.

**Since M4 (built on the `claude/nice-cori-bfiSA` branch — the current playable state):**
- **Player skills** — a left-edge skill dock with cooldowns: **Arrow Volley** (rain arrows on a
  point) and **Mercenaries** (hire archers at a tapped point for gold). Generic targeting
  (arm a skill → tap the field). `abilities/Abilities.ts`, `ui/SkillBar.ts`.
- **Unit command & control** — select your units by type from the right roster (or All) and
  issue **Move / Attack-move / Hold / Free / Auto** orders with **formations** (square/rect/line,
  tight/loose, ordered knight→lancer→archer→monk, facing the enemy). Orders are a per-type
  *standing order* so reinforcements inherit them. Units face their travel/attack direction,
  idle when stationary, and flow **around buildings**. `ui/CommandBar.ts`, `units/commands.ts`.
- **Food economy** — a 4th resource (**food**, gathered from renewable sheep). Producers train
  units one at a time, each costing food, with a per-building **cooldown bar**, an enable/disable
  toggle, and a "need food" prompt. **Peasants start idle**; you assign them via a **FIFO focus
  queue** on the merged resource HUD (each resource chip shows stockpile + worker count, tap to
  enqueue). Per-building **unit caps**.
- **Garrison defenders + elevation** — a paid per-building upgrade posts **archer defenders on
  the roof** (range ×2, pinned). General per-unit **elevation level**: melee can only hit
  same-level targets, ranged can hit any level (foundation for future terrain tiers).
- **Pre-game Setup screen** — tweak the defaults before a match (shared tunables with the Dev
  panel via `controls/tunables.ts`); remembered in `localStorage`.
- **Match stats → SQLite** — every match POSTs a detailed summary to a small **Node server**
  (`server/index.mjs`, built-in `node:sqlite`) that also serves the build and a **`/stats`
  dashboard**. See DEPLOY.md.
- **Screen rotation** — a left-edge **↺/↻ dock** (`ui/RotationHud.ts`) turns the whole battlefield
  90° per tap with a smooth tween (`CameraController.rotateBy`). Only the **terrain** turns (it lives
  on its own `terrainLayer`); every standing asset — units, buildings, trees, plus health bars,
  floating damage text and building bars — is **billboarded upright** each frame and its
  above-the-head offsets kept screen-relative (`controls/billboard.ts`: `uprightAngle` /
  `screenOffset` / `rotatesWithCamera`, applied by `GameScene.billboardWorld`). Unit & peasant
  **facing** (flipX from world-facing × cos θ), arrow **lob arcs**, and the **Arrow Volley**'s
  "from the sky" launch are all computed in **screen space** so they read correctly at any angle.
  The world is now **square (4000×4000, lane recentred to y=2000)** so you can zoom out the same
  amount turned or not — the "Map size" dev tunable keeps width == height. Panning has **inertia**
  (a released drag glides to a stop). Tunables live in `CONFIG.camera` (`rotateMs`/`rotateEase`,
  `panGlideDecay`/`panGlideMinPx`). Known limits: at exactly 90°/270° side-view sprites can't point
  up/down (flipX is horizontal-only), and buildings keep their fixed left/right art orientation.

> Heads-up for a fresh session: the current work lives on the **`claude/nice-cori-bfiSA`** branch
> (PR open against `main`). Deployment changed from a static file server to the **Node server in
> `server/index.mjs`** (serves `/dist` + the stats API); on Railway it needs a **volume mounted at
> `/data`** so the SQLite match stats persist across redeploys (see `DEPLOY.md`). Settings persist
> in `localStorage` under key `lanebreaker.settings.v2`.

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
- `MILESTONE_5.md` — NEXT milestone (Siege & Base Assault / sacking buildings); specced, not started.
- `MILESTONE_4.md` — completed (Economy: peasants, finite resources, build/upgrade costs, peasant allocation + upgrades, enemy economy).
- `MILESTONE_3.md` — completed (Armies & Production: units, counters, buildings, upgrades).
- `MILESTONE_2.md` — PARKED (tiered elevation); kept for reference, not being built.
- `MILESTONE_1.md` — completed (Horde Core); kept for reference.
- `ASSET_SPEC.md` — sprite contract (frame size, tags, origin, export format). Placeholder
  art must obey it so real art drops in with no code changes.
- `DEPLOY.md` — how the build is served (Dockerfile → Railway) for phone testing.
