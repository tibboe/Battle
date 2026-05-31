# Milestone 1 — Horde Core

**Goal:** prove the *hard* part works before building any game systems on top — **hundreds
of animated pixel-art units** clashing in a lane, with a **camera you can zoom and pan**,
running smoothly on the phone. If scale, camera, and the animation pipeline hold up here,
everything after is comparatively easy. If they don't, we want to know now.

> **Assumptions (override either with one word):**
> - **Orientation: landscape** (phone held sideways, horizontal lane). Matches the concept
>   mockup and suits a wide horde battlefield. Switching to portrait + vertical lane is a
>   layout change, not an architecture one.
> - **Art: start from a ready-made pixel pack** (e.g. *Tiny Swords*) rather than custom art.
>   Respect the pack's licence (attribution / commercial terms) and note it in the repo.

This is the only thing to build right now. Do **not** implement later-milestone features:
no ranged/magic types, no rock-paper-scissors triangle, no upgrades or meta-progression,
no multiple lanes, no building-selection UI, no sound.

---

## Architecture requirements (do these from day one — they can't be retrofitted)
The whole point of this milestone is the engine, so these are not optional:

- **Data-oriented units.** A unit is a plain data record (position, hp, state, target,
  animation frame) held in arrays — *not* a heavyweight class instance with its own update
  loop. Hundreds of rich objects will not hold framerate; hundreds of data records will.
- **Sprite pooling.** Maintain a fixed pool of reusable sprite objects. Acquire one when a
  unit appears, release it on death. **Never create or destroy game objects mid-battle.**
- **Single texture atlas.** All unit frames live in one atlas so the GPU batches them into
  a few draw calls. Use Phaser's atlas + animation config to define idle / walk / attack
  (and death) animations.
- **Faction by tint, not duplicate art.** The same art set serves both sides — apply an
  azure tint for the player, crimson for the enemy. One atlas, two armies.
- **No per-unit physics bodies.** Movement is position maths along the lane. For combat
  targeting, exploit the lane: bucket/sort units by lane position and only test nearby
  neighbours. **Never** do all-pairs (O(n²)) checks across the whole army.
- **Stagger heavy work.** Re-acquire targets every few frames rather than every frame if
  needed; spread non-critical updates across the frame budget.
- **Always-visible dev readout.** Show a live **unit count + FPS** on screen so any
  performance regression is obvious immediately.

## Camera
- Phaser main camera on a **world larger than the viewport**, with `setBounds`, `setZoom`,
  and scrolling.
- **Pinch-to-zoom** and **drag-to-pan** on the phone (mouse wheel + drag on desktop).
- A control / gesture that **frames the whole battlefield** ("fit to map").

## Gameplay (kept minimal on purpose)
- One lane, a **player keep** (left) and **enemy keep** (right), each with HP.
- Each side auto-spawns **one melee unit type** on a timer, ramping up to **hundreds active
  at once**.
- Units advance down the lane, engage the nearest enemy in range, attack on a cooldown
  (play the attack animation), and die at 0 HP (play death, then release to the pool).
- A unit reaching the opposing keep damages it. First keep to 0 HP loses → WIN / LOSE.
- A restart resets to a fresh battle.

## Build order
1. **Scaffold** from the official Phaser + TS + Vite template (see CLAUDE.md); confirm
   `npm run dev` and `npm run dev -- --host` work and it's reachable on the phone.
2. **Camera first:** set up the oversized world, bounds, zoom, pan, and fit-to-map against
   a static backdrop.
3. **One unit animating:** load the atlas, get a single unit walking with its animation.
4. **Pooled unit manager:** make units data-driven and pooled; spawn a large batch and
   confirm **hundreds animate at a smooth framerate** (watch the FPS/count readout).
5. **Movement + combat:** lane advance, neighbour-based targeting, attack/death animations,
   pool release on death.
6. **Keeps + end state:** keep HP, keep damage on arrival, WIN/LOSE, restart.
7. **Faction tint** for the two sides.

## Tunables (in config)
`unitsTarget` (e.g. 300+), `spawnInterval`, `moveSpeed`, `unit.hp`, `unit.damage`,
`unit.attackInterval`, `unit.range`, `keep.hp`, camera zoom min/max.

## Acceptance criteria
- [ ] **Hundreds of units** (target: 300+ on screen) active and animating at a smooth
      framerate on the director's Android phone.
- [ ] **Pinch-zoom and drag-pan** work on the phone; a control frames the whole map.
- [ ] Units walk, engage the nearest enemy, and play **idle / walk / attack** animations;
      they die (death anim) and are **recycled via the pool**.
- [ ] Both keeps have HP; reaching 0 triggers a clear **WIN or LOSE**; restart works.
- [ ] The two sides are visually distinct via **tint of the same art** (one atlas).
- [ ] **No per-unit physics body; no per-frame object creation;** no all-pairs combat loop.
- [ ] On-screen **unit count + FPS** readout present.
- [ ] All key numbers live in **config**, not scattered as magic numbers.
- [ ] Layout readable on the phone in the chosen orientation.

## Done means
The director can open it on their phone, pinch out to watch **hundreds of pixel soldiers**
from both sides pour down the lane and clash with attack animations, zoom in on the
fighting, and see a keep fall — then restart. That proves **scale, camera, and animation
all work together**, and only then do we build unit variety, meta-progression, and multiple
lanes on top.
