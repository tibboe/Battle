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

    // One melee unit type for Milestone 1.
    // Art follows ASSET_SPEC.md: 32x32 source frames, faces right, bottom-centre
    // origin, tags idle/walk/attack/death. We render that 32px art scaled up.
    unit: {
        hp: 30,
        damage: 10,           // 3 hits to kill at 30 hp
        range: 52,            // centre-to-centre distance at which a unit engages
        attackInterval: 600,  // ms between attacks
        moveSpeed: 70,        // px per second along the lane
        frameSize: 32,        // source frame px (per ASSET_SPEC.md) — never mix sizes
        renderScale: 1.4,     // display scale; on-screen footprint ~= frameSize * scale
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

    // Backdrop palette (placeholder until real art lands in Phase 6).
    colors: {
        sky: 0x121a24,
        ground: 0x2c3a26,
        laneBand: 0x394a30,
        grid: 0x1d2630,
    },
} as const;

export type GameConfig = typeof CONFIG;
