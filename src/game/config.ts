// All tunable game numbers live here so later milestones extend this one object
// instead of hunting magic numbers through the code. Edit values, not logic.

export const CONFIG = {
    // The battlefield is much larger than the phone viewport; the camera shows a
    // slice of it and can zoom out to frame the whole thing. Aspect (~2.1:1) is close
    // to a landscape phone so "fit to width" fills the screen with little letterboxing.
    world: {
        width: 4000,
        height: 1900,
    },

    // Milestone 2: the battlefield is STACKED into several horizontal lanes at
    // different elevations. Each lane is a grass plateau the armies march along
    // (left↔right); higher `level` = higher ground = drawn brighter, with a cliff at
    // any boundary where two lanes differ in level. Lanes are DATA — change levels here
    // and spawning, movement, targeting, terrain and the high-ground rule all follow.
    //
    // Default layout: the outer two lanes sit at GROUND level and the MIDDLE lane is a
    // raised mesa one level up — so it has a cliff on both edges (a rise from the top
    // lane, a drop to the bottom lane) and is high ground against both neighbours.
    //
    // The y/thickness/cliffHeight numbers are tied together: the GAP between two
    // adjacent lane bands must equal `elevation.cliffHeight` so the 2-tile cliff art
    // fits exactly. Spacing between lane centres = thickness + cliffHeight (300+128=428).
    lanes: [
        { y: 522, level: 0, thickness: 300 },  // ground (top of screen)
        { y: 950, level: 1, thickness: 300 },  // raised mesa (middle)
        { y: 1378, level: 0, thickness: 300 }, // ground (bottom)
    ],

    // Elevation between lanes: the cliff face the upper plateau drops down to the lane
    // below, and how far the cliff stops short of the keeps.
    elevation: {
        cliffHeight: 128, // px drop between adjacent lanes — MUST equal the band gap
                          // (== 2 tiles tall, the height of the cliff-face art).
        rampInset: 420,   // px from each world edge where the cliff ends, leaving open
                          // grass near the keeps as the implied access onto the high ground.
    },

    // Keeps sit at each end of the lane. Player on the left, enemy on the right.
    keep: {
        hp: 500,
        damagePerUnit: 25, // damage each unit that reaches the opposing keep deals
        margin: 240,       // distance from the world edge to the keep's centre
        size: 320,
    },

    // One melee unit type for Milestone 1: the Tiny Swords "Warrior" (faces right; blue
    // art for the player, red for the enemy — see units/animations.ts). Source frames
    // are 192x192 with the character centred and feet ~80% down the frame.
    unit: {
        hp: 30,
        damage: 10,           // 3 hits to kill at 30 hp
        range: 64,            // centre-to-centre engage distance. ~= the knight's body
                              // width at this scale, so the front line meets edge-to-edge
                              // instead of piling up. Raise for more spacing, lower to scrum.
        attackInterval: 600,  // ms between attacks
        moveSpeed: 70,        // px per second along the lane
        frameSize: 192,       // source frame px — never mix sizes
        renderScale: 0.8,     // display scale; visible knight ~= 80px tall on screen
        footAnchor: 0.8,      // y within the frame where the feet sit (sprite origin.y)
        deathFadeMs: 400,     // synthesised death fade-out (pack has no death animation)
    },

    // Terrain drawn from the real Tiny Swords tileset (Milestone 2). The full
    // index→piece map lives in terrain/tileset.ts (it's a big labelled table, kept
    // beside the loader); these are the tunables the renderer reads. Swap `variant`
    // (color1..5) to recolour the grass — same layout, different hue.
    terrain: {
        tileSize: 64,      // px per tile in the source sheet (confirmed 576×384 / 9×6)
        variant: 'color1', // which Tilemap_color*.png is loaded (see tileset.ts)
        renderTile: 64,    // px each tile is drawn at in the world (1:1 — no scaling)

        // Faked lighting that sells the stacked-plateau read (purely visual). Lower
        // terraces sit a touch darker (like real terraced ground), and each cliff casts
        // a soft contact shadow onto the level below it.
        shading: {
            levelStep: 0.08,       // extra darkening per terrace, going downward
            castShadowAlpha: 0.28, // strength of a cliff's shadow on the level below
            castShadowDepth: 54,   // px the cast shadow reaches onto the lower terrace
        },
    },

    // Combat tuning.
    combat: {
        reacquireMs: 100, // how often units re-pick a target (not every frame)

        // High-ground rule (M2): lanes share a cliff-edge boundary. A front-line unit
        // may engage an enemy in the VERTICALLY ADJACENT lane (one level up/down) when
        // within `reach` across the edge — a longer reach than the melee `range` so the
        // skirmish bites right at the boundary. The UPHILL unit (higher level) deals
        // `damageMult`× damage. This is the only place elevation touches combat in M2.
        highGround: {
            // Cross-edge engage distance to an adjacent-level lane. Must clear the gap
            // between two lane BANDS — that gap is cliffHeight (128) + both 24px insets
            // = 176px — with headroom, so units near the shared edge actually clash.
            reach: 220,
            damageMult: 2.0, // uphill striker's damage multiplier (downhill = 1×)
        },
    },

    // Soft separation: units nudge away from any neighbour (friend or foe) closer than
    // `radius`, so the horde stays a loose organic mass instead of a hard pile. Capped per
    // frame so it never jitters. Raise strength for more spread; raise radius for bigger gaps.
    separation: {
        radius: 42,   // px; neighbours closer than this push apart
        strength: 50, // px/sec; max nudge applied per unit per frame
    },

    // Spawning ramps each side up to a horde. The per-side caps are ASYMMETRIC on
    // purpose: Milestone 1 has no player input, so equal armies just stalemate in the
    // middle and nobody ever wins. A denser side wins the attrition and breaks through.
    // Default: player advantage -> you tend to WIN. Swap the numbers to test a LOSE.
    spawn: {
        spawnInterval: 150, // ms between spawns, per side
        unitsTarget: { player: 300, enemy: 220 }, // soft cap of active living units per side
        // Relative likelihood a new unit spawns into each lane (index matches `lanes`).
        // Equal = the horde spreads evenly over every elevation. Tune to favour a lane.
        laneDistribution: [1, 1, 1],
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

    // Both armies use the same art, recoloured by tint (Phase 3).
    faction: {
        player: { tint: 0x4aa3ff }, // azure
        enemy: { tint: 0xff5a5a },  // crimson
    },

    // Backdrop palette (procedural placeholder until real art lands in Phase 6).
    colors: {
        sky: 0x0e1620,       // outside-world / void
        grass: 0x3b5230,     // base field
        grassDark: 0x33482a,
        grassLight: 0x47603a,
        dirt: 0x6b5536,      // the lane / road
        dirtDark: 0x5a472d,
        dirtEdge: 0x42341f,
        rock: 0x7d7d82,
        rockDark: 0x5c5c61,
        trunk: 0x5a3d22,
        leaf: 0x3f6b32,
        leafDark: 0x32562a,
        stone: 0x8a8a90,     // keep walls
        stoneDark: 0x6c6c72,
    },
};
// NB: not `as const` — the dev tuning panel (controls/DevPanel.ts) mutates a few of
// these live (spawn rate, army caps, map width, lane count, high-ground bonus). They
// stay the single source of truth; the panel just edits the numbers, exactly like
// editing this file but without a rebuild.

export type GameConfig = typeof CONFIG;

// Build an evenly-stacked set of lanes for a given count, centred vertically in the
// world. Spacing keeps the band-to-band GAP equal to the cliff height so the 2-tile
// cliff art always fits. Highest `level` sits at the top of the screen. The default
// CONFIG.lanes above is exactly makeLanes(3); the panel calls this to re-tier.
export function makeLanes(count: number): { y: number; level: number; thickness: number }[] {
    const thickness = 300;
    const gap = CONFIG.elevation.cliffHeight;
    const spacing = thickness + gap;
    const totalH = count * thickness + (count - 1) * gap;
    const top = (CONFIG.world.height - totalH) / 2;
    const lanes = [];
    for (let i = 0; i < count; i++) {
        lanes.push({ y: top + thickness / 2 + i * spacing, level: count - 1 - i, thickness });
    }
    return lanes;
}

// Derived layout helpers — FUNCTIONS (not constants) so they re-read CONFIG.lanes
// after the panel changes the lane count on restart.

// Vertical centre of the whole lane stack — what the camera frames by default.
export const battlefieldCenterY = () =>
    (CONFIG.lanes[0].y + CONFIG.lanes[CONFIG.lanes.length - 1].y) / 2;

// Top/bottom of the stacked plateaus (used to size the keeps spanning every lane).
export const stackTop = () => CONFIG.lanes[0].y - CONFIG.lanes[0].thickness / 2;
export const stackBottom = () =>
    CONFIG.lanes[CONFIG.lanes.length - 1].y + CONFIG.lanes[CONFIG.lanes.length - 1].thickness / 2;
