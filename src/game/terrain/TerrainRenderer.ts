import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { TILES, TILESET } from './tileset';

// Draws the battlefield ground from the real Tiny Swords tileset (Milestone 2).
//
// Two primitives keep the object count tiny and the draws batched:
//   • TileSprite for long repeating runs (the grass fill, a cliff-face run, an
//     edge run) — one GPU-tiled object covers an arbitrary width.
//   • Image for single end-caps / corners / ramps.
// Everything is STATIC (created once in create()), drawn from one spritesheet, so
// it batches into a handful of draw calls and costs nothing per frame.
export class TerrainRenderer {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;

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
}

// Terrain draws below units (units use world-y as depth, ~200..1540). Keep ground
// well below that.
export const DEPTH_GROUND = -1000;
