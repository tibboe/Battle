// All tunable game numbers live here so later milestones extend this one object
// instead of hunting magic numbers through the code. Edit values, not logic.

// Counter-matrix axes. A unit's weapon type is checked against its target's armour type
// to scale damage — the matrix itself and its application arrive in Phase 2. Monk has no
// weapon ('None') because it never attacks.
export type Weapon = 'Blade' | 'Pierce' | 'Blunt' | 'Light' | 'None';
export type Armour = 'Unarmored' | 'Light' | 'Medium' | 'Heavy';
// Behaviour class: melee/ranged fight; support never attacks (the Monk heals in Phase 2).
export type UnitRole = 'melee' | 'ranged' | 'support';

// One row of the unit roster. Stats are the director's to tune; `art` names the sprite
// set wired in units/animations.ts (which also owns the SOURCE frame size, since that is
// fixed by the art, not a gameplay knob).
export interface UnitType {
    key: string;
    art: string;
    role: UnitRole;
    hp: number;
    damage: number;
    range: number;          // centre-to-centre engage distance (px)
    attackInterval: number; // ms between strikes
    moveSpeed: number;      // px/sec along the lane
    weapon: Weapon;
    armour: Armour;
    scale: number;          // display scale applied to the source frame
    footAnchor: number;     // origin.y — where the feet sit in the frame (feet on the lane)
    // Innate special ability: 'knockback' | 'longshot' | 'block' (upgrades may extend it).
    ability?: string;
    // Support healers only: top up the lowest-HP ally within `range` by `amount` every
    // `interval` ms (capped at the ally's max HP). Combat units omit this.
    heal?: { amount: number; interval: number };
}

