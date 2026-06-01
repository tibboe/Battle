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

// Load the tileset as a spritesheet (any tile addressable by frame index).
export function loadTerrainTileset(scene: Phaser.Scene) {
    scene.load.spritesheet(TILESET.key, TILESET.file, {
        frameWidth: TILESET.tileSize,
        frameHeight: TILESET.tileSize,
    });
}
