import * as Phaser from 'phaser';

// ─────────────────────────────────────────────────────────────────────────────
// Tiny Swords terrain tileset — index → piece map
// ─────────────────────────────────────────────────────────────────────────────
//
// Source: public/assets/environment/tiny-swords/Tileset/Tilemap_color1.png
//   576 × 384 px, 64 px tiles → a 9 × 6 grid (frames 0..53, row-major:
//   frame index = row * COLUMNS + col).
//
// We only use the FLAT GROUND block (left, cols 0–3) for the water-bordered grass
// island. Its proper coastline autotile is the 3×3 in the top-left (rows 0–2, cols 0–2);
// row 3 and col 3 are thin-island STRIP variants (foam on opposite edges) and aren't
// used. (The right block holds the elevation/plateau set — parked, so not mapped here.)

export const TILESET = {
    key: 'terrain',
    file: 'assets/environment/tiny-swords/Tileset/Tilemap_color1.png',
    tileSize: 64,
    columns: 9,
    rows: 6,
    /** Colour variant: the pack ships Tilemap_color1..5 (same layout, different grass
     *  hue); swap the file above + this label to recolour. */
    variant: 'color1',
} as const;

// Named pieces → frame index. Flat Ground coastline autotile (pack "Flat Ground" 1–9).
export const TILES = {
    flatTopLeft: 0, // 1
    flatTop: 1, // 2
    flatTopRight: 2, // 3
    flatLeft: 9, // 4
    flatFill: 10, // 5  (pure interior)
    flatRight: 11, // 6
    flatBotLeft: 18, // 7
    flatBot: 19, // 8
    flatBotRight: 20, // 9
} as const;

export type TileName = keyof typeof TILES;

// The pack ships five colour variants (same 9×6 layout, different grass hue). The game uses
// color1 only, but the map editor loads all five so each can be painted as its own grass.
// Hues sampled from the interior grass frame of each PNG.
const TS_DIR = 'assets/environment/tiny-swords/Tileset';
export const TERRAIN_VARIANTS = [
    { key: TILESET.key, file: TILESET.file, label: 'Meadow', hue: 0x99b653 },
    { key: 'terrain-2', file: `${TS_DIR}/Tilemap_color2.png`, label: 'Spring', hue: 0x84ae57 },
    { key: 'terrain-3', file: `${TS_DIR}/Tilemap_color3.png`, label: 'Verdant', hue: 0x62aa63 },
    { key: 'terrain-4', file: `${TS_DIR}/Tilemap_color4.png`, label: 'Olive', hue: 0x83995e },
    { key: 'terrain-5', file: `${TS_DIR}/Tilemap_color5.png`, label: 'Teal', hue: 0x57998b },
] as const;

// Load the tileset as a spritesheet (any tile addressable by frame index).
export function loadTerrainTileset(scene: Phaser.Scene) {
    scene.load.spritesheet(TILESET.key, TILESET.file, {
        frameWidth: TILESET.tileSize,
        frameHeight: TILESET.tileSize,
    });
}

/** Load all five colour variants (editor only). Includes color1 under the 'terrain' key. */
export function loadTerrainVariants(scene: Phaser.Scene) {
    for (const v of TERRAIN_VARIANTS) {
        scene.load.spritesheet(v.key, v.file, { frameWidth: TILESET.tileSize, frameHeight: TILESET.tileSize });
    }
}