export const CONFIG = {
    // The battlefield is much larger than the phone viewport; the camera shows a
    // slice of it and can zoom out to frame the whole thing. Aspect (~2.1:1) is close
    // to a landscape phone so "fit to width" fills the screen with little letterboxing.
    world: {
        width: 4000,
        height: 1900,
    },

    // ONE flat horizontal lane the armies march along (left↔right). `y` is the lane centre.
    // `thickness` is the OUTER band — the max vertical spread / hard clamp, wide enough to
    // hold the buildings' spawn heights. `pathWidth` is the TIGHT path units funnel into as
    // they march (the "Lane width" knob); `funnelSpeed` is how fast (px/s) they drift to it.
    lanes: [
        { y: 950, thickness: 700, pathWidth: 200, funnelSpeed: 70 },
    ],

    // The battlefield is a flat grass ISLAND on open water. `margin` = px of water framing
    // the grass on every side (snapped to the tile grid by the renderer). The island fills
    // the rest; keeps + the lane sit inside it.
    island: { margin: 320 },

    // Scatter decoration counts. `land` rocks/bushes dot the field; `sea` water-rocks/duck
    // float around the island. `forest` trees/stumps/bushes fill the grass ABOVE and BELOW
    // the lane (random x/y for an organic, varied-depth wood), split by band height.
    // `laneClear` is the half-height of the kept-clear path corridor — trees may crowd up
    // to its edge but not onto the path. Raise `forest` for a denser wood.
    decorations: { land: 18, sea: 28, forest: 46, laneClear: 170 },

    // Drifting clouds over the sea, along the TOP/LEFT/RIGHT edges only. `count` is the
    // top-band cloud count; the side bands use roughly half that each.
    clouds: { count: 10 },

    // Keeps sit at each end of the lane. Player on the left, enemy on the right. The keep
    // is drawn as the pack's Castle (the HP target); units that reach the opposing keep's
    // centre damage it.
    keep: {
        hp: 500,
        damagePerUnit: 25, // damage each unit that reaches the opposing keep deals
        margin: 520,       // distance from the world edge to the keep's centre (on the island)
        size: 320,
        art: 'Castle',     // pack building drawn as the keep
        scale: 0.85,       // display scale for the castle sprite (sized to fit the grid)
    },

    // The unit roster — all five Tiny Swords types, data-driven. UnitManager reads these
    // rather than hard-coded numbers; the production buildings decide which type spawns and
    // when. The Warrior row reproduces the Milestone-1 numbers EXACTLY (hp 30 = 3 hits to
    // kill; range ~= one body width so the front line meets edge-to-edge). The rest are
    // sensible starting points to tune by playing. Weapon×armour counters, the Archer's
    // arrow, and the Monk's heal are all live (see combat.matrix and the Archer/Monk rows).
    unitTypes: [
        { key: 'warrior', art: 'warrior', role: 'melee', ability: 'block',
          hp: 30, damage: 10, range: 64, attackInterval: 600, moveSpeed: 70,
          weapon: 'Blade', armour: 'Heavy', scale: 0.8, footAnchor: 0.8 },
        { key: 'pawn', art: 'pawn', role: 'melee',
          hp: 20, damage: 6, range: 60, attackInterval: 500, moveSpeed: 82,
          weapon: 'Light', armour: 'Unarmored', scale: 0.72, footAnchor: 0.8 },
        { key: 'lancer', art: 'lancer', role: 'melee', ability: 'knockback',
          hp: 46, damage: 14, range: 96, attackInterval: 750, moveSpeed: 66,
          weapon: 'Pierce', armour: 'Medium', scale: 0.62, footAnchor: 0.61 },
        { key: 'archer', art: 'archer', role: 'ranged',
          hp: 18, damage: 8, range: 240, attackInterval: 750, moveSpeed: 76,
          weapon: 'Pierce', armour: 'Light', scale: 0.8, footAnchor: 0.8 },
        { key: 'monk', art: 'monk', role: 'support',
          hp: 24, damage: 0, range: 200, attackInterval: 0, moveSpeed: 72,
          weapon: 'None', armour: 'Light', scale: 0.8, footAnchor: 0.8,
          heal: { amount: 6, interval: 1200 } },
    ] as UnitType[],

    // Terrain drawn from the real Tiny Swords tileset. The index→piece map lives in
    // terrain/tileset.ts; swap the loaded variant there (Tilemap_color1..5) to recolour.
    terrain: {
        renderTile: 64, // px each 64px source tile is drawn at in the world (1:1)
    },

    // Combat tuning.
    combat: {
        reacquireMs: 100, // how often units re-pick a target (not every frame)
        deathFadeMs: 400, // synthesised death fade-out (the pack has no death animation)
        // Counter matrix: a strike's final damage = base × matrix[weapon][targetArmour],
        // rounded. Starting values from MILESTONE_3 (tune by playing). The doc's table left
        // out a row for the Pawn's 'Light' weapon — added here; 'Blunt' is kept ready for a
        // future unit. The Monk ('None') never attacks, so it needs no row.
        matrix: {
            Blade:  { Unarmored: 1.0,  Light: 1.5,  Medium: 1.0,  Heavy: 0.75 },
            Pierce: { Unarmored: 1.0,  Light: 0.75, Medium: 1.0,  Heavy: 1.5  },
            Blunt:  { Unarmored: 1.5,  Light: 1.0,  Medium: 1.0,  Heavy: 0.75 },
            Light:  { Unarmored: 1.25, Light: 1.0,  Medium: 0.75, Heavy: 0.5  },
        } as Partial<Record<Weapon, Record<Armour, number>>>,
    },

    // Debug / visibility aids, toggled live from the Dev panel. Not gameplay.
    debug: {
        damageNumbers: true, // float the damage dealt above the unit that was hit
    },

    // Soft separation: units nudge away from any neighbour (friend or foe) closer than
    // `radius`, so the horde stays a loose organic mass instead of a hard pile. Capped per
    // frame so it never jitters. Raise strength for more spread; raise radius for bigger gaps.
    separation: {
        radius: 42,   // px; neighbours closer than this push apart
        strength: 50, // px/sec; max nudge applied per unit per frame
    },

    // Per-side soft cap on living units. This is a performance guard now — the buildings
    // below are the real spawn driver. The caps stay ASYMMETRIC on purpose so equal
    // production still resolves to a winner: the denser side breaks through (player edge ->
    // you tend to WIN). Kept small (~50 each) so the lane stays readable.
    spawn: {
        unitsTarget: { player: 55, enemy: 45 },
    },

    // Build grid: a 3×3 of spots beside each keep, numbered 1-9 left→right, top→bottom:
    //   1 2 3
    //   4 5 6
    //   7 8 9
    // The keep occupies `keepSpot` (4 = centre-left); production buildings sit on their
    // `spot`; the remaining spots are clear (drawn as faint "build" plinths) and double as
    // the gaps units march through. `cellW`/`cellH` set the spot spacing (tall buildings
    // overflow upward), `gap` the path between spots. The player's grid fans toward the lane
    // (right); the enemy's mirrors.
    grid: {
        cols: 3,
        rows: 3,
        cellW: 160,
        cellH: 160,
        gap: 80,
        keepSpot: 4,
    },

    // Production buildings — one per unit type, each on a grid `spot`. Emits its unit every
    // `every` ms (scaled live by the Dev panel's "Prod rate"). Units spawn at the building's
    // spot and funnel into the lane. `art` is the pack building file; `scale` sizes it. (The
    // Castle keep is drawn separately at keepSpot.)
    production: {
        rateScale: 1,
        // The shared-upgrades building — hosts Armour/Melee/Ranged; produces no units.
        general: { art: 'House2', spot: 9, scale: 1.0 },
        buildings: [
            { produces: 'pawn',    art: 'House1',    every: 1400, spot: 1, scale: 1.0 },
            { produces: 'warrior', art: 'Barracks',  every: 2200, spot: 2, scale: 0.9 },
            { produces: 'lancer',  art: 'Tower',     every: 3200, spot: 3, scale: 0.9 },
            { produces: 'archer',  art: 'Archery',   every: 2600, spot: 7, scale: 0.9 },
            { produces: 'monk',    art: 'Monastery', every: 4200, spot: 8, scale: 0.8 },
        ],
    },

    // Upgrades (Phase 4) — player-only, free to toggle from a building, one level each for
    // now. These are the EFFECT magnitudes; which upgrades are active lives in upgrades.ts.
    upgrades: {
        warriorHp: 15,     // + max HP for your Warriors
        archerRange: 120,  // + engage range for your Archers
        armour: 0.8,       // your units take ×this incoming damage (lower = tougher)
        melee: 4,          // + damage for your melee units
        ranged: 4,         // + damage for your ranged units
    },

    // Unit special abilities (Phase 4). The default abilities are innate to BOTH sides; the
    // upgrades that gate some of them are player-only (see upgrades.ts).
    abilities: {
        knockback: { distance: 110, cooldown: 5000 }, // Lancer shoves its target back, on a cd
        crit: { chance: 0.25, mult: 2 },              // Lancer upgrade: chance to deal ×mult damage
        block: { chance: 0.2 },                       // Warrior: chance to fully negate a hit it takes
    },

    // Camera limits. zoomMin must be small enough to fit the whole world on a phone.
    camera: {
        zoomMin: 0.1,
        zoomMax: 2.5,
        // On start, frame this much world HEIGHT around the lane. Smaller = more zoomed
        // in. Less than world.height so the world is taller than the screen and dragging
        // up/down pans; there is also map to either side for left/right panning.
        defaultViewHeight: 1100,
    },

    // The two armies use the pack's blue (player) and red (enemy) art sets directly.
    faction: {
        player: { tint: 0x4aa3ff }, // azure
        enemy: { tint: 0xff5a5a },  // crimson
    },

    // Palette for the drawn placeholder keeps + the out-of-world void.
    colors: {
        sky: 0x0e1620,       // outside-world / void
        trunk: 0x5a3d22,     // keep banner pole
        stone: 0x8a8a90,     // keep walls
        stoneDark: 0x6c6c72,
    },
};
// NB: not `as const` — the dev tuning panel (controls/DevPanel.ts) mutates a few of these
// live (spawn rate, army caps, map width, water edge, forest, clouds). CONFIG stays the
// single source of truth; the panel just edits the numbers, like editing this file.

export type GameConfig = typeof CONFIG;

// Derived layout helpers — FUNCTIONS (not constants) so they re-read CONFIG after the
// dev panel changes things on restart.

// Vertical centre of the lane — what the camera frames by default.
export const battlefieldCenterY = () => CONFIG.lanes[0].y;

// Top/bottom of the lane band (used to size the keeps that flank it).
export const laneTop = () => CONFIG.lanes[0].y - CONFIG.lanes[0].thickness / 2;
export const laneBottom = () => CONFIG.lanes[0].y + CONFIG.lanes[0].thickness / 2;
