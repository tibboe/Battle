import * as Phaser from 'phaser';
import { TERRAIN_VARIANTS, TILES, TILESET } from '../terrain/tileset';
import { BUSHES, DUCK, ROCKS, STUMPS, TREES, WATER, WATER_ROCKS } from '../terrain/environment';
import type { TileId } from './MapData';

// The catalog is the single source of truth for everything paintable: it drives the palette
// (label + description + thumbnail) and tells the renderer how to draw each tile. The
// `category` array is the FOLDER PATH the hierarchical browser groups by (e.g. ['Features',
// 'Trees']); the tile itself is the leaf. Appending new art here makes it show up in the
// browser with no other code changes.

export type TileRender =
    // A ground tile that fills one 64px cell (drawn from the terrain tileset).
    | { kind: 'ground'; atlas: string; frame: number }
    // Open sea: draw nothing, the water backdrop shows through.
    | { kind: 'water' }
    // A decoration placed ON TOP of the ground, anchored at its base (origin y). May be a
    // whole image, an animated spritesheet (`anim`), or a single tileset `frame` (used for
    // cliffs, so the grass underneath shows through the rock's transparent gaps).
    | { kind: 'feature'; texture: string; frame?: number; anim?: string; originX?: number; originY: number; scale: number };

export interface TileDef {
    id: TileId;
    /** Folder path for the browser, broad → narrow. The tile is the leaf inside it. */
    category: string[];
    label: string;
    desc: string;
    render: TileRender;
    /** Fallback swatch colour for chips when a texture thumbnail isn't suitable. */
    swatch: number;
}

// Grass comes in five hues (the tileset colour variants), each its own paintable brush so you
// can lay patches of different greens. The first keeps id 'grass' (the default + back-compat).
const GRASS_DEFS: TileDef[] = TERRAIN_VARIANTS.map((v, i) => ({
    id: i === 0 ? 'grass' : `grass-${i + 1}`,
    category: ['Ground', 'Grass'],
    label: `Grass — ${v.label}`,
    desc: `${v.label} grass (#${v.hue.toString(16).padStart(6, '0')}).`,
    render: { kind: 'ground', atlas: v.key, frame: TILES.flatFill },
    swatch: v.hue,
}));

const GROUND: TileDef[] = [
    {
        id: 'water',
        category: ['Ground'],
        label: 'Water',
        desc: 'Open sea. Carves the coastline; units cannot stand here.',
        render: { kind: 'water' },
        swatch: 0x2e6f9e,
    },
];

// Build the feature catalog from the existing environment art so the editor and the game
// draw the exact same sprites. originY/scale mirror TerrainRenderer's scatter placement.
const TREE_DEFS: TileDef[] = TREES.map((t, i) => ({
    id: `tree-${i + 1}`,
    category: ['Features', 'Trees'],
    label: `Tree ${i + 1}`,
    desc: 'A leafy tree that sways in the wind. Blocks movement (decorative for now).',
    render: { kind: 'feature', texture: t.key, anim: t.anim, originY: 0.92, scale: 0.85 },
    swatch: 0x3f7d3a,
}));

const STUMP_DEFS: TileDef[] = STUMPS.map((s, i) => ({
    id: `stump-${i + 1}`,
    category: ['Features', 'Stumps'],
    label: `Stump ${i + 1}`,
    desc: 'A felled tree stump — the remains of cleared woodland.',
    render: { kind: 'feature', texture: s.key, originY: 0.92, scale: 0.8 },
    swatch: 0x6b4a2a,
}));

const BUSH_DEFS: TileDef[] = BUSHES.map((b, i) => ({
    id: `bush-${i + 1}`,
    category: ['Features', 'Bushes'],
    label: `Bush ${i + 1}`,
    desc: 'A low shrub with a gentle sway. Good for filling open grass.',
    render: { kind: 'feature', texture: b.key, anim: b.anim, originY: 0.85, scale: 0.9 },
    swatch: 0x4e8a3e,
}));

const ROCK_DEFS: TileDef[] = ROCKS.map((r, i) => ({
    id: `rock-${i + 1}`,
    category: ['Features', 'Rocks'],
    label: `Rock ${i + 1}`,
    desc: 'A mossy boulder sitting on the grass.',
    render: { kind: 'feature', texture: r.key, originY: 0.8, scale: 1.0 },
    swatch: 0x7d7f86,
}));

const SEA_DEFS: TileDef[] = [
    ...WATER_ROCKS.map((w, i) => ({
        id: `searock-${i + 1}`,
        category: ['Features', 'Sea'],
        label: `Sea Rock ${i + 1}`,
        desc: 'A rock in the water, ringed by lapping foam. Place on water.',
        render: { kind: 'feature' as const, texture: w.key, anim: w.anim, originY: 0.5, scale: 1.0 },
        swatch: 0x3a5f72,
    })),
    {
        id: 'duck',
        category: ['Features', 'Sea'],
        label: 'Rubber Duck',
        desc: 'A cheerful rubber duck bobbing at sea. Purely decorative.',
        render: { kind: 'feature', texture: DUCK.key, anim: DUCK.anim, originY: 0.6, scale: 1.4 },
        swatch: 0xe8c84a,
    },
];

