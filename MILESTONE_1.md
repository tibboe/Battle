# Milestone 1 — Core Loop

**Goal:** prove the core clash is fun with the absolute minimum. One lane, one unit type,
two bases, a win and a loss, and a restart. Nothing else.

This is the only thing to build right now. Do not implement anything from later
milestones (extra unit types, ranged/magic, upgrades, meta-progression, multiple lanes,
art, audio, menus beyond restart).

## Build it in this order
1. **Scaffold** the project from the official Phaser + TS + Vite template (see CLAUDE.md),
   install deps, confirm `npm run dev` shows the template running in the browser.
2. **Strip** the template down to a blank scene on a phone-portrait-friendly canvas.
3. **Bases:** place a player base on the left, an enemy base on the right, each with an
   HP value and a visible HP readout (text is fine).
4. **Spawner:** each side auto-spawns one melee unit every `spawnInterval` seconds.
5. **Movement:** units walk along the single horizontal lane toward the opposing base.
6. **Combat:** when a unit meets an enemy unit (within `range`), both stop and attack —
   dealing `damage` every `attackInterval`. A unit at 0 HP is removed; the survivor
   continues.
7. **Base damage & end state:** a unit reaching the opposing base deals damage to it. When
   a base hits 0 HP, show a simple WIN (enemy base destroyed) or LOSE (your base
   destroyed) state.
8. **Restart:** a button/tap to reset and play again.

## Data
Put all tunables in one config object/file so later milestones extend it:
```
base:  { hp }
unit:  { hp, damage, range, attackInterval, moveSpeed }
spawn: { spawnInterval }
```
Use placeholder visuals only — coloured rectangles or circles. Player vs enemy must be
visually distinct at a glance.

## Suggested structure (guideline, not a mandate)
- `scenes/` — Boot, Game, GameOver (or an in-scene overlay)
- `entities/` — `Unit`, `Base`, `Spawner`
- `config.ts` — the tunables above

## Acceptance criteria
- [ ] `npm run dev` and `npm run dev -- --host` both run; game is reachable on the
      director's Android phone over LAN.
- [ ] Both bases spawn melee units automatically on a timer.
- [ ] Units walk the lane and stop to fight when they meet an enemy.
- [ ] Units die at 0 HP; survivors move on.
- [ ] Units damage the enemy base on contact.
- [ ] Reaching 0 base HP triggers a clear WIN or LOSE state.
- [ ] A restart returns to a fresh game.
- [ ] All key numbers live in the config, not scattered as magic numbers.
- [ ] Layout is readable in portrait on a phone.

## Done means
The director can open it on their phone, watch two armies clash, and either win or lose —
then tap restart and go again. That's the whole milestone. Stop there and hand back for
feedback before touching Milestone 2.
