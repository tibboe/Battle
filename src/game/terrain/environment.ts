import * as Phaser from 'phaser';

// Environment art beyond the ground tiles: the water background, the animated coastline
// foam, drifting clouds, and the scatter decorations (bushes, rocks, water rocks, duck).
// Everything here is from the Tiny Swords pack. Animated pieces are multi-frame strips;
// static pieces are single PNGs. Loading + animation registration live together so the
// scene just calls loadEnvironment() in preload and registerEnvironmentAnims() in create.

const BASE = 'assets/environment/tiny-swords';
const DEC = `${BASE}/Decorations`;

// Single-frame water tile + the animated foam ring (192² frames) that rims the coast.
export const WATER = { key: 'env-water', file: `${BASE}/Tileset/Water Background color.png` } as const;
export const FOAM = {
    key: 'env-foam',
    file: `${BASE}/Tileset/Water Foam.png`,
    size: 192,
    frames: 16,
    rate: 12,
    anim: 'anim-foam',
} as const;

// Static clouds — 8 variants, each a single 576×256 PNG with transparency.
export const CLOUDS = Array.from({ length: 8 }, (_, i) => ({
    key: `env-cloud-${i + 1}`,
    file: `${DEC}/Clouds/Clouds_0${i + 1}.png`,
}));

// Static land rocks — 4 variants, 64².
export const ROCKS = Array.from({ length: 4 }, (_, i) => ({
    key: `env-rock-${i + 1}`,
    file: `${DEC}/Rocks/Rock${i + 1}.png`,
}));

// Animated bushes — 4 variants, 128² × 8 frames (gentle sway).
export const BUSHES = Array.from({ length: 4 }, (_, i) => ({
    key: `env-bush-${i + 1}`,
    file: `${DEC}/Bushes/Bushe${i + 1}.png`,
    size: 128,
    frames: 8,
    rate: 8,
    anim: `anim-bush-${i + 1}`,
}));

// Animated water rocks — 4 variants, 64² × 16 frames (foam laps around them).
export const WATER_ROCKS = Array.from({ length: 4 }, (_, i) => ({
    key: `env-wrock-${i + 1}`,
    file: `${DEC}/Rocks in the Water/Water Rocks_0${i + 1}.png`,
    size: 64,
    frames: 16,
    rate: 10,
    anim: `anim-wrock-${i + 1}`,
}));

// Animated trees — sway loops. Tree1/2 are firs (256² × 6), Tree3/4 are leafy (192² × 8).
export const TREES = [
    { key: 'env-tree-1', file: `${BASE}/Resources/Wood/Trees/Tree1.png`, size: 256, frames: 6, rate: 6, anim: 'anim-tree-1' },
    { key: 'env-tree-2', file: `${BASE}/Resources/Wood/Trees/Tree2.png`, size: 256, frames: 6, rate: 6, anim: 'anim-tree-2' },
    { key: 'env-tree-3', file: `${BASE}/Resources/Wood/Trees/Tree3.png`, size: 192, frames: 8, rate: 7, anim: 'anim-tree-3' },
    { key: 'env-tree-4', file: `${BASE}/Resources/Wood/Trees/Tree4.png`, size: 192, frames: 8, rate: 7, anim: 'anim-tree-4' },
];

// Static tree stumps — 4 variants, 192×256 (base at bottom-centre).
export const STUMPS = Array.from({ length: 4 }, (_, i) => ({
    key: `env-stump-${i + 1}`,
    file: `${BASE}/Resources/Wood/Trees/Stump ${i + 1}.png`,
}));

// Animated rubber duck — 32² × 3 frames.
export const DUCK = {
    key: 'env-duck',
    file: `${DEC}/Rubber Duck/Rubber duck.png`,
    size: 32,
    frames: 3,
    rate: 6,
    anim: 'anim-duck',
} as const;

export function loadEnvironment(scene: Phaser.Scene) {
    scene.load.image(WATER.key, encodeURI(WATER.file));
    scene.load.spritesheet(FOAM.key, encodeURI(FOAM.file), { frameWidth: FOAM.size, frameHeight: FOAM.size });
    scene.load.spritesheet(DUCK.key, encodeURI(DUCK.file), { frameWidth: DUCK.size, frameHeight: DUCK.size });
    for (const c of CLOUDS) scene.load.image(c.key, encodeURI(c.file));
    for (const r of ROCKS) scene.load.image(r.key, encodeURI(r.file));
    for (const s of STUMPS) scene.load.image(s.key, encodeURI(s.file));
    for (const b of BUSHES) scene.load.spritesheet(b.key, encodeURI(b.file), { frameWidth: b.size, frameHeight: b.size });
    for (const w of WATER_ROCKS) scene.load.spritesheet(w.key, encodeURI(w.file), { frameWidth: w.size, frameHeight: w.size });
    for (const t of TREES) scene.load.spritesheet(t.key, encodeURI(t.file), { frameWidth: t.size, frameHeight: t.size });
}

// `yoyo` plays the strip forward then backward so a one-directional sway eases back
// instead of snapping from the last frame to the first (which reads as sliding).
function makeAnim(scene: Phaser.Scene, key: string, tex: string, frames: number, rate: number, yoyo = false) {
    if (scene.anims.exists(key)) scene.anims.remove(key);
    scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(tex, { start: 0, end: frames - 1 }),
        frameRate: rate,
        repeat: -1,
        yoyo,
    });
}

export function registerEnvironmentAnims(scene: Phaser.Scene) {
    makeAnim(scene, FOAM.anim, FOAM.key, FOAM.frames, FOAM.rate);
    makeAnim(scene, DUCK.anim, DUCK.key, DUCK.frames, DUCK.rate);
    for (const b of BUSHES) makeAnim(scene, b.anim, b.key, b.frames, b.rate, true);
    for (const w of WATER_ROCKS) makeAnim(scene, w.anim, w.key, w.frames, w.rate);
    for (const t of TREES) makeAnim(scene, t.anim, t.key, t.frames, t.rate, true);
}
