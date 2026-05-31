# Game Design — Lanebreaker *(working title)*

## Pitch
You command a base that automatically produces units. They march down a lane toward the
enemy base. The enemy does the same from the other side. Units collide in the middle and
fight. Push through to the enemy base and destroy it to win the encounter. You take on
one base at a time. Die, bank points, buy permanent upgrades, and run again — getting a
little further each time.

## Genre & references
Auto-battler / lane-pusher with roguelite meta-progression. Touchstones: Art of War:
Legions (auto-resolving clashes), classic "march your army down a lane" web games, and
the run-and-upgrade loop of roguelites like Vampire Survivors. The director will pull
feel references from these.

## Design pillars
1. **Readable at a glance.** On a phone screen you should instantly see who's winning a
   clash. Unit roles must be distinguishable by shape/colour before any art exists.
2. **Satisfying clashes.** The moment two waves meet is the core fun. It should feel
   weighty even with placeholder rectangles.
3. **Meaningful meta-progression.** Each run should make the next one feel different, not
   just numerically bigger.

## Core loop
1. Start an encounter against one enemy base.
2. Your buildings spawn units on a timer; units auto-walk the lane toward the enemy.
3. Opposing units meet and fight; survivors continue.
4. Units reaching a base damage it. First base to 0 HP loses.
5. On loss (or clear), earn points → spend on permanent upgrades → next run.

## Unit system
Three roles, with a rock-paper-scissors triangle (starting proposal — **tunable**, treat
as data not gospel):

- **Melee** — short range, tough, cheap/frequent. Beats **Magic** (closes distance and
  shuts down casters).
- **Ranged** — attacks from a distance, fragile. Beats **Melee** (chips them down before
  contact).
- **Magic** — area or burst damage, slow/expensive. Beats **Ranged** (clears clustered,
  squishy archers).

Each unit is defined by data: `hp`, `damage`, `attackInterval`, `range`, `moveSpeed`,
`spawnInterval` (or cost), and `role`. Keep all of this in one config so balance is a
matter of editing numbers.

## Buildings & base
- Each side has a **base** with HP.
- Buildings are **spawners** tied to a unit type, producing on a timer. Early on, one
  spawner per side; later the director may choose which buildings to run.

## Combat resolution
Keep it simple and emergent: units have HP, deal `damage` every `attackInterval` to the
nearest enemy in `range`. No complex targeting AI to start — nearest-in-front is enough.
The RPS triangle is expressed through stats and damage multipliers, not special-case code.

## Roguelite meta-progression
- A **run** is a sequence of encounters (one base at a time, harder each step).
- Losing/clearing awards **points** based on progress.
- Between runs, a simple shop spends points on **permanent upgrades** (e.g. +base HP,
  faster spawns, unlock a unit type, cheaper magic). Upgrades persist across runs.

## Roadmap (build in this order — see milestone files for detail)
1. **Milestone 1 — Core loop.** One lane, one melee unit type, two bases, win/lose,
   restart. Proves the clash is fun. *(This is the current target.)*
2. **Milestone 2 — Unit variety.** Add ranged and magic units + the RPS triangle.
3. **Milestone 3 — Roguelite meta.** Points, a between-runs upgrade shop, persistent
   upgrades, a multi-encounter run.
4. **Milestone 4 — Multiple paths.** More than one lane, plus building/spawner choices.

## Explicitly out of scope (for now)
Multiplayer, online features, real art/animation, audio, accounts, monetisation, app-store
publishing. Placeholder shapes are fine until the mechanics are proven fun.
