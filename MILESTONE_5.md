# Milestone 5 — Siege & Base Assault (sacking buildings)

**Goal:** replace the abstract "reach the keep, chip its HP, vanish" model with a concrete
**siege** loop — units batter a building's **door**, breach it, **pour inside** to sack it,
and the building goes **out of commission** (not destroyed) until **repaired**. Buildings get
an **armour type** so hitting the structure directly does little; the door is the way in.
Sacking enemy **production** buildings (not just the keep) is the strategic core: cripple
their output, defend yours.

> **Why this shape:** today the climax is a fast trickle of units disappearing into a single
> keep HP bar. A door→breach→sack→repair loop makes the endgame a deliberate siege, makes
> **defence** a real axis (hold the gate), and turns the production buildings from scenery
> into targets worth attacking and protecting. (Director's design — discussed this session.)

This is a **later** milestone (after M4 — Economy); **not started** until the director says go.

## Explicitly NOT in this milestone
A gold economy, multiple lanes, real damaged/destroyed art (we synthesise it — see Art note),
and any unit-vs-unit changes beyond new targeting.

## The model being replaced (where it lives today)
- `scenes/GameScene.ts` holds one HP pool per side (`playerKeepHp`/`enemyKeepHp`,
  `CONFIG.keep.hp`). Units that reach the opposing keep's x-line call `onReachKeep`
  (`CONFIG.keep.damagePerUnit`) and despawn. First keep to 0 = win/lose.
- `structures/buildings.ts` draws production + general + Castle buildings as **static sprites
  with no HP**.
- `units/UnitManager.ts` only ever targets the nearest enemy **unit**; never a structure.

## The sack loop (per attackable building)
Two-stage integrity:
1. **Door HP** — a weak point on the lane-facing side. Units path to the door and attack it.
   The structure body has high `armour`, so attacking anything but the door is near-useless.
2. **Breached** — at door HP 0 the door opens; attackers that reach the doorway **enter**
   (despawn into the building) and drain its **internal integrity**.
3. **Out of commission** — at integrity 0 the building stops working (a sacked Barracks makes
   no units; a sacked Castle = that side loses). It is **not** removed from the map.
4. **Repair** — restores the door + integrity and returns it to service.

## Build order (each phase stays runnable)
### Phase 1 — The keep gets a real gate
Replace the Castle's chip-HP model with **door HP + internal integrity**. Units attack the
(drawn) door; on breach they enter and drain integrity; integrity 0 = that side loses. Same
win/lose *meaning*, concrete *mechanism*. Synthesised door / breached / sacked visuals.

### Phase 2 — Production buildings are sackable
Give each production building an armour type, door HP and integrity. Sacking one takes it
**out of commission** (its producer pauses). New targeting rule: when no enemy units are
nearby, a unit picks the nearest enemy building's door, walks to it, attacks, enters on
breach. Defenders fighting at the gate now matter.

### Phase 3 — Repair
A sacked/damaged building can be repaired: **tap-to-repair**, and/or the **Pawn** (worker)
walks over and repairs over time — gives the worker a real job and makes defending active.
Restores door + integrity; cannot complete while the building is actively being breached.

### Phase 4 — Defence feel + balance
Tune the siege: door/integrity values, building armour, per-unit siege damage, repair rate,
and re-balance production caps/rates for the slower, defence-aware endgame. Optional: a
"defend/rally" stance so some units hold home.

## Data / config (extend CONFIG, M3-style)
- `buildingDefence` per building (keep + each producer): `{ armour, doorHp, integrity,
  doorOffset }`, with a building-armour row/col added to (or beside) `combat.matrix`.
- Per-unit **siege damage** vs structures, distinct from anti-unit damage — or a global rule
  "units deal ×N to a door, ≈0 to the body".
- `repair: { rate, mode }` (`'tap' | 'pawn' | 'both'`).
- Win condition: sack the enemy Castle (config flag for castle-only vs all-buildings).

## Open decisions to pin (before/while building)
- **v1 scope:** keep-only first (Phase 1), then production (Phase 2) — handled by phasing.
- Are attackers **consumed** when they enter, or do they spill back out when it's sacked?
- Is the **door** itself armoured (slow, dramatic breach) or soft?
- **Repair:** tap, Pawn-driven, or both? (No cost — no economy yet.)
- Does the **general/upgrade** building, when sacked, suspend its upgrades?
- Edge cases: building sacked mid-production (drop the queued unit?); repairing while
  breached; units "inside" when it flips out-of-commission.

## Art note (no pack art for this)
Tiny Swords ships **no** damaged/destroyed/door sprites — only the 8 plain building PNGs.
Synthesise, as we already do for unit death (freeze + fade) and the old drawn keeps: a drawn
**door** rectangle on the lane-facing side; **breached** = door open/gone; **out of
commission** = darken/desaturate + smoke (simple particle/overlay) + maybe a downed banner;
**repairing** = scaffold tint / progress bar. Keep all of this behind the building module so
real art can replace it later with no logic change.

## Acceptance
- Units batter a building's door, breach it, and sack it; the building goes **out of
  commission** (visibly), not destroyed, and stops working.
- Direct hits on the structure body do little; the **door** is the way in.
- A sacked building can be **repaired** and returns to service.
- Sacking the enemy **Castle** wins; losing yours loses.
- Still smooth with the full horde; one flat lane; playable at every phase.

---
*Sequenced after M4 (Economy). Sacking ties into the economy — repairs likely cost
resources, and a sacked production building stops both units and any income it feeds.
Source of truth when this milestone starts.*
