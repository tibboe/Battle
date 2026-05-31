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

    // The single horizontal lane the armies march along (centre line + band height).
    // The band is thick enough for several ranks of units to stack with depth.
    lane: {
        y: 950, // vertical centre of the world
        thickness: 360,
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

    // Combat tuning.
    combat: {
        reacquireMs: 100, // how often units re-pick a target (not every frame)
    },

    // Spawning ramps each side up to a horde. The per-side caps are ASYMMETRIC on
    // purpose: Milestone 1 has no player input, so equal armies just stalemate in the
    // middle and nobody ever wins. A denser side wins the attrition and breaks through.
    // Default: player advantage -> you tend to WIN. Swap the numbers to test a LOSE.
    spawn: {
        spawnInterval: 150, // ms between spawns, per side
        unitsTarget: { player: 300, enemy: 220 }, // soft cap of active living units per side
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
} as const;

export type GameConfig = typeof CONFIG;
