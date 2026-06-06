import * as Phaser from 'phaser';
import { TERRAIN_VARIANTS, TILES } from '../terrain/tileset';
import { BUSHES, DUCK, ROCKS, STUMPS, TREES, WATER, WATER_ROCKS } from '../terrain/environment';
import type { TileId } from './MapData';

// The catalog is the single source of truth for everything paintable: it drives the explorer
// (label + thumbnail) and tells the renderer how to draw each tile. The `category` array is the
// FOLDER PATH the explorer groups by; the tile is the leaf. Recolourable tiles (grass, cliffs)
// carry a `colorIndex` (0–4 = the tileset's five hues) and a `variantKey` (piece identity shared
// across colours) so the strip's colour filter can show just one hue and recolour the brush.

export type TileRender =
    // A ground tile that fills one 64px cell (drawn from the terrain tileset).
    | { kind: 'ground'; atlas: string; frame: number }
    // Open sea: draw nothing, the water backdrop shows through.
    | { kind: 'water' }
    // A decoration ON TOP of the ground, anchored at its base (origin y). May be a whole image,
    // an animated spritesheet (`anim`), or a tileset `frame`. Cliffs are TWO cells tall: `frame`
    // is the rock body in the clicked cell and `capFrame` the grass cap drawn in the cell above.
    | { kind: 'feature'; texture: string; frame?: number; capFrame?: number; anim?: string; originX?: number; originY: number; scale: number };

export interface TileDef {
    id: TileId;
    category: string[];
    label: string;
    desc: string;
    render: TileRender;
    swatch: number;
    colorIndex?: number;  // 0–4 for recolourable tileset tiles (grass / cliffs)
    variantKey?: string;  // shared identity across colours (e.g. 'grass', 'cliff-41')
}

// Grass: one brush per tileset hue. The first keeps id 'grass' (default + back-compat).
const GRASS_DEFS: TileDef[] = TERRAIN_VARIANTS.map((v, i) => ({
    id: i === 0 ? 'grass' : `grass-${i + 1}`,
    category: ['Ground'],
    label: `Grass — ${v.label}`,
    desc: `${v.label} grass (#${v.hue.toString(16).padStart(6, '0')}).`,
    render: { kind: 'ground', atlas: v.key, frame: TILES.flatFill },
    swatch: v.hue,
    colorIndex: i,
    variantKey: 'grass',
}));

const WATER_DEF: TileDef = {
    id: 'water',
    category: ['Ground'],
    label: 'Water',
    desc: 'Open sea. Carves the coastline; units cannot stand here.',
    render: { kind: 'water' },
    swatch: 0x2e6f9e,
};