// Cliffs: the Tiny Swords elevation block (right side of the tileset). Frame indices were
// verified by scanning the PNG — rows 0–3 of cols 5–7 are the raised grass PLATEAU surface
// (row 3 = the front lip), rows 4–5 are the rock CLIFF FACE. You hand-assemble a cliff by
// painting a plateau top, its front-lip edge, then the rock face below it. These are visual
// authoring tiles; gameplay elevation (Milestone 2) is still parked.
const CLIFF_FRAMES: { frame: number; label: string; desc: string }[] = [
    { frame: 5, label: 'Plateau ◤ (top-left)', desc: 'Raised-grass plateau outer corner, top-left.' },
    { frame: 6, label: 'Plateau ▲ (top)', desc: 'Raised-grass plateau back edge.' },
    { frame: 7, label: 'Plateau ◥ (top-right)', desc: 'Raised-grass plateau outer corner, top-right.' },
    { frame: 14, label: 'Plateau ◀ (left)', desc: 'Raised-grass plateau left edge.' },
    { frame: 15, label: 'Plateau ■ (fill)', desc: 'Raised-grass plateau interior.' },
    { frame: 16, label: 'Plateau ▶ (right)', desc: 'Raised-grass plateau right edge.' },
    { frame: 32, label: 'Cliff lip ◣ (front-left)', desc: 'Front-left corner where the plateau meets the drop.' },
    { frame: 33, label: 'Cliff lip ▼ (front)', desc: 'Grassy front edge of the plateau, overhanging the cliff.' },
    { frame: 34, label: 'Cliff lip ◢ (front-right)', desc: 'Front-right corner where the plateau meets the drop.' },
    { frame: 41, label: 'Cliff face (left)', desc: 'Rock wall below the plateau, left.' },
    { frame: 42, label: 'Cliff face (middle)', desc: 'Rock wall below the plateau, middle.' },
    { frame: 43, label: 'Cliff face (right)', desc: 'Rock wall below the plateau, right.' },
    { frame: 50, label: 'Cliff base (left)', desc: 'Foot of the cliff wall, left.' },
    { frame: 51, label: 'Cliff base (middle)', desc: 'Foot of the cliff wall, middle.' },
    { frame: 52, label: 'Cliff base (right)', desc: 'Foot of the cliff wall, right.' },
    { frame: 45, label: 'Cliff column (left)', desc: 'One-tile cliff: grass on top, rock face below (left end).' },
    { frame: 48, label: 'Cliff column (right)', desc: 'One-tile cliff: grass on top, rock face below (right end).' },
];
const CLIFF_DEFS: TileDef[] = CLIFF_FRAMES.map((c) => ({
    id: `cliff-${c.frame}`,
    category: ['Ground', 'Cliffs'],
    label: c.label,
    desc: c.desc,
    // Cliffs are placed as features (overlay) so the ground shows through their transparent
    // edges. originX/Y centre the 64px frame on its cell.
    render: { kind: 'feature', texture: TILESET.key, frame: c.frame, originX: 0.5, originY: 0.5, scale: 1 },
    swatch: 0x6f8a86,
}));

export const TILE_CATALOG: TileDef[] = [
    ...GRASS_DEFS,
    ...GROUND,
    ...CLIFF_DEFS,
    ...TREE_DEFS,
    ...BUSH_DEFS,
    ...ROCK_DEFS,
    ...STUMP_DEFS,
    ...SEA_DEFS,
];

const BY_ID = new Map<TileId, TileDef>(TILE_CATALOG.map((t) => [t.id, t]));
export const getTile = (id: TileId): TileDef | undefined => BY_ID.get(id);

// ── browser navigation ──────────────────────────────────────────────────────
const startsWith = (cat: string[], path: string[]) =>
    cat.length >= path.length && path.every((p, i) => cat[i] === p);

/** The sub-folders directly under `path` (e.g. [] → ['Ground','Features']). */
export function foldersAt(path: string[]): string[] {
    const set = new Set<string>();
    for (const t of TILE_CATALOG) {
        if (t.category.length > path.length && startsWith(t.category, path)) {
            set.add(t.category[path.length]);
        }
    }
    return [...set];
}

/** The tiles that live exactly in `path` (not in a sub-folder). */
export function tilesAt(path: string[]): TileDef[] {
    return TILE_CATALOG.filter(
        (t) => t.category.length === path.length && startsWith(t.category, path),
    );
}

// ── thumbnails ──────────────────────────────────────────────────────────────
/** A small preview GameObject for `def`, fitted into a `size`×`size` box (origin centred). */
export function makeTileThumb(
    scene: Phaser.Scene,
    def: TileDef,
    size: number,
): Phaser.GameObjects.GameObject {
    const r = def.render;
    if (r.kind === 'ground') {
        return scene.add.image(0, 0, r.atlas, r.frame).setOrigin(0.5).setDisplaySize(size, size);
    }
    if (r.kind === 'water') {
        return scene.add.rectangle(0, 0, size, size, def.swatch).setOrigin(0.5);
    }
    // feature: show its frame (cliff tileset frame, animated frame 0, or whole image),
    // scaled to fit while keeping aspect.
    const img = r.frame !== undefined
        ? scene.add.image(0, 0, r.texture, r.frame)
        : r.anim
            ? scene.add.image(0, 0, r.texture, 0)
            : scene.add.image(0, 0, r.texture);
    const s = size / Math.max(img.width, img.height);
    return img.setOrigin(0.5).setScale(s);
}

export const WATER_KEY = WATER.key;
