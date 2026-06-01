# Milestone 3 — Armies & Production (unit types, counters, buildings, upgrades)

**Goal:** turn the single-unit brawl into an army of distinct unit types that **counter each
other** via a weapon-vs-armour model, **produced by buildings** that sit by each keep, with
**player-tapped upgrades**. Still one flat lane, left↔right. Elevation stays parked.

> **Why this shape:** the Tiny Swords pack gives us five unit types and matching buildings.
> Warrior/Lancer are melee, Archer is ranged (has an `Arrow`), Monk is a **healer** (no
> attack anim), Pawn is a cheap worker/melee. Buildings (Barracks/Archery/Monastery/…)
> naturally map to "this building emits this unit." Counters are **systemic** (weapon type ×
> armour type), not hand-wired per pair, so the director can rebalance by editing one matrix.

This is the only thing to build right now. **Not** in this milestone: a gold economy /
manual unit deployment, procedural maps, meta-progression between runs, sound, elevation.

---

## The roster (all five, data-driven)

| Unit    | Role            | Attack        | Weapon type | Armour type | Source building |
|---------|-----------------|---------------|-------------|-------------|-----------------|
| Pawn    | cheap swarm     | melee (knife) | Light       | Unarmored   | House           |
| Warrior | frontline       | melee (sword) | Blade       | Heavy       | Barracks        |
| Lancer  | anti-armour     | melee, long   | Pierce      | Medium      | Barracks (t2)   |
| Archer  | ranged DPS      | ranged (arrow)| Pierce      | Light       | Archery         |
| Monk    | support (heal)  | heals allies  | —           | Light       | Monastery       |

Stats (hp, damage, range, attack rate, move speed, scale) live per-type in a `unitTypes`
table in config — the current Warrior numbers seed the first entry.

## Counters — weapon × armour matrix (starting point; director tunes by playing)

Damage dealt = `base × matrix[weapon][targetArmour]`.

|          | Unarmored | Light | Medium | Heavy |
|----------|-----------|-------|--------|-------|
| **Blade**  | 1.0 | 1.5 | 1.0 | 0.75 |
| **Pierce** | 1.0 | 0.75| 1.0 | 1.5  |
| **Blunt**  | 1.5 | 1.0 | 1.0 | 0.75 |

(Monk deals no damage — it heals nearby friendly units for a flat amount on a timer.)

## Build order (each step stays runnable)

### Phase 1 — Data-driven units
1. Extract a `unitTypes` table (stats + art set + weapon/armour type). Port today's Warrior
   as the first entry; the game runs identically, just table-driven.
2. Load each type's idle/run/attack(or shoot/heal) strips; `UnitManager` stores a `type`
   per unit and plays that type's animations. Mixed-type spawning works.

### Phase 2 — Counters + ranged + heal
3. Add the weapon×armour matrix; strikes scale by it. Spatial targeting stays bucketed.
4. Archer ranged attack: longer engage range + an `Arrow` projectile (or instant bolt) on
   the shoot beat. Lancer gets a longer melee reach (spear).
5. Monk support: periodically heals the lowest-HP friendly unit in range (capped at max HP).

### Phase 3 — Production buildings
6. Replace the drawn placeholder keeps with the pack's building art. **Castle** = the keep
   (the HP target). A small fixed cluster of production buildings sits beside each keep;
   each emits its unit type on a timer (Barracks→Warrior/Lancer, Archery→Archer, Monastery
   →Monk, House→Pawn). Spawning moves from "the keep" to "each building."

### Phase 4 — Upgrades
7. Tap a building to upgrade it (a level counter): faster spawn cadence and/or a stat bump
   for the units it makes. Minimal UI (tap target + level readout); this is the player's
   decision hook. Keep it data-driven so tiers are easy to tune.

## Data / config (extend, don't scatter)
- `unitTypes: { key, art, hp, damage, range, attackInterval, moveSpeed, scale,
  weapon, armour, role }[]`.
- `combat.matrix: Record<Weapon, Record<Armour, number>>` — the counter table.
- `buildings: { type, produces, spawnInterval, offset, upgrade }[]` per side, placed
  relative to each keep.
- Keep HP stays a single pool per side.

## Acceptance
- Multiple unit types spawn from their buildings on both sides and fight; an arrow is
  visibly fired by Archers; Monks visibly heal.
- The counter matrix demonstrably changes outcomes (e.g. Pierce shreds Heavy).
- Tapping a building upgrades it and its output changes.
- Still smooth with the full horde (watch the FPS/count readout); one flat lane; build
  playable at every step.