// Cliff PIECES (the Tiny Swords elevation block, frame indices verified by scanning the PNG).
// `key` gives each piece a stable id slug (existing ids preserved for saved maps). Two-tall
// pieces carry a `cap` (a grass frame drawn in the cell ABOVE the rock body) for quick building;
// the 1-tall pieces (plateau grass incl. the front-edge "1-tile-thick top", bare rock faces,
// bases) let you compose any cliff shape or override an edge by hand. Generated in all 5 colours.
const CLIFF_PIECES: { key: string; body: number; cap?: number; label: string; desc: string }[] = [
    // Quick 2-tall composites: grass cap (edge only where it meets the rock) over a rock wall.
    { key: '41', body: 41, cap: 23, label: 'Cliff edge (left)', desc: 'Two-tall: grass cap over a rock wall, left end. For 1-tile control use the Plateau front + Cliff face pieces.' },
    { key: '42', body: 42, cap: 24, label: 'Cliff edge (front)', desc: 'Two-tall: grass cap over a rock wall. For 1-tile control use the Plateau front + Cliff face pieces.' },
    { key: '43', body: 43, cap: 25, label: 'Cliff edge (right)', desc: 'Two-tall: grass cap over a rock wall, right end.' },
    { key: '45', body: 45, cap: 36, label: 'Cliff column (left)', desc: 'Two-tall narrow cliff pillar, left side.' },
    { key: '48', body: 48, cap: 39, label: 'Cliff column (right)', desc: 'Two-tall narrow cliff pillar, right side.' },
    // 1-tall plateau grass — build a cliff top of any shape/thickness.
    { key: '5', body: 5, label: 'Plateau ◤ (back-left)', desc: 'Raised-grass plateau back corner, left.' },
    { key: '6', body: 6, label: 'Plateau ▲ (back)', desc: 'Raised-grass plateau back edge.' },
    { key: '7', body: 7, label: 'Plateau ◥ (back-right)', desc: 'Raised-grass plateau back corner, right.' },
    { key: '14', body: 14, label: 'Plateau ◀ (left)', desc: 'Raised-grass plateau left edge.' },
    { key: '15', body: 15, label: 'Plateau ■ (fill)', desc: 'Raised-grass plateau interior.' },
    { key: '16', body: 16, label: 'Plateau ▶ (right)', desc: 'Raised-grass plateau right edge.' },
    { key: 'front-l', body: 23, label: 'Plateau ◣ (front-left)', desc: 'Grass top with the edge at the FRONT (bottom) only — a 1-tile-thick cliff top, left corner.' },
    { key: 'front-m', body: 24, label: 'Plateau ▼ (front)', desc: 'Grass top with the edge at the FRONT (bottom) only — a 1-tile-thick cliff top.' },
    { key: 'front-r', body: 25, label: 'Plateau ◢ (front-right)', desc: 'Grass top with the edge at the FRONT (bottom) only — a 1-tile-thick cliff top, right corner.' },
    // 1-tall bare rock — stack to make a wall of any height.
    { key: 'face-l', body: 41, label: 'Cliff face (left)', desc: 'Bare rock wall tile, left. Place below a plateau front edge.' },
    { key: 'face-m', body: 42, label: 'Cliff face (mid)', desc: 'Bare rock wall tile. Place below a plateau front edge.' },
    { key: 'face-r', body: 43, label: 'Cliff face (right)', desc: 'Bare rock wall tile, right. Place below a plateau front edge.' },
    { key: '50', body: 50, label: 'Cliff base (left)', desc: 'Foot of the cliff wall, left.' },
    { key: '51', body: 51, label: 'Cliff base (mid)', desc: 'Foot of the cliff wall.' },
    { key: '52', body: 52, label: 'Cliff base (right)', desc: 'Foot of the cliff wall, right.' },
];

const CLIFF_DEFS: TileDef[] = [];
TERRAIN_VARIANTS.forEach((v, c) => {
    for (const pc of CLIFF_PIECES) {
        CLIFF_DEFS.push({
            id: c === 0 ? `cliff-${pc.key}` : `cliff-c${c + 1}-${pc.key}`,
            category: ['Ground', 'Cliffs'],
            label: pc.label,
            desc: pc.desc,
            render: { kind: 'feature', texture: v.key, frame: pc.body, capFrame: pc.cap, originX: 0.5, originY: 0.5, scale: 1 },
            swatch: v.hue,
            colorIndex: c,
            variantKey: `cliff-${pc.key}`,
        });
    }
});

