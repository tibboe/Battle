import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { TILES, TILESET } from './tileset';

// Draws the battlefield ground from the real Tiny Swords tileset (Milestone 2).
//
// Two primitives keep the object count tiny and the draws batched:
//   • TileSprite for long repeating runs (the grass fill, a cliff-face run, a lip
//     run) — one GPU-tiled object covers an arbitrary width.
//   • Image for single end-caps / corners / ramps.
// Everything is STATIC (created once in create()), drawn from one spritesheet, so
// it batches into a handful of draw calls and costs nothing per frame.
//
// The "stacked plateau" read comes entirely from the CLIFF FACES: the grass is one
// flat field, and each lane's front (lower) edge drops a 2-tile cliff to the lane
// below, with a grassy front-lip overhang on top and ramp end-caps near the keeps.
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

    // Phase B: the tiered battlefield. Base grass field + faked terrace lighting +
    // one cliff drop per lane's front edge, framed by a grass lip and ramp end-caps.
    drawTieredLayout() {
        this.drawFlatField();
        this.drawTerraceShading(); // ambient: lower levels darker
        for (const lane of CONFIG.lanes) this.drawLaneEdge(lane);
        this.drawCastShadows(); // contact shadow each cliff throws on the level below
    }

    // Subtle stepped darkening: each terrace (the slab between two cliff lines) is a
    // little darker than the one above it, reading as descending ground. Drawn on one
    // Graphics, beneath the cliffs, so only the grass is tinted — never the cliff art.
    private drawTerraceShading() {
        const { world, lanes } = CONFIG;
        const step = CONFIG.terrain.shading.levelStep;
        // Terrace boundaries are the cliff lines (each lane's front edge), sorted.
        const cliffs = lanes.map((l) => l.y + l.thickness / 2).sort((a, b) => a - b);
        const bounds = [0, ...cliffs, world.height];
        const g = this.scene.add.graphics().setDepth(DEPTH_SHADE);
        // Slab i spans bounds[i]..bounds[i+1]; the top slab (i=0) stays untinted.
        for (let i = 1; i < bounds.length - 1; i++) {
            g.fillStyle(0x000000, step * i);
            g.fillRect(0, bounds[i], world.width, bounds[i + 1] - bounds[i]);
        }
        this.layer.add(g);
    }

    // A soft shadow fading downward from the base of each cliff onto the terrace below
    // (only under the actual cliff span, not the ramps). One Graphics, many rects.
    private drawCastShadows() {
        const { lanes, elevation } = CONFIG;
        const { castShadowAlpha, castShadowDepth } = CONFIG.terrain.shading;
        const ts = this.ts;
        const x0 = elevation.rampInset;
        const w = CONFIG.world.width - 2 * elevation.rampInset;
        if (w <= 0) return;
        const g = this.scene.add.graphics().setDepth(DEPTH_CAST_SHADOW);
        const bands = 6;
        for (const lane of lanes) {
            const baseY = lane.y + lane.thickness / 2 + 2 * ts; // foot of the 2-tile cliff
            for (let s = 0; s < bands; s++) {
                const t = s / bands;
                g.fillStyle(0x000000, castShadowAlpha * (1 - t));
                g.fillRect(x0, baseY + t * castShadowDepth, w, castShadowDepth / bands + 1);
            }
        }
        this.layer.add(g);
    }

    // The cliff + grass lip along one lane's front (lower) edge. The cliff runs across
    // the middle and stops `rampInset` short of each keep, leaving open grass there as the
    // implied "way up" — the Tiny Swords sheet has no true ramp-to-lower-level tile, so a
    // clean cliff end reads better than faking one (real ramp crossings are M3).
    private drawLaneEdge(lane: { y: number; thickness: number }) {
        const { world, elevation } = CONFIG;
        const ts = this.ts;
        const cliffY = lane.y + lane.thickness / 2; // plateau bottom = top of the cliff
        const lipY = cliffY - ts;                   // grass overhang one row above
        const botY = cliffY + ts;                   // lower row of the 2-tile cliff

        const cliffL = elevation.rampInset;                 // left end of the cliff
        const cliffR = world.width - elevation.rampInset;   // right end (exclusive)

        // Grass front-lip overhang, rounded at both ends to match the cliff caps.
        this.tile(TILES.grassBottomLeft, cliffL, lipY, DEPTH_EDGE);
        this.tileRun(TILES.grassBottom, cliffL + ts, cliffR - ts, lipY, DEPTH_EDGE);
        this.tile(TILES.grassBottomRight, cliffR - ts, lipY, DEPTH_EDGE);

        // Cliff face: rounded end-caps + a tiled middle run, two tiles tall.
        this.tile(TILES.cliffTopLeft, cliffL, cliffY, DEPTH_CLIFF);
        this.tile(TILES.cliffBotLeft, cliffL, botY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffTopMid, cliffL + ts, cliffR - ts, cliffY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffBotMid, cliffL + ts, cliffR - ts, botY, DEPTH_CLIFF);
        this.tile(TILES.cliffTopRight, cliffR - ts, cliffY, DEPTH_CLIFF);
        this.tile(TILES.cliffBotRight, cliffR - ts, botY, DEPTH_CLIFF);
    }

    // ── primitives ──

    // A horizontal run of one tile frame from x0..x1 at row-top y (single GPU object).
    private tileRun(frame: number, x0: number, x1: number, y: number, depth: number) {
        const w = x1 - x0;
        if (w <= 0) return;
        const run = this.scene.add
            .tileSprite(x0, y, w, this.ts, TILESET.key, frame)
            .setOrigin(0, 0)
            .setDepth(depth);
        this.layer.add(run);
    }

    private tile(frame: number, x: number, y: number, depth: number) {
        const img = this.scene.add.image(x, y, TILESET.key, frame).setOrigin(0, 0).setDepth(depth);
        this.layer.add(img);
    }
}

// Terrain draws below units (units use world-y as depth, ~400..1530). Layered low→high:
// ground, terrace shade (tints grass only), cliffs, cast shadows, grass lip — all under
// every unit and the keeps.
export const DEPTH_GROUND = -1000;
export const DEPTH_SHADE = -960;
export const DEPTH_CLIFF = -900;
export const DEPTH_CAST_SHADOW = -850;
export const DEPTH_EDGE = -800;
