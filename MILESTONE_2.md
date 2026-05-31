# Milestone 2 — Tiered Battlefield (terrain + stacked lanes)

**Goal:** turn the flat single lane into a **multi-level battlefield drawn from real terrain
art** — 2–3 horizontal lanes sitting at **different elevations** (grass plateaus with cliff
edges, joined by ramps), with combat that **rewards the high ground**. This proves the
terrain pipeline and the stacked-lane model on a hand-authored layout, so the *next*
milestone can make those layouts **procedural** and let units **cross between levels**.

> **What changed the design:** the unit art (Tiny Swords) is side-view, so facing stays
> **left/right** (see `GAME_DESIGN.md` → Art & movement constraints). "Elevation" this
> milestone means **layout + a combat bonus**, not units visibly walking up/down. Movement
> is still lane-based left↔right; the diagonal feel arrives in M3 with ramp crossings.

This is the only thing to build right now. Do **not** implement later-milestone features:
no ramp **crossing** / lane-switching, no **procedural** map generation, no ranged/magic
units or RPS triangle, no upgrades or meta-progression, no sound. (Those are M3+.)

---

## Scope this milestone (the split)
- **In:** real tileset terrain; 2–3 **static** stacked lanes at distinct elevations with
  cliff edges + ramp *visuals*; units spawn/march/fight across all lanes; a **high-ground
  combat rule** that bites at lane boundaries.
- **Deferred to M3:** units **crossing** between lanes via ramps (the diagonal movement),
  and **procedural** generation of the layout each run.

## Build order (each step stays runnable — keep the build playable)

### Phase A — Terrain from the tileset
1. **Map the tileset.** Inspect `environment/tiny-swords/Tileset/Tilemap_color*.png`
   (576×384) — confirm tile size (expected 64px) and catalogue which cells are
   grass-fill, grass edges/corners, and cliff faces. Record the index→piece mapping in
   one small data object (the tileset is autotile-style).
2. **Render a flat field from tiles**, replacing the procedural `drawBackdrop`. Prove the
   pipeline: a tiled grass ground built from real tiles, current single-lane gameplay
   running unchanged on top. *(Playable: same game, real art.)*
3. Keep the existing scenery/keeps working (port the trees/rocks to the pack's prop art
   where easy, or leave the drawn ones for now — art polish, not blocking).

### Phase B — Stacked lanes + high-ground rule
4. **Generalise lane → lanes[].** Replace the single `lane` config with an array of lane
   defs (screen `y`/elevation, `level` index, `thickness`). Spawning, movement, targeting
   and depth all read per-lane. Keep keeps as **one HP pool per side**, fed by every lane.
5. **Author a tiered layout (2–3 lanes)** at different elevations, drawn as grass plateaus
   with **cliff edges** between levels and **ramp visuals** at the ends near the keeps.
6. **Distribute spawns across lanes**; confirm the full horde fights on every lane at a
   smooth framerate (watch the FPS/count readout — same budget as M1).
7. **High-ground combat rule.** Lanes share cliff-edge boundaries: a front-line unit may
   engage an enemy in the **vertically adjacent lane** when within range across the edge,
   and the **uphill** unit gets a configurable bonus (e.g. `highGround.damageMult` or a
   flat `+range`). This is the only place elevation affects combat in M2, and it sets up
   M3 crossings. Keep targeting **neighbour-bucketed** — no all-pairs scan.

## Data / config (extend, don't scatter)
- `lanes: { y, level, thickness }[]` (replaces single `lane`).
- `terrain`: tileset key, tile size, the index→piece map, chosen colour variant.
- `elevation`: pixel height between levels (cliff height), ramp positions.
- `combat.highGround`: the uphill bonus + the cross-lane engage rule's reach.
- Per-side keep HP stays a single pool; spawn distribution across lanes is tunable.

## Acceptance criteria
- [ ] The battlefield ground is built from the **Tiny Swords tileset** (no procedural
      grass/dirt rectangles); it reads cleanly on the phone in landscape.
- [ ] **2–3 lanes at visibly different elevations**, with cliff edges between them and
      ramp visuals near the keeps.
- [ ] Units **spawn into and fight on every lane**; both sides feed one keep HP pool per
      side; reaching 0 still triggers WIN/LOSE; restart works.
- [ ] The **high-ground bonus** is observable: uphill units win edge skirmishes they'd
      otherwise lose, and the bonus is a single tunable in config.
- [ ] **Framerate holds** with the full horde spread across lanes (FPS/count readout
      present); **no per-unit physics, no per-frame object creation, no all-pairs combat**.
- [ ] All new numbers live in **config**; lanes are data, not hard-coded.

## Out of scope (explicitly M3+)
Ramp **crossing** / units switching lanes (the diagonal movement), **procedural** layout
generation, ranged/magic units, RPS triangle, height effects beyond the edge bonus,
meta-progression, sound.

## Done means
The director opens it on the phone and sees soldiers pouring down **several lanes stacked
at different heights on real grass-and-cliff terrain**, with fights along the cliff edges
where the **high-ground side has the advantage** — at the same smooth scale as M1. That
proves the **terrain pipeline + stacked-lane model + elevation combat**, leaving M3 to make
the layouts **procedural** and let armies **flow between levels**.
