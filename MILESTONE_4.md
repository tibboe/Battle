# Milestone 4 — Economy (peasants, resources, costs)

**Goal:** turn the free, auto-running base into a player-driven **resource economy**.
**Peasants** spawned from **Houses** (max 3 per house) gather **gold, stone and wood** from
nodes and bank them; those resources **pay for buildings and upgrades**. Production and
upgrades stop being free — you out-gather to out-build.

> **Why this shape:** M3 made buildings and upgrades free and always-on. An economy gives the
> player real decisions — where to invest what they gather — and makes Houses/peasants matter
> beyond chip damage. (Director's design — discussed this session.)

This **repurposes two M3 things**: the **Pawn becomes the worker/peasant** (a gatherer, not a
combat swarm), and buildings shift from **pre-placed & free** to **built & paid-for** on the
grid's clear spots. Fighting stays the Warrior / Lancer / Archer / Monk job.

## Explicitly NOT in this milestone
Between-runs / meta progression (this economy is *in-match*), multiple lanes, siege/sacking
(that's M5), and brand-new art (we reuse the pack's worker + resource art — gaps noted below).

## The pieces
**Resources (per side):** `gold`, `stone`, `wood` stockpiles, shown in a HUD readout.

**Peasants (from Houses):**
- Each House maintains up to **3** peasants; if one is lost it trains another.
- Peasants are **workers, not fighters**: walk to a node, harvest over time, carry a load to
  a **drop-off**, bank it, repeat.
- Pack art covers this: the Pawn has `Interact Axe` (chop), `Pickaxe` (mine), `Hammer`
  (build/repair), and carry variants for Gold/Wood/Meat. (No **stone** carry art — reuse the
  gold carry or tint it; note the gap.)

**Resource nodes (on the island):**
- **Wood** = trees (we already scatter a forest — some become harvestable), chop with `Axe`.
- **Gold** = gold mine / gold rocks (`Resources/Gold`), mine with `Pickaxe`.
- **Stone** = rocks (`Decorations/Rocks`), mine with `Pickaxe`.
- Decide: finite (deplete + vanish) vs infinite; how many; placed near each base so gathering
  isn't suicide in the middle of the war.

**Costs:**
- Every building (House, Barracks, Archery, Tower, Monastery, general) and every upgrade gets
  a price in gold/stone/wood. Buying deducts the stockpile; unaffordable = greyed out.
- Buildings become **player-built**: start with a Castle + maybe one House; tap an empty grid
  spot → pick a building → pay → it constructs.

## Build order (each phase stays runnable)
### Phase 1 — Resources + peasants gathering
Add the three stockpiles + HUD. Houses spawn/maintain 3 peasants each. The Pawn switches from
combat to worker behaviour: path to a node, harvest, carry back, bank. Place nodes. Income
visible; nothing to spend on yet.

### Phase 2 — Pay to build
Empty grid spots become **build slots**: tap one → a menu of buildings with costs → pay →
construct on that spot (its producer/effect starts). Start a match with fewer buildings so
building is a real choice.

### Phase 3 — Pay to upgrade
Retrofit the M3 upgrade popup with **costs**: each upgrade shows its price, is only buyable if
affordable, and deducts on purchase. (M3's free toggles become paid.)

### Phase 4 — Enemy economy + balance
The enemy needs income too: a real AI economy (enemy peasants gather + build) or a scripted /
abstracted income that scales it. Balance starting resources, node yields, gather rates, and
every building/upgrade cost.

## Data / config (extend CONFIG, M3-style)
- `resources: { gold, stone, wood }` — starting stockpile per side.
- `peasant: { perHouse: 3, gatherRate, carryAmount, ... }` — Pawn-worker tunables.
- `nodes` — type, yield, finite/infinite, placement (or generated near each base).
- `cost: { gold, stone, wood }` on each `production.buildings` / `production.general` entry
  and each `upgrades` entry.
- Stockpiles are per-match (probably NOT persisted; `settings.ts` stays for tuning only).

## Open decisions to pin
- Peasants **purely economic** (never fight) or weak self-defence? (Lean: pure workers.)
- Drop-off: the House, the Castle, or nearest — and do peasants must-return-to-bank, or is
  income passive-per-peasant?
- **Nodes:** finite vs infinite, count, placement (safe-near-base vs contested).
- **Enemy economy** — real AI gathering/building vs scripted income. Biggest open question;
  drives how fair/readable the match feels.
- Build model: instant on pay, or a build timer (a peasant with the Hammer)?
- Does training a peasant cost anything? Starting buildings / starting resources?
- Mesh with M5 siege: a sacked production building stops its income; repairs cost resources.

## Art note
Good coverage from the pack: the Pawn worker set (chop / mine / build + gold/wood carry) and
resource art (gold, trees, rocks, sheep). Gaps: **stone carry** (reuse gold carry), and a
building "under construction" state (synthesise — scaffold tint / progress bar, like our
other hand-made states).

## Acceptance
- Peasants spawn from Houses (≤3 each), gather gold/stone/wood, and bank them; stockpiles show
  in the HUD.
- Buildings and upgrades **cost** resources and can't be bought without them.
- You can build a new building on an empty grid spot by paying for it.
- The enemy has a working economy too; a match is winnable and loseable.
- Still smooth with the full horde; one flat lane; playable at every phase.

---
*Realigned roadmap: M3 Armies & Production (done) → **M4 Economy** → M5 Siege → M6 Multiple
paths. Source of truth when this milestone starts.*
