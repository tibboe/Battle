import * as Phaser from 'phaser';

// All five Tiny Swords unit types (Pixel Frog), data-driven. The pack ships separate
// colour sets, so we use the BLUE set for the player and the RED set for the enemy and
// skip tinting (tinting already-coloured art looks muddy).
//
// Each animation is its own PNG strip; the character is centred with its feet near the
// bottom (see each type's footAnchor in config). The pack has NO death animation, so
// "death" is synthesised in UnitManager (freeze + fade). The strip metadata below is the
// art contract — frame size and counts come straight from the PNGs, never guessed.
//
// Pack irregularities handled here:
//   • Lancer frames are 320px (everyone else is 192) and its attack is one Right-facing
//     pose (Lancer_Right_Attack) — fine for a left↔right lane.
//   • Monk files are UNPREFIXED (Idle/Run/Heal) and there is NO attack strip — it is a
//     healer. Its heal strip wires in during Phase 2.
//   • The Archer's "attack" is its Shoot strip; the Arrow projectile arrives in Phase 2.

const BASE = 'assets/units/tiny-swords';

// Faction -> folder name inside the pack.
const FACTION_DIR = {
    player: 'Blue Units',
    enemy: 'Red Units',
} as const;

export type FactionName = keyof typeof FACTION_DIR;

// Logical animation states the game can play. `death` is synthesised (no frames); `heal`
// is loaded for the Monk but only used from Phase 2.
export type UnitAnim = 'walk' | 'attack' | 'heal';

// One source strip: file (inside the type's folder), frame count, playback rate.
interface Strip {
    file: string;
    frames: number;
    frameRate: number;
}

// Per art-set (keyed by UnitType.art): folder + source frame size + the strips it provides.
interface UnitArt {
    dir: string;
    frameSize: number; // source px per frame (square)
    states: Partial<Record<UnitAnim, Strip>>;
}

const UNIT_ART: Record<string, UnitArt> = {
    warrior: {
        dir: 'Warrior',
        frameSize: 192,
        states: {
            walk: { file: 'Warrior_Run.png', frames: 6, frameRate: 14 },
            attack: { file: 'Warrior_Attack1.png', frames: 4, frameRate: 12 },
        },
    },
    pawn: {
        dir: 'Pawn',
        frameSize: 192,
        states: {
            walk: { file: 'Pawn_Run.png', frames: 6, frameRate: 14 },
            attack: { file: 'Pawn_Interact Knife.png', frames: 4, frameRate: 12 },
        },
    },
    lancer: {
        dir: 'Lancer',
        frameSize: 320,
        states: {
            walk: { file: 'Lancer_Run.png', frames: 6, frameRate: 14 },
            attack: { file: 'Lancer_Right_Attack.png', frames: 3, frameRate: 12 },
        },
    },
    archer: {
        dir: 'Archer',
        frameSize: 192,
        states: {
            walk: { file: 'Archer_Run.png', frames: 4, frameRate: 14 },
            attack: { file: 'Archer_Shoot.png', frames: 8, frameRate: 14 },
        },
    },
    monk: {
        dir: 'Monk',
        frameSize: 192,
        states: {
            walk: { file: 'Run.png', frames: 4, frameRate: 14 },
            // No attack strip — Monk is support. Heal (Heal.png, 11 frames) wires in Phase 2.
        },
    },
};

// One key namespaces both the texture and its animation for a given art+faction+state.
export function animKey(art: string, faction: FactionName, anim: UnitAnim) {
    return `${art}-${faction}-${anim}`;
}

// A texture that exists right after load, for creating pooled sprites before any animation
// has played. (Pool sprites are re-textured per spawn via play().)
export const POOL_TEXTURE = animKey('warrior', 'player', 'walk');

const FACTIONS = Object.keys(FACTION_DIR) as FactionName[];
const ART_KEYS = Object.keys(UNIT_ART);

// Load every art-set's strips, for both factions, as spritesheets sliced by frame size.
export function loadUnitAtlas(scene: Phaser.Scene) {
    for (const art of ART_KEYS) {
        const def = UNIT_ART[art];
        for (const faction of FACTIONS) {
            for (const anim of Object.keys(def.states) as UnitAnim[]) {
                const strip = def.states[anim]!;
                // Pack folders contain spaces; encodeURI keeps the slashes but escapes them.
                const path = encodeURI(`${BASE}/${FACTION_DIR[faction]}/${def.dir}/${strip.file}`);
                scene.load.spritesheet(animKey(art, faction, anim), path, {
                    frameWidth: def.frameSize,
                    frameHeight: def.frameSize,
                });
            }
        }
    }
}

// Texture key for a faction's arrow projectile.
export function arrowKey(faction: FactionName) {
    return `arrow-${faction}`;
}

// Load the Archer's arrow sprite for both factions (a single 64×64 image, not a strip).
export function loadProjectiles(scene: Phaser.Scene) {
    for (const faction of FACTIONS) {
        const path = encodeURI(`${BASE}/${FACTION_DIR[faction]}/Archer/Arrow.png`);
        scene.load.image(arrowKey(faction), path);
    }
}

// Build one animation per art-set + faction + state from each strip's frame numbers.
export function registerUnitAnimations(scene: Phaser.Scene) {
    for (const art of ART_KEYS) {
        const def = UNIT_ART[art];
        for (const faction of FACTIONS) {
            for (const anim of Object.keys(def.states) as UnitAnim[]) {
                const strip = def.states[anim]!;
                const key = animKey(art, faction, anim);
                if (scene.anims.exists(key)) scene.anims.remove(key);
                scene.anims.create({
                    key,
                    frames: scene.anims.generateFrameNumbers(key, { start: 0, end: strip.frames - 1 }),
                    frameRate: strip.frameRate,
                    // walk/attack loop (attack loops while engaged); heal plays once.
                    repeat: anim === 'heal' ? 0 : -1,
                });
            }
        }
    }
}
