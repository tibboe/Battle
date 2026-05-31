// Generates a PLACEHOLDER melee unit sprite sheet + Aseprite-format JSON that obey
// ASSET_SPEC.md exactly (32x32 frames, faces right, feet at bottom-centre, tags
// idle/walk/attack/death, light/neutral so azure/crimson tint multiplies cleanly).
//
// The point: the game loads these via the SAME `load.aseprite` call the real art will
// use, so dropping in a real melee.png/.json later is a file swap with no code changes.
//
// Run:  node tools/gen-placeholder-unit.mjs
// Out:  public/assets/units/melee/melee.png  +  melee.json
//
// No dependencies — PNG is encoded with Node's built-in zlib (deflate + crc32).

import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME = 32;

// Frame layout (order matters — frameTags index into this sequence).
const STATES = [
    { name: 'idle',   frames: 2, durationMs: 167 }, // ~6 fps, loops
    { name: 'walk',   frames: 4, durationMs: 100 }, // ~10 fps, loops
    { name: 'attack', frames: 4, durationMs: 90 },  // ~11 fps, once
    { name: 'death',  frames: 4, durationMs: 125 }, // ~8 fps, once
];
const TOTAL = STATES.reduce((n, s) => n + s.frames, 0);

const SHEET_W = TOTAL * FRAME;
const SHEET_H = FRAME;

// Palette. Near-black outline won't take tint (stays dark); light body tints cleanly.
const C = {
    clear:   [0, 0, 0, 0],
    outline: [24, 24, 32, 255],
    body:    [222, 222, 230, 255],
    head:    [232, 214, 196, 255],
    weapon:  [196, 200, 214, 255],
    impact:  [255, 255, 255, 255],
};

// RGBA buffer for the whole sheet.
const px = new Uint8Array(SHEET_W * SHEET_H * 4);

function set(frame, x, y, [r, g, b, a]) {
    if (x < 0 || x > 31 || y < 0 || y > 31) return;
    const gx = frame * FRAME + x;
    const i = (y * SHEET_W + gx) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function rect(frame, x0, y0, x1, y1, color) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(frame, x, y, color);
}

// Draw a blocky right-facing soldier. dy lowers the whole body; lean tips it right;
// legSpread animates the stride; arm/sword params drive the attack pose.
function drawSoldier(frame, opts = {}) {
    const { dy = 0, lean = 0, leftLegDX = 0, rightLegDX = 0, sword = null, headBob = 0 } = opts;

    const cx = 16 + lean;
    const footY = 31 + dy;

    // Legs (two columns) down to the feet.
    rect(frame, cx - 4 + leftLegDX, footY - 7, cx - 2 + leftLegDX, footY, C.body);
    rect(frame, cx + 2 + rightLegDX, footY - 7, cx + 4 + rightLegDX, footY, C.body);
    // Foot outline so they read as planted.
    set(frame, cx - 4 + leftLegDX, footY, C.outline);
    set(frame, cx + 4 + rightLegDX, footY, C.outline);

    // Torso.
    const torsoTop = footY - 17;
    rect(frame, cx - 4, torsoTop, cx + 4, footY - 7, C.body);
    rect(frame, cx - 4, torsoTop, cx - 4, footY - 7, C.outline); // left edge
    rect(frame, cx + 4, torsoTop, cx + 4, footY - 7, C.outline); // right edge

    // Head (with a forward-facing visor pixel so "facing right" is obvious).
    const headTop = torsoTop - 7 + headBob;
    rect(frame, cx - 3, headTop, cx + 3, headTop + 6, C.head);
    rect(frame, cx - 3, headTop, cx + 3, headTop, C.outline);     // top
    set(frame, cx + 3, headTop + 3, C.outline);                   // brow
    set(frame, cx + 4, headTop + 3, C.outline);                   // nose facing right

    // Sword / arm extending to the right.
    if (sword) {
        const { y, x0, x1, tip = false } = sword;
        rect(frame, x0, y, x1, y, C.weapon);
        rect(frame, x0, y + 1, x1, y + 1, C.weapon);
        if (tip) rect(frame, x1 - 2, y - 1, x1, y + 2, C.impact); // bright impact
    }
}

// Build each frame.
let f = 0;
const tags = [];
for (const state of STATES) {
    const from = f;
    for (let i = 0; i < state.frames; i++, f++) {
        if (state.name === 'idle') {
            drawSoldier(f, { headBob: i === 1 ? -1 : 0 });
        } else if (state.name === 'walk') {
            // 4-step stride with a slight bob mid-step.
            const stride = [{ l: -2, r: 2 }, { l: 0, r: 0 }, { l: 2, r: -2 }, { l: 0, r: 0 }][i];
            drawSoldier(f, { leftLegDX: stride.l, rightLegDX: stride.r, headBob: i % 2 ? -1 : 0 });
        } else if (state.name === 'attack') {
            // Wind up -> thrust (impact on f2) -> recover.
            const sword = [
                { y: 12, x0: 20, x1: 24 },
                { y: 14, x0: 20, x1: 27 },
                { y: 16, x0: 20, x1: 31, tip: true },
                { y: 15, x0: 20, x1: 26 },
            ][i];
            drawSoldier(f, { sword });
        } else if (state.name === 'death') {
            // Tip over to the right and sink to the ground, fading slightly.
            const lean = [2, 4, 7, 9][i];
            const dy = [0, 2, 5, 7][i];
            drawSoldier(f, { lean, dy });
        }
    }
    tags.push({ name: state.name, from, to: f - 1, direction: 'forward' });
}

// ---- Encode PNG (8-bit RGBA, no interlace) ----
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SHEET_W, 0);
ihdr.writeUInt32BE(SHEET_H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // colour type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// Raw image data: each row prefixed with filter byte 0.
const raw = Buffer.alloc(SHEET_H * (1 + SHEET_W * 4));
for (let y = 0; y < SHEET_H; y++) {
    const rowStart = y * (1 + SHEET_W * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < SHEET_W * 4; x++) {
        raw[rowStart + 1 + x] = px[y * SHEET_W * 4 + x];
    }
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
]);

// ---- Aseprite-format JSON (Hash) ----
const frames = {};
for (let i = 0; i < TOTAL; i++) {
    // Find which state this frame belongs to for its duration.
    const tag = tags.find((t) => i >= t.from && i <= t.to);
    const duration = STATES.find((s) => s.name === tag.name).durationMs;
    frames[`melee ${i}.aseprite`] = {
        frame: { x: i * FRAME, y: 0, w: FRAME, h: FRAME },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: FRAME, h: FRAME },
        sourceSize: { w: FRAME, h: FRAME },
        duration,
    };
}

const json = {
    frames,
    meta: {
        app: 'placeholder-generator',
        version: '1.0',
        image: 'melee.png',
        format: 'RGBA8888',
        size: { w: SHEET_W, h: SHEET_H },
        scale: '1',
        frameTags: tags,
        layers: [],
        slices: [],
    },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/assets/units/melee');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'melee.png'), png);
writeFileSync(resolve(outDir, 'melee.json'), JSON.stringify(json, null, 2));

console.log(`Wrote ${TOTAL} frames (${SHEET_W}x${SHEET_H}) to ${outDir}`);
console.log('Tags:', tags.map((t) => `${t.name}[${t.from}-${t.to}]`).join(' '));
