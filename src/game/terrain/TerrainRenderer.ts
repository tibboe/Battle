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

    // Phase B: the tiered battlefield. Base grass field + one cliff drop per lane's
    // front edge, framed by a grass lip and ramp end-caps near the keeps.
    drawTieredLayout() {
        this.drawFlatField();
        for (const lane of CONFIG.lanes) this.drawLaneEdge(lane);
    }

    // The cliff + lip + ramps along one lane's front (lower) edge.
    private drawLaneEdge(lane: { y: number; thickness: number }) {
        const { world, elevation } = CONFIG;
        const ts = this.ts;
        const cliffY = lane.y + lane.thickness / 2; // plateau bottom = top of the cliff
        const lipY = cliffY - ts;                   // grass overhang one row above
        const botY = cliffY + ts;                   // lower row of the 2-tile cliff

        // Ramp end-caps sit `rampInset` in from each edge; the cliff runs between them.
        const rampL = elevation.rampInset;
        const rampR = world.width - elevation.rampInset - ts;
        const cliffL = rampL + ts;       // first cliff tile (after the left ramp)
        const cliffR = rampR;            // x where the right ramp begins

        // Grass front-lip overhang along the cliff span.
        this.tileRun(TILES.grassBottom, cliffL, cliffR, lipY, DEPTH_EDGE);

        // Cliff face: end-caps + a tiled middle run, two tiles tall.
        this.tile(TILES.cliffTopLeft, cliffL, cliffY, DEPTH_CLIFF);
        this.tile(TILES.cliffBotLeft, cliffL, botY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffTopMid, cliffL + ts, cliffR - ts, cliffY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffBotMid, cliffL + ts, cliffR - ts, botY, DEPTH_CLIFF);
        this.tile(TILES.cliffTopRight, cliffR - ts, cliffY, DEPTH_CLIFF);
        this.tile(TILES.cliffBotRight, cliffR - ts, botY, DEPTH_CLIFF);

        // Ramp visuals near each keep: the cliff slopes down to grass.
        this.tile(TILES.rampLeftTop, rampL, cliffY, DEPTH_CLIFF);
        this.tile(TILES.rampLeftBot, rampL, botY, DEPTH_CLIFF);
        this.tile(TILES.rampRightTop, rampR, cliffY, DEPTH_CLIFF);
        this.tile(TILES.rampRightBot, rampR, botY, DEPTH_CLIFF);
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

// Terrain draws below units (units use world-y as depth, ~400..1530). Ground at the
// bottom; cliffs/lips above the ground but still under every unit.
export const DEPTH_GROUND = -1000;
export const DEPTH_CLIFF = -900;
export const DEPTH_EDGE = -800;
