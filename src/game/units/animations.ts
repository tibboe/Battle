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

// Minimal shape of the Aseprite JSON we rely on (real exports include much more).
interface AsepriteData {
    frames: Record<string, { duration?: number }>;
    meta: { frameTags?: { name: string; from: number; to: number }[] };
}

export function loadUnitAtlas(scene: Phaser.Scene) {
    scene.load.aseprite(MELEE_KEY, 'assets/units/melee/melee.png', 'assets/units/melee/melee.json');
}

// Build one animation per Aseprite tag, manually, from the loaded atlas + JSON.
// We don't use anims.createFromAseprite because it can silently create nothing for
// non-Aseprite-authored JSON; manual creation works for both placeholder and real art.
export function registerUnitAnimations(scene: Phaser.Scene) {
    const data = scene.cache.json.get(MELEE_KEY) as AsepriteData | undefined;
    if (!data || !data.meta.frameTags) {
        console.warn(`[animations] no Aseprite tags found for "${MELEE_KEY}"`);
        return;
    }

    // Atlas frame names, in sheet order — tag from/to index into this list.
    const frameNames = Object.keys(data.frames);

    for (const tag of data.meta.frameTags) {
        if (scene.anims.exists(tag.name)) {
            scene.anims.remove(tag.name);
        }
        const frames = [];
        for (let i = tag.from; i <= tag.to; i++) {
            const name = frameNames[i];
            frames.push({
                key: MELEE_KEY,
                frame: name,
                duration: data.frames[name].duration ?? 100,
            });
        }
        scene.anims.create({
            key: tag.name,
            frames,
            repeat: LOOPING.has(tag.name) ? -1 : 0,
        });
    }
}
