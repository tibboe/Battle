// All tunable game numbers live here so later milestones extend this one object
// instead of hunting magic numbers through the code. Edit values, not logic.

// Counter-matrix axes. A unit's weapon type is checked against its target's armour type
// to scale damage — the matrix itself and its application arrive in Phase 2. Monk has no
// weapon ('None') because it never attacks.
export type Weapon = 'Blade' | 'Pierce' | 'Blunt' | 'Light' | 'None';
export type Armour = 'Unarmored' | 'Light' | 'Medium' | 'Heavy';
// Behaviour class: melee/ranged fight; support never attacks (the Monk heals in Phase 2).
export type UnitRole = 'melee' | 'ranged' | 'support';

// The three gatherable resources (Milestone 4 economy). Peasants harvest these from nodes
// and bank them; later phases spend them on buildings and upgrades.
export type ResourceType = 'gold' | 'stone' | 'wood';

// A resource price (Milestone 4). Spent from a side's stockpile to build or upgrade.
export interface Cost {
    gold: number;
    stone: number;
    wood: number;
}

// One entry in the build catalog (Milestone 4 Phase 2) — what a peasant can hammer up on an
// empty grid slot. `produces` is the unit key it emits on a timer, or null for a House (which
// makes peasants instead). `cost` deducts on purchase; `buildTime` is the hammering duration
// once a builder reaches the slot.
export interface BuildingDef {
    key: string;
    produces: string | null;
    art: string;
    scale: number;
    every: number;     // spawn cadence (ms); 0 for a House
    cost: Cost;
    buildTime: number; // ms of hammering to finish
}

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

    // The combat roster — four fighting Tiny Swords types, data-driven. UnitManager reads
    // these rather than hard-coded numbers; the production buildings decide which type
    // spawns and when. (The Pawn used to live here as a cheap melee swarm; Milestone 4 turns
    // it into the worker/peasant — see CONFIG.peasant — so it is no longer a combat unit.)
    // The Warrior row reproduces the Milestone-1 numbers EXACTLY (hp 30 = 3 hits to kill;
    // range ~= one body width so the front line meets edge-to-edge). The rest are sensible
    // starting points to tune by playing. Weapon×armour counters, the Archer's arrow, and
    // the Monk's heal are all live (see combat.matrix and the Archer/Monk rows).
    unitTypes: [
        { key: 'warrior', art: 'warrior', role: 'melee', ability: 'block',
          hp: 30, damage: 10, range: 64, attackInterval: 600, moveSpeed: 70,
          weapon: 'Blade', armour: 'Heavy', scale: 0.8, footAnchor: 0.8 },
        { key: 'lancer', art: 'lancer', role: 'melee', ability: 'knockback',
          hp: 46, damage: 14, range: 96, attackInterval: 750, moveSpeed: 66,
          weapon: 'Pierce', armour: 'Medium', scale: 0.92, footAnchor: 0.66 },
        { key: 'archer', art: 'archer', role: 'ranged', ability: 'longshot',
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
        // Units advance on the nearest enemy within this radius (px), steering toward it in
        // BOTH x and y until they are within strike range — so melee actually reach offset
        // foes instead of marching straight past them. Ranged units already engage at their
        // (longer) range, so this only changes how the short-range melee close the gap.
        aggroRange: 220,
        // Global multiplier on every unit's time-between-strikes (the per-type attackInterval
        // is the base; this scales them together). >1 = slower attacks. Live Dev knob.
        attackIntervalScale: 1.5,
        // Global multiplier on every unit's max HP (both sides). 2 = double health. Applies to
        // units spawned from now on when edited live. Live Dev knob.
        hpScale: 2,
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
        strength: 70, // px/sec; max nudge applied per unit per frame (higher = fans out faster)
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
        // Global spawn cadence: EVERY production building emits its unit this many seconds
        // apart (Dev "Spawn secs"). One uniform knob replaced the old per-building rates so
        // pacing is easy to reason about. (Each catalog entry still carries an `every`, but it
        // is no longer what drives spawning — the cadence is global.)
        spawnSeconds: 10,
        // (The shared Armour/Melee/Ranged upgrades — the 'general' set — are opened by tapping
        // your Castle; there is no separate upgrades building.)

        // Build catalog (Phase 2): what a peasant can construct on an empty grid slot. A
        // House produces peasants (produces:null); the rest emit their combat unit every
        // `every` ms. `cost` is deducted on purchase; `buildTime` is how long a builder
        // hammers. Tune costs/times freely — they are the player's economic decisions.
        // `every` is retained on each entry (interface field) but no longer drives spawning —
        // cadence is the global `spawnSeconds` above. Left uniform here to avoid implying a
        // per-building rate.
        catalog: [
            { key: 'house',     produces: null,     art: 'House1',    scale: 1.0, every: 0,     cost: { gold: 0,  stone: 20, wood: 60 }, buildTime: 5000 },
            { key: 'barracks',  produces: 'warrior', art: 'Barracks',  scale: 0.9, every: 10000, cost: { gold: 60, stone: 40, wood: 40 }, buildTime: 6000 },
            { key: 'tower',     produces: 'lancer',  art: 'Tower',     scale: 0.9, every: 10000, cost: { gold: 80, stone: 60, wood: 20 }, buildTime: 6000 },
            { key: 'archery',   produces: 'archer',  art: 'Archery',   scale: 0.9, every: 10000, cost: { gold: 50, stone: 10, wood: 70 }, buildTime: 6000 },
            { key: 'monastery', produces: 'monk',    art: 'Monastery', scale: 0.8, every: 10000, cost: { gold: 90, stone: 30, wood: 40 }, buildTime: 7000 },
        ] as BuildingDef[],

        // Pre-built at match start (free, instant), per side. BOTH sides start lean and build
        // up from gathered income (Phase 4): the player gets one House (they pick + build their
        // first producer); the enemy gets TWO Houses — a bigger gathering base to offset the
        // player's upgrade + spawn-cap edge — and follows a scripted build order (enemyAI).
        // Spots reference the 3×3 grid (see `grid`).
        start: {
            player: [
                { key: 'house', spot: 1 },
            ],
            enemy: [
                { key: 'house', spot: 1 },
                { key: 'house', spot: 7 },
            ],
        } as Record<'player' | 'enemy', { key: string; spot: number }[]>,
    },

    // Enemy build AI (Phase 4): the "hybrid" economy the director picked — enemy peasants
    // gather for real (and are harassable), while its building choices are scripted here. Every
    // `decideEvery` ms it tries to build the next item in `buildOrder` on a free slot, saving up
    // until it can afford each (it never skips). Tune the order / cadence to harden the enemy.
    enemyAI: {
        decideEvery: 800,
        buildOrder: ['barracks', 'archery', 'tower', 'monastery', 'barracks'],
    },

    // ── Economy (Milestone 4) ───────────────────────────────────────────────────────────
    // Per-side resource stockpiles. Peasants gather gold/stone/wood from nodes and bank them
    // at the Castle; later phases spend them on buildings and upgrades. Per-match only (not
    // persisted) — `start` is the opening balance each side begins with.
    resources: {
        // Suggested opening balance (director to refine): enough to build one combat
        // producer immediately so you pick your first unit, but not two at once.
        start: { gold: 100, stone: 60, wood: 80 },
    },

    // Peasant (worker) tunables. Workers spawn from Houses, walk to the nearest node of their
    // assigned resource, harvest a load over `gatherTime`, carry it back to the Castle, bank
    // `carryAmount`, and repeat. They never fight (pure economy). All times in ms, speeds in
    // px/sec, distances in px. `scale`/`footAnchor` match the old Pawn so the art sits right.
    peasant: {
        perHouse: 3,        // workers a House keeps alive (trains replacements up to this)
        moveSpeed: 80,      // px/sec while walking (empty or laden)
        scale: 0.7,
        footAnchor: 0.8,
        gatherTime: 1600,   // ms harvesting at a node to fill one load
        carryAmount: 10,    // resource banked per completed round trip
        bankTime: 250,      // ms pause at the Castle to deposit
        trainTime: 3500,    // ms a House takes to train a replacement when below perHouse
        arrive: 48,         // px proximity that counts as "reached" a node
        bankArrive: 120,    // px proximity to the Castle that counts as "at the bank"
        // Harassment (Phase 4): peasants are workers, not fighters — but they can be cut down.
        // When an enemy combat unit comes within `dangerRadius`, a peasant drops its task,
        // flees toward its Castle, and bleeds `harassDps` HP/sec; at 0 HP it dies and its House
        // trains a replacement. So pushing your army into a gathering line starves that side.
        hp: 26,
        dangerRadius: 110,  // px; an enemy combat unit this close threatens the peasant
        harassDps: 14,      // HP/sec drained while threatened (≈2s to kill if cornered)
        deathFadeMs: 350,   // synthesised death fade (the pack has no worker death anim)
    },

    // Resource nodes on the island. Each: `type`, world x/y, and `finite` (deplete + vanish
    // when drained of `finiteAmount`, else inexhaustible). Safe nodes sit in each base's back
    // corner, off the lane path; the richer CONTESTED set sits mid-field where the armies
    // clash. Phase-1 peasants gather the nearer safe nodes; the mid nodes are placed now
    // (visible, fought over later). `scale` sizes each node's art by type.
    nodes: {
        scale: { gold: 0.55, stone: 0.95, wood: 0.85 },
        finiteAmount: 600, // every node now holds this and depletes (Milestone 4 tuning)
        // ALL nodes are finite now, so concentrating workers on one resource drains it and you
        // must spread out / push for the contested centre. Each base gets a CLUSTER of three of
        // each resource (in its back corners, off the lane) so it doesn't starve too fast.
        list: [
            // ---- Player base (left): gold up-back, stone down-back, wood down-front ----
            { type: 'gold',  x: 700,  y: 560,  finite: true },
            { type: 'gold',  x: 840,  y: 540,  finite: true },
            { type: 'gold',  x: 600,  y: 650,  finite: true },
            { type: 'stone', x: 560,  y: 1300, finite: true },
            { type: 'stone', x: 700,  y: 1360, finite: true },
            { type: 'stone', x: 520,  y: 1180, finite: true },
            { type: 'wood',  x: 1040, y: 1300, finite: true },
            { type: 'wood',  x: 1140, y: 1220, finite: true },
            { type: 'wood',  x: 940,  y: 1380, finite: true },
            // ---- Enemy base (right): mirrored ----
            { type: 'gold',  x: 3300, y: 560,  finite: true },
            { type: 'gold',  x: 3160, y: 540,  finite: true },
            { type: 'gold',  x: 3400, y: 650,  finite: true },
            { type: 'stone', x: 3440, y: 1300, finite: true },
            { type: 'stone', x: 3300, y: 1360, finite: true },
            { type: 'stone', x: 3480, y: 1180, finite: true },
            { type: 'wood',  x: 2960, y: 1300, finite: true },
            { type: 'wood',  x: 2860, y: 1220, finite: true },
            { type: 'wood',  x: 3060, y: 1380, finite: true },
            // ---- Contested mid-field (reward holding the centre) ----
            { type: 'gold',  x: 1820, y: 600,  finite: true },
            { type: 'stone', x: 2180, y: 600,  finite: true },
            { type: 'wood',  x: 2000, y: 1320, finite: true },
        ] as { type: ResourceType; x: number; y: number; finite: boolean }[],
    },

    // Upgrades — player-only stat boosts, bought once from a building (Milestone 4 Phase 3
    // makes them cost resources). These are the EFFECT magnitudes; which upgrades are owned
    // lives in upgrades.ts; the prices are in `upgradeCosts` below.
    upgrades: {
        warriorHp: 15,     // + max HP for your Warriors
        archerRange: 120,  // + engage range for your Archers
        armour: 0.8,       // your units take ×this incoming damage (lower = tougher)
        melee: 4,          // + damage for your melee units
        ranged: 4,         // + damage for your ranged units
        peasantSpeed: 28,  // + move speed (px/s) for your peasants
        peasantCarry: 5,   // + resource carried per trip by your peasants
    },

    // Price of each upgrade (Phase 3), keyed by the upgrade key in upgrades.ts. Buying deducts
    // the player's stockpile; unaffordable upgrades are greyed out. Bought once per match.
    // (Director to refine — these sit a notch above building costs since the buff is permanent.)
    upgradeCosts: {
        warriorHp:   { gold: 40, stone: 40, wood: 20 },
        archerRange: { gold: 50, stone: 10, wood: 40 },
        lancerCrit:  { gold: 70, stone: 30, wood: 10 },
        monkAoe:     { gold: 60, stone: 20, wood: 30 },
        armour:      { gold: 80, stone: 60, wood: 20 },
        melee:       { gold: 70, stone: 40, wood: 30 },
        ranged:      { gold: 70, stone: 20, wood: 50 },
        peasantSpeed: { gold: 30, stone: 20, wood: 40 },
        peasantCarry: { gold: 40, stone: 30, wood: 30 },
        peasantFlee:  { gold: 50, stone: 20, wood: 30 },
    } as Record<string, Cost>,

    // Unit special abilities (Phase 4). The default abilities are innate to BOTH sides; the
    // upgrades that gate some of them are player-only (see upgrades.ts).
    abilities: {
        knockback: { distance: 110, cooldown: 5000 }, // Lancer shoves its target back, on a cd
        crit: { chance: 0.25, mult: 2 },              // Lancer upgrade: chance to deal ×mult damage
        block: { chance: 0.2 },                       // Warrior: chance to fully negate a hit it takes
        // Archer: every `cooldown` ms lob an arc arrow at a far enemy (base range + bonus,
        // beyond normal reach). It only damages an enemy within `hitRadius` of where it
        // lands; `spread` is the aim scatter (bigger = more misses); `speed` the lob travel.
        longshot: { bonusRange: 2000, cooldown: 3000, spread: 55, hitRadius: 36, speed: 1300 },
        // Peasant flee-burst upgrade: while fleeing a nearby enemy, sprint at ×mult for
        // `duration` ms, then `cooldown` ms before it can burst again.
        peasantFlee: { mult: 1.9, duration: 1500, cooldown: 6000 },
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
