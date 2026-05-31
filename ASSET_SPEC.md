# Asset Spec — Unit Sprites

The contract between the **art track** and the **dev track** (Claude Code). Both sides
build to this so they don't block each other: Claude Code builds Milestone 1 with
placeholder sprites that obey this spec, and real art drops in later with **no rework**.

If anything here needs to change, change it *here first*, then both tracks follow.

---

## 1. Frame size & facing
- **Frame size (working target): 32 × 32 px**, consistent across **every** unit. (Pick one
  number and never mix — atlases and collision assume uniform frames.)
- If a source pack is higher-resolution (e.g. Tiny Swords), either **downscale to 32×32**
  on import to keep the horde light, or raise the target — but then *all* units use the
  new size. The only hard rule is **consistency**.
- **Draw/face RIGHT** (toward the enemy from the player's side). The engine mirrors with
  `flipX` for the opposing side, so you only ever make **one facing**.

## 2. Animation states
Every unit type must provide these four states. Frame counts are guidance, not law —
keep them modest (hundreds of units are animating at once).

| State    | Frames | ~FPS | Loop | Notes |
|----------|--------|------|------|-------|
| `idle`   | 2–4    | 6    | yes  | Resting / waiting to advance |
| `walk`   | 4–8    | 10   | yes  | Marching down the lane |
| `attack` | 3–6    | 10–12| no   | Include one clear "impact" frame |
| `death`  | 3–6    | 8    | no   | Plays once, then the sprite is recycled |

(Optional later: `hurt` flinch. Not needed for Milestone 1.)

## 3. Naming
- Animation tags / keys are **lowercase, exactly**: `idle`, `walk`, `attack`, `death`.
- These names are the API between art and code — code calls `sprite.play('walk')`, so the
  tags must match character-for-character.

## 4. Origin / anchor
- **Origin = bottom-centre**, i.e. `setOrigin(0.5, 1)`. Units plant their feet on the lane
  line. Draw each frame so the feet sit at the bottom-centre of the 32×32 cell, or the
  army will look like it's floating / sinking.

## 5. Export format (preferred pipeline)
**Aseprite → Export Sprite Sheet:**
- Output a **PNG sheet + JSON** (Array or Hash).
- Enable **"Meta: Tags"** so the `idle/walk/attack/death` tags are written into the JSON.
- Trim/​tight-pack is fine; keep transparent padding minimal.

Phaser ingests this almost directly:
```ts
// load
this.load.aseprite('melee', 'assets/units/melee/melee.png', 'assets/units/melee/melee.json');
// create animations from the tags
this.anims.createFromAseprite('melee');
// use
sprite.play('walk');
```
**Alternatives** (also fine, just tell the dev track which): TexturePacker with its Phaser 3
exporter (PNG + JSON), or a plain **horizontal strip PNG** where every frame is exactly
32×32 and the rows are documented (loaded via `load.spritesheet`).

## 6. Faction colour = tint (make ONE set, not two)
- Produce a **single, fairly neutral / light** art set per unit. The engine applies an
  **azure tint** for the player and a **crimson tint** for the enemy.
- Tinting **multiplies** colour, so light/desaturated base art tints cleanly; near-black
  pixels won't take tint (good for outlines you want to stay dark). Avoid baking strong
  blue or red into the source art.

## 7. Files & locations in the repo
```
public/assets/units/<unit>/<unit>.png
public/assets/units/<unit>/<unit>.json
```
- Lowercase, no spaces. Example: `public/assets/units/melee/melee.png` + `melee.json`.
- One atlas per unit type to start; can be combined into a master atlas later without
  changing the contract.
- Include a `LICENSE.txt` (or note in the README) for any third-party pack, with required
  attribution.

## 8. Performance guardrails (art side)
- Keep total atlas dimensions sensible (**≤ 2048×2048**, ideally far smaller). Trim padding.
- Modest frame counts per state — every extra frame is memory and a bigger atlas.
- All of a unit's frames in **one** sheet so the GPU batches draws.

## 9. Placeholder contract (for Claude Code, until real art lands)
Until a real sheet exists, generate placeholder sprites that obey this spec **exactly**:
same 32×32 frame size, the same four tag names, bottom-centre origin, right-facing,
tint-ready. That way swapping a placeholder for a real `melee.png`/`.json` is a drop-in
file change — no code edits to movement, combat, or animation wiring.

## 10. "Aligned" checklist (per unit)
- [ ] All four states present: `idle`, `walk`, `attack`, `death`, named exactly.
- [ ] Uniform frame size matching the project target; faces right.
- [ ] Feet at bottom-centre of each frame (origin 0.5, 1).
- [ ] Exported as PNG + JSON with tags; loads via the agreed Phaser call.
- [ ] Neutral/light base art that takes the azure/crimson tint cleanly.
- [ ] Lives at `public/assets/units/<unit>/` with licence noted.

## First deliverable
One **melee** unit with `idle` / `walk` / `attack` / `death`, to this spec. That's all the
art Milestone 1 needs — one type, both armies via tint.
