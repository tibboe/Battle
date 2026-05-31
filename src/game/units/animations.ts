import * as Phaser from 'phaser';

// Milestone-1 melee unit = Tiny Swords "Warrior" (Pixel Frog). The pack ships separate
// colour sets, so we use the BLUE set for the player and the RED set for the enemy and
// drop tinting entirely (tinting an already-coloured sprite looks muddy).
//
// Each animation is its own PNG strip of 192x192 frames; the character is centred with
// its feet ~80% down the frame (see CONFIG.unit.footAnchor). The pack has NO death
// animation, so "death" is synthesised in UnitManager (freeze + fade). Tag names
// (idle/walk/attack) are the contract the rest of the code plays by faction.

const BASE = 'assets/units/tiny-swords';

// Faction -> folder name inside the pack.
const FACTION_DIR = {
    player: 'Blue Units',
    enemy: 'Red Units',
} as const;

export type FactionName = keyof typeof FACTION_DIR;

// Animation -> source strip, frame count, and playback speed.
const SHEETS = {
    idle: { file: 'Warrior_Idle.png', frames: 8, frameRate: 8 },
    walk: { file: 'Warrior_Run.png', frames: 6, frameRate: 14 },
    attack: { file: 'Warrior_Attack1.png', frames: 4, frameRate: 12 },
} as const;

export const ANIM = {
    idle: 'idle',
    walk: 'walk',
    attack: 'attack',
    death: 'death', // synthesised (fade-out) — no frames in the pack
} as const;

const FRAME = 192;
// idle/walk loop forever; attack loops while engaged. (death has no frames.)
const LOOPING = new Set<string>([ANIM.idle, ANIM.walk, ANIM.attack]);

// Texture key for one faction+anim strip.
function texKey(faction: FactionName, anim: string) {
    return `warrior-${faction}-${anim}`;
}

// Animation key the rest of the code plays.
export function animKey(faction: FactionName, anim: string) {
    return `${faction}-${anim}`;
}

// A texture that exists immediately after load, for creating pooled sprites before any
// animation has played.
export const POOL_TEXTURE = texKey('player', ANIM.idle);

const FACTIONS = Object.keys(FACTION_DIR) as FactionName[];
const ANIMS = Object.keys(SHEETS) as (keyof typeof SHEETS)[];

export function loadUnitAtlas(scene: Phaser.Scene) {
    for (const faction of FACTIONS) {
        for (const anim of ANIMS) {
            // Pack folders contain spaces; encodeURI keeps the slashes but escapes them.
            const path = encodeURI(`${BASE}/${FACTION_DIR[faction]}/Warrior/${SHEETS[anim].file}`);
            scene.load.spritesheet(texKey(faction, anim), path, {
                frameWidth: FRAME,
                frameHeight: FRAME,
            });
        }
    }
}

// One animation per faction+tag, built from each strip's frame numbers.
export function registerUnitAnimations(scene: Phaser.Scene) {
    for (const faction of FACTIONS) {
        for (const anim of ANIMS) {
            const key = animKey(faction, anim);
            if (scene.anims.exists(key)) scene.anims.remove(key);
            const spec = SHEETS[anim];
            scene.anims.create({
                key,
                frames: scene.anims.generateFrameNumbers(texKey(faction, anim), {
                    start: 0,
                    end: spec.frames - 1,
                }),
                frameRate: spec.frameRate,
                repeat: LOOPING.has(anim) ? -1 : 0,
            });
        }
    }
}