// ── organic features (no colour variants) ───────────────────────────────────
const TREE_DEFS: TileDef[] = TREES.map((t, i) => ({
    id: `tree-${i + 1}`, category: ['Features', 'Trees'], label: `Tree ${i + 1}`,
    desc: 'A leafy tree that sways in the wind.',
    render: { kind: 'feature', texture: t.key, anim: t.anim, originY: 0.92, scale: 0.85 }, swatch: 0x3f7d3a,
}));
const STUMP_DEFS: TileDef[] = STUMPS.map((s, i) => ({
    id: `stump-${i + 1}`, category: ['Features', 'Stumps'], label: `Stump ${i + 1}`,
    desc: 'A felled tree stump — the remains of cleared woodland.',
    render: { kind: 'feature', texture: s.key, originY: 0.92, scale: 0.8 }, swatch: 0x6b4a2a,
}));
const BUSH_DEFS: TileDef[] = BUSHES.map((b, i) => ({
    id: `bush-${i + 1}`, category: ['Features', 'Bushes'], label: `Bush ${i + 1}`,
    desc: 'A low shrub with a gentle sway.',
    render: { kind: 'feature', texture: b.key, anim: b.anim, originY: 0.85, scale: 0.9 }, swatch: 0x4e8a3e,
}));
const ROCK_DEFS: TileDef[] = ROCKS.map((r, i) => ({
    id: `rock-${i + 1}`, category: ['Features', 'Rocks'], label: `Rock ${i + 1}`,
    desc: 'A mossy boulder sitting on the grass.',
    render: { kind: 'feature', texture: r.key, originY: 0.8, scale: 1.0 }, swatch: 0x7d7f86,
}));
const SEA_DEFS: TileDef[] = [
    ...WATER_ROCKS.map((w, i) => ({
        id: `searock-${i + 1}`, category: ['Features', 'Sea'], label: `Sea Rock ${i + 1}`,
        desc: 'A rock in the water, ringed by lapping foam. Place on water.',
        render: { kind: 'feature' as const, texture: w.key, anim: w.anim, originY: 0.5, scale: 1.0 }, swatch: 0x3a5f72,
    })),
    {
        id: 'duck', category: ['Features', 'Sea'], label: 'Rubber Duck',
        desc: 'A cheerful rubber duck bobbing at sea. Purely decorative.',
        render: { kind: 'feature', texture: DUCK.key, anim: DUCK.anim, originY: 0.6, scale: 1.4 }, swatch: 0xe8c84a,
    },
];

export const TILE_CATALOG: TileDef[] = [
    ...GRASS_DEFS,
    WATER_DEF,
    ...CLIFF_DEFS,
    ...TREE_DEFS,
    ...BUSH_DEFS,
    ...ROCK_DEFS,
    ...STUMP_DEFS,
    ...SEA_DEFS,
];

const BY_ID = new Map<TileId, TileDef>(TILE_CATALOG.map((t) => [t.id, t]));
export const getTile = (id: TileId): TileDef | undefined => BY_ID.get(id);

/** The same piece in a different colour (for the strip's colour filter). */
export function siblingInColor(def: TileDef, colorIndex: number): TileDef | undefined {
    if (def.variantKey === undefined) return undefined;
    return TILE_CATALOG.find((t) => t.variantKey === def.variantKey && t.colorIndex === colorIndex);
}

// ── browser navigation ──────────────────────────────────────────────────────
const startsWith = (cat: string[], path: string[]) =>
    cat.length >= path.length && path.every((p, i) => cat[i] === p);

export function foldersAt(path: string[]): string[] {
    const set = new Set<string>();
    for (const t of TILE_CATALOG) {
        if (t.category.length > path.length && startsWith(t.category, path)) set.add(t.category[path.length]);
    }
    return [...set];
}

export function tilesAt(path: string[]): TileDef[] {
    return TILE_CATALOG.filter((t) => t.category.length === path.length && startsWith(t.category, path));
}

// ── thumbnails ──────────────────────────────────────────────────────────────
export function makeTileThumb(scene: Phaser.Scene, def: TileDef, size: number): Phaser.GameObjects.GameObject {
    const r = def.render;
    if (r.kind === 'ground') {
        return scene.add.image(0, 0, r.atlas, r.frame).setOrigin(0.5).setDisplaySize(size, size);
    }
    if (r.kind === 'water') {
        return scene.add.rectangle(0, 0, size, size, def.swatch).setOrigin(0.5);
    }
    const img = r.frame !== undefined
        ? scene.add.image(0, 0, r.texture, r.frame)
        : r.anim ? scene.add.image(0, 0, r.texture, 0) : scene.add.image(0, 0, r.texture);
    const s = size / Math.max(img.width, img.height);
    return img.setOrigin(0.5).setScale(s);
}

export const WATER_KEY = WATER.key;
