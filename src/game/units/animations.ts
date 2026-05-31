import * as Phaser from 'phaser';

// One place for the unit art pipeline (per ASSET_SPEC.md). Loading uses the exact
// `load.aseprite` call real art will use, so swapping in a real melee.png/.json is a
// file-only change. Phase 3's pooled units reuse these helpers and tag names.

export const MELEE_KEY = 'melee';

// Tag names are the contract between art and code (ASSET_SPEC §3) — lowercase, exact.
export const ANIM = {
    idle: 'idle',
    walk: 'walk',
    attack: 'attack',
    death: 'death',
} as const;

// idle/walk loop forever; attack/death play once.
const LOOPING = new Set<string>([ANIM.idle, ANIM.walk]);

export function loadUnitAtlas(scene: Phaser.Scene) {
    scene.load.aseprite(MELEE_KEY, 'assets/units/melee/melee.png', 'assets/units/melee/melee.json');
}

// Build animations from the Aseprite tags and set their loop behaviour.
export function registerUnitAnimations(scene: Phaser.Scene) {
    const created = scene.anims.createFromAseprite(MELEE_KEY);
    for (const anim of created) {
        anim.repeat = LOOPING.has(anim.key) ? -1 : 0;
    }
}
