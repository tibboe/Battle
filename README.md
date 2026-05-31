# Lanebreaker *(working title — rename freely)*

A 2D auto-battler lane-pusher with roguelite meta-progression. Your base auto-spawns
units that march down a path and clash with the enemy's units coming the other way.
Win by grinding through to the enemy base; lose runs, bank points, buy permanent
upgrades, run again.

Built as a browser game so it can be developed and tested instantly, then installed
on Android as a PWA.

## Tech stack
- **Phaser 4** (game framework)
- **TypeScript**
- **Vite** (dev server + bundler)
- Target: mobile web / Android PWA

## Quick start
This repo is scaffolded from the official Phaser + TS + Vite template. If the project
hasn't been scaffolded yet, that's the first step of Milestone 1 (see below).

```bash
npm install
npm run dev          # local dev server
npm run dev -- --host  # expose on your LAN to test on your phone
npm run build        # production build into /dist
```

## Where to look
- **CLAUDE.md** — context + working agreement for Claude Code. Read this first.
- **GAME_DESIGN.md** — the full vision, unit system, and roadmap.
- **MILESTONE_1.md** — the only thing we're building right now. Start here.
- **ASSET_SPEC.md** — the sprite contract shared by the art and dev tracks.

## Current milestone
**Milestone 1** — one lane, one unit type, bases that can win or lose. Nothing else yet.
