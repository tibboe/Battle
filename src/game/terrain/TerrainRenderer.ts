import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { SHADOW, TILES, TILESET } from './tileset';

// Draws the battlefield ground from the real Tiny Swords tileset (Milestone 2, rebuild).
//
// The world is one flat grass field. A single raised PLATEAU sits in the left-centre of
// the lane (CONFIG.plateau): the pack's layering is followed — a Shadow blob placed
// under the elevated ground and shifted one tile DOWN for depth, the plateau grass laid
// opaque on top of it, a grass-capped stone CLIFF dropping off the front (south) edge,
// a grass fringe/lip framing it, and STAIRS (the pack's stair pieces) at the left end
// (up from the flat) and the right/middle end (down to the flat).
//
// Primitives keep the draw count tiny and static: TileSprite for repeating runs, Image
// for single tiles. Everything is created once; nothing updates per frame.
export class TerrainRenderer {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly ts = CONFIG.terrain.renderTile;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        this.scene = scene;
        this.layer = layer;
    }

    // Tile the whole world with flat grass.
    drawFlatField() {
        const { world } = CONFIG;
        const field = this.scene.add
            .tileSprite(0, 0, world.width, world.height, TILESET.key, TILES.grassFill)
            .setOrigin(0, 0)
            .setDepth(DEPTH_GROUND);
        this.layer.add(field);
    }

    // Entry point: flat field + the single raised plateau with stairs.
    drawTieredLayout() {
        this.drawFlatField();
        this.drawPlateau();
    }

    // The raised level: ONE platform in the left-centre of the lane, read left→right as
    // STAIR UP → OPEN CLIFF → STAIR DOWN, exactly as the level rule says. No side/back
    // walls — just the platform's front edge, with a Shadow under it for height.
    private drawPlateau() {
        const p = CONFIG.plateau;
        if (!p) return;
        const ts = this.ts;
        const lane = CONFIG.lanes[0];
        const x0 = p.x0;
        const x1 = p.x1;
        const top = lane.y - lane.thickness / 2; // back of the platform
        const cliffY = lane.y + lane.thickness / 2; // front edge — the cliff/stair row
        const w = x1 - x0;

        // 1) Shadow under the platform footprint, shifted one cell DOWN (guide's method),
        //    so it peeks out below the front edge and reads as height.
        const shadow = this.scene.add
            .image(x0, top + ts, SHADOW.key)
            .setOrigin(0, 0)
            .setDepth(DEPTH_SHADOW)
            .setAlpha(0.5);
        shadow.setDisplaySize(w, cliffY - top);
        this.layer.add(shadow);

        // 2) Platform grass laid opaque on top of the shadow, a touch brighter (higher
        //    ground), with a light bushy back-fringe so the top edge isn't a hard seam.
        const grass = this.scene.add
            .tileSprite(x0, top, w, cliffY - top, TILESET.key, TILES.grassFill)
            .setOrigin(0, 0)
            .setDepth(DEPTH_PLATEAU);
        this.layer.add(grass);
        const lift = this.scene.add.graphics().setDepth(DEPTH_PLATEAU + 1);
        lift.fillStyle(0xffffff, 0.06).fillRect(x0, top, w, cliffY - top);
        this.layer.add(lift);
        this.grassEdge(x0, x1, top, true);

        // 3) Front edge, left→right: one STAIR (up), the OPEN CLIFF, one STAIR (down).
        //    A staircase is exactly two tiles wide (left wall + right wall, steps meeting
        //    in the centre) — there is no middle stair piece in the pack.
        const sw = 2 * ts; // one staircase
        const cl = x0 + sw; // open cliff starts after the up-stair
        const cr = x1 - sw; // …and ends before the down-stair
        this.tile(TILES.cliffTopLeft, cl, cliffY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffTopMid, cl + ts, cr - ts, cliffY, DEPTH_CLIFF);
        this.tile(TILES.cliffTopRight, cr - ts, cliffY, DEPTH_CLIFF);
        this.stair(x0, cliffY - ts); // up, at the left end
        this.stair(cr, cliffY - ts); // down, at the right end
    }

    // One staircase: two tiles wide (left wall, right wall) by two tiles tall (grass top,
    // stone steps). The steps row sits at the cliff line; the grass top sits on the platform.
    private stair(x: number, yTop: number) {
        const ts = this.ts;
        this.tile(TILES.stairLeftTop, x, yTop, DEPTH_STAIR); // left wall of the staircase
        this.tile(TILES.stairLeftBot, x, yTop + ts, DEPTH_STAIR);
        this.tile(TILES.stairRightTop, x + ts, yTop, DEPTH_STAIR); // right wall; steps meet centre
        this.tile(TILES.stairRightBot, x + ts, yTop + ts, DEPTH_STAIR);
    }
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

// Terrain draws below units (units use world-y as depth, ~760..1140). Layered low→high:
// ground field, plateau shadow, plateau grass, cliff, grass edge/lip, stairs.
export const DEPTH_GROUND = -1000;
export const DEPTH_SHADOW = -970;
export const DEPTH_PLATEAU = -955;
export const DEPTH_CLIFF = -900;
export const DEPTH_EDGE = -850;
export const DEPTH_STAIR = -840;
