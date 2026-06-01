import * as Phaser from 'phaser';

// ─────────────────────────────────────────────────────────────────────────────
// Tiny Swords terrain tileset — index → piece map  (Milestone 2, Phase A step 1)
// ─────────────────────────────────────────────────────────────────────────────
//
// Source: public/assets/environment/tiny-swords/Tileset/Tilemap_color1.png
//   576 × 384 px, 64 px tiles → a 9 × 6 grid (frames 0..53, row-major:
//   frame index = row * COLUMNS + col).
//
// The sheet holds TWO autotile blocks (the gap column 4 is blank):
//
//   • LEFT block  (cols 0–3): a self-contained grass "island" — grass with a
//     leafy/bushy fringe on ALL sides, plus two diagonal RAMP/sloped-end pieces
//     in the bottom rows.
//   • RIGHT block (cols 5–8): a grass PLATEAU that drops away on its lower edge
//     into a 2-tile-tall stone CLIFF FACE. This is the elevation set M2 is built
//     on (grass on top, cliff below).
//
// We catalogued every cell by edge-opacity + grass/cliff colour content and by
// eye (see the annotated sheet generated during Phase A). The named pieces below
// are what the renderer asks for; nothing else needs to know raw frame numbers.
//
//        col:  0    1    2    3    4    5    6    7    8
//   row 0:     g    g    g    g    .    GTL  GT   GT   GTR     ← grass top edge
//   row 1:     g    g    g    g    .    GL   GC   GC   GR      ← grass fill
//   row 2:     g    g    g    g    .    GL   GC   GC   GR      ← grass fill
//   row 3:     g    g    g    g    .    GBL  GB   GB   GBR     ← grass front lip
//   row 4:    RLt    .    .   RRt   .   CLt  CMt  CRt  CNt     ← cliff face (upper)
//   row 5:    RLb    .    .   RRb   .   CLb  CMb  CRb  CNb     ← cliff face (lower)
//
//   (g = left-block grass variants; G* = right-block grass autotile;
//    C* = cliff face;  R* = ramp ends)

// Tileset image / Phaser load metadata. One spritesheet, frames addressed by index.
export const TILESET = {
    key: 'terrain',
    file: 'assets/environment/tiny-swords/Tileset/Tilemap_color1.png',
    tileSize: 64,
    columns: 9,
    rows: 6,
    /** Colour variant in use. The pack ships Tilemap_color1..5 (same layout,
     *  different grass hue); swap the file above + this label to recolour. */
    variant: 'color1',
} as const;

// Named pieces → frame index. These are the only frames the renderer references.
// Grouped by role so authoring a plateau reads like ASCII art.
export const TILES = {
    // ── Flat Ground — the water-bordered grass island (left block) ──
    // The proper coastline autotile is the 3×3 in the top-left (rows 0–2, cols 0–2);
    // row 3 and col 3 are thin-island STRIP variants (foam on opposite edges) and must
    // NOT be used as the island edge. Maps to the pack's "Flat Ground" numbers 1–9.
    flatTopLeft: 0, // 1
    flatTop: 1, // 2
    flatTopRight: 2, // 3
    flatLeft: 9, // 4
    flatFill: 10, // 5  (pure interior)
    flatRight: 11, // 6
    flatBotLeft: 18, // 7
    flatBot: 19, // 8
    flatBotRight: 20, // 9

    // ── Grass plateau surface — a 3×3 autotile (right block, cols 5–8) ──
    // Corners + edges wrap a repeatable centre fill. The BOTTOM edge is the
    // "front lip" that overhangs a cliff face; the TOP edge is the back fringe.
    grassTopLeft: 5,
    grassTop: 6,
    grassTopRight: 8,
    grassLeft: 14,
    grassFill: 15, // pure interior (no fringe) — the repeatable centre
    grassRight: 17,
    grassBottomLeft: 32,
    grassBottom: 33, // front lip that sits on top of a cliff face
    grassBottomRight: 35,

    // Optional interior/edge variants for breaking up tiling repetition.
    grassFillAlt: [16, 24, 25] as readonly number[],
    grassTopAlt: 7,

    // ── Stone cliff face below a plateau's front lip (right block, rows 4–5) ──
    // The face is 2 tiles tall: an upper row (meets the grass) and a lower row
    // (fades to the ground). "Narrow" is a self-contained 1-tile-wide column.
    cliffTopLeft: 41,
    cliffTopMid: 42,
    cliffTopRight: 43,
    cliffTopNarrow: 44,
    cliffBotLeft: 50,
    cliffBotMid: 51,
    cliffBotRight: 52,
    cliffBotNarrow: 53,

    // ── Stairs (left block, bottom rows) ──
    // The pack's STAIRS: grass-topped steps that connect lower ground up onto an
    // Elevated Ground plateau (the diagonal pieces labelled "Stairs" in the guide).
    // Each is 1 tile wide, 2 tiles tall; left/right variants for each side.
    stairLeftTop: 36, // left-side stair (top half: grass lip)
    stairLeftBot: 45, // left-side stair (bottom half: stone steps)
    stairRightTop: 39, // right-side stair (mirror)
    stairRightBot: 48,
} as const;

export type TileName = keyof typeof TILES;

// The Shadow sprite (separate PNG): a soft dark blob the guide places UNDER each
// Elevated Ground layer, offset one tile downward, to fake height. Loaded as a plain
// image; the renderer stretches/places it beneath the plateau.
export const SHADOW = {
    key: 'terrain-shadow',
    file: 'assets/environment/tiny-swords/Tileset/Shadow.png',
} as const;

// Load the tileset as a spritesheet (any tile addressable by frame index) + the Shadow.
export function loadTerrainTileset(scene: Phaser.Scene) {
    scene.load.spritesheet(TILESET.key, TILESET.file, {
        frameWidth: TILESET.tileSize,
        frameHeight: TILESET.tileSize,
    });
    scene.load.image(SHADOW.key, SHADOW.file);
}
