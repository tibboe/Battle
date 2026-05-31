import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { TILES, TILESET } from './tileset';

// Draws the battlefield ground from the real Tiny Swords tileset (Milestone 2).
//
// Two primitives keep the object count tiny and the draws batched:
//   • TileSprite for long repeating runs (the grass fill, a cliff-face run, a lip
//     run) — one GPU-tiled object covers an arbitrary width.
//   • Image for single end-caps / corners.
// Everything is STATIC (created once in create()), drawn from one spritesheet, so
// it batches into a handful of draw calls and costs nothing per frame.
//
// The elevation read comes entirely from CLIFF FACES drawn at lane BOUNDARIES: the
// grass is one flat field, and wherever two adjacent lanes differ in `level` we drop
// (or raise) a 2-tile cliff between them. The cliff belongs to the HIGHER lane and
// faces the lower one — drawn normally when the higher lane is on top (a downward
// drop), or vertically flipped when the higher lane is below (an upward rise). This
// is fully data-driven: change the levels in CONFIG.lanes and the terrain follows.
export class TerrainRenderer {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly ts = CONFIG.terrain.renderTile;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        this.scene = scene;
        this.layer = layer;
    }

    // Phase A step 2: prove the pipeline — tile the whole world with real grass.
    drawFlatField() {
        const { world } = CONFIG;
        const field = this.scene.add
            .tileSprite(0, 0, world.width, world.height, TILESET.key, TILES.grassFill)
            .setOrigin(0, 0)
            .setDepth(DEPTH_GROUND);
        this.layer.add(field);
    }

    // The tiered battlefield. Base grass + faked level lighting + one cliff at every
    // boundary where adjacent lanes differ in elevation, each grounded by a cast shadow.
    drawTieredLayout() {
        this.drawFlatField();
        this.drawLevelShading(); // ambient: higher levels brighter, lower darker
        for (const b of this.boundaries()) this.drawCliff(b);
        this.drawCastShadows(); // soft contact shadow each cliff throws onto the lane below
    }

    // The gap between each pair of adjacent lanes, with which side is higher. A boundary
    // only carries a cliff when the two lanes differ in level.
    private boundaries() {
        const out: { gapTop: number; flip: boolean }[] = [];
        const lanes = CONFIG.lanes;
        for (let i = 0; i < lanes.length - 1; i++) {
            const north = lanes[i];
            const south = lanes[i + 1];
            if (north.level === south.level) continue; // flat boundary — no cliff
            out.push({
                gapTop: north.y + north.thickness / 2, // bottom edge of the north band
                // `flip` when the SOUTH lane is the higher one: the cliff is a rise
                // (faces up toward the north lane) rather than a downward drop.
                flip: south.level > north.level,
            });
        }
        return out;
    }

    // Subtle per-level darkening: higher ground reads brighter, lower ground darker
    // (like real terraced ground in sun). Each lane's slab spans from the mid-gap above
    // it to the mid-gap below, so there are no untinted stripes between bands. Drawn on
    // one Graphics beneath the cliffs, so only the grass is tinted — never the cliff art.
    private drawLevelShading() {
        const { world, lanes } = CONFIG;
        const step = CONFIG.terrain.shading.levelStep;
        const maxLevel = Math.max(...lanes.map((l) => l.level));
        const g = this.scene.add.graphics().setDepth(DEPTH_SHADE);
        for (let i = 0; i < lanes.length; i++) {
            const top = i === 0 ? 0 : (lanes[i - 1].y + lanes[i - 1].thickness / 2 + lanes[i].y - lanes[i].thickness / 2) / 2;
            const bot =
                i === lanes.length - 1
                    ? world.height
                    : (lanes[i].y + lanes[i].thickness / 2 + lanes[i + 1].y - lanes[i + 1].thickness / 2) / 2;
            const darken = (maxLevel - lanes[i].level) * step;
            if (darken <= 0) continue; // the highest level stays untinted
            g.fillStyle(0x000000, darken);
            g.fillRect(0, top, world.width, bot - top);
        }
        this.layer.add(g);
    }

    // A soft shadow fading away from the foot of each cliff onto the lane below it (only
    // under the actual cliff span, not the open grass near the keeps). For a downward
    // drop the shadow falls south onto the lower lane; for an upward rise it falls north.
    private drawCastShadows() {
        const { elevation } = CONFIG;
        const { castShadowAlpha, castShadowDepth } = CONFIG.terrain.shading;
        const ts = this.ts;
        const x0 = elevation.rampInset;
        const w = CONFIG.world.width - 2 * elevation.rampInset;
        if (w <= 0) return;
        const g = this.scene.add.graphics().setDepth(DEPTH_CAST_SHADOW);
        const bands = 6;
        for (const b of this.boundaries()) {
            // Foot of the cliff, and the direction the shadow spills (away from the plateau).
            const footY = b.flip ? b.gapTop : b.gapTop + 2 * ts;
            const dir = b.flip ? -1 : 1;
            for (let s = 0; s < bands; s++) {
                const t = s / bands;
                const sliceH = castShadowDepth / bands + 1;
                const y = footY + dir * t * castShadowDepth - (dir < 0 ? sliceH : 0);
                g.fillStyle(0x000000, castShadowAlpha * (1 - t));
                g.fillRect(x0, y, w, sliceH);
            }
        }
        this.layer.add(g);
    }

    // One 2-tile cliff filling the gap [gapTop, gapTop + 2·ts]. When `flip` is false the
    // higher (north) lane drops down: grass-capped row on top, foot row below, with a
    // grass lip overhanging the plateau above. When `flip` is true the higher (south)
    // lane rises up: the rows are swapped and flipped vertically (foot at the top, grass
    // crest at the bottom), with a grass back-fringe on the plateau below.
    private drawCliff(b: { gapTop: number; flip: boolean }) {
        const ts = this.ts;
        const L = CONFIG.elevation.rampInset;
        const R = CONFIG.world.width - CONFIG.elevation.rampInset;
        const topY = b.gapTop;
        const botY = b.gapTop + ts;

        if (!b.flip) {
            this.cliffRow(L, R, topY, TILES.cliffTopLeft, TILES.cliffTopMid, TILES.cliffTopRight, false);
            this.cliffRow(L, R, botY, TILES.cliffBotLeft, TILES.cliffBotMid, TILES.cliffBotRight, false);
            this.grassEdge(L, R, b.gapTop - ts, false); // lip overhang on the plateau above
        } else {
            this.cliffRow(L, R, topY, TILES.cliffBotLeft, TILES.cliffBotMid, TILES.cliffBotRight, true);
            this.cliffRow(L, R, botY, TILES.cliffTopLeft, TILES.cliffTopMid, TILES.cliffTopRight, true);
            this.grassEdge(L, R, b.gapTop + 2 * ts, true); // back-fringe on the plateau below
        }
    }

    // A row of the cliff face: rounded left cap + tiled middle run + rounded right cap.
    private cliffRow(L: number, R: number, y: number, left: number, mid: number, right: number, flip: boolean) {
        const ts = this.ts;
        this.tile(left, L, y, DEPTH_CLIFF, flip);
        this.tileRun(mid, L + ts, R - ts, y, DEPTH_CLIFF, flip);
        this.tile(right, R - ts, y, DEPTH_CLIFF, flip);
    }

    // The grass edge framing a cliff: the front-lip overhang (flip=false) above a drop,
    // or the bushy back-fringe (flip=true) at the top of a rise — each rounded at the ends.
    private grassEdge(L: number, R: number, y: number, back: boolean) {
        const ts = this.ts;
        const [l, m, r] = back
            ? [TILES.grassTopLeft, TILES.grassTop, TILES.grassTopRight]
            : [TILES.grassBottomLeft, TILES.grassBottom, TILES.grassBottomRight];
        this.tile(l, L, y, DEPTH_EDGE, false);
        this.tileRun(m, L + ts, R - ts, y, DEPTH_EDGE, false);
        this.tile(r, R - ts, y, DEPTH_EDGE, false);
    }

    // ── primitives ──

    // A horizontal run of one tile frame from x0..x1 at row-top y (single GPU object).
    private tileRun(frame: number, x0: number, x1: number, y: number, depth: number, flipY = false) {
        const w = x1 - x0;
        if (w <= 0) return;
        const run = this.scene.add
            .tileSprite(x0, y, w, this.ts, TILESET.key, frame)
            .setOrigin(0, 0)
            .setFlipY(flipY)
            .setDepth(depth);
        this.layer.add(run);
    }

    private tile(frame: number, x: number, y: number, depth: number, flipY = false) {
        const img = this.scene.add
            .image(x, y, TILESET.key, frame)
            .setOrigin(0, 0)
            .setFlipY(flipY)
            .setDepth(depth);
        this.layer.add(img);
    }
}

// Terrain draws below units (units use world-y as depth, ~400..1530). Layered low→high:
// ground, level shade (tints grass only), cliffs, cast shadows, grass lip — all under
// every unit and the keeps.
export const DEPTH_GROUND = -1000;
export const DEPTH_SHADE = -960;
export const DEPTH_CLIFF = -900;
export const DEPTH_CAST_SHADOW = -850;
export const DEPTH_EDGE = -800;
