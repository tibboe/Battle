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

    // The raised plateau in the left-centre of the lane. Built bottom-up in the pack's
    // layer order so the height illusion reads: Shadow (offset down) → plateau grass on
    // top of it → front cliff → grass lip/fringe → stairs.
    private drawPlateau() {
        const p = CONFIG.plateau;
        if (!p) return;
        const ts = this.ts;
        const lane = CONFIG.lanes[0];
        const x0 = p.x0;
        const x1 = p.x1;
        const top = lane.y - lane.thickness / 2; // north edge (back of the plateau)
        const cliffY = lane.y + lane.thickness / 2; // south edge — top row of the cliff
        const w = x1 - x0;

        // 1) Shadow: a soft dark blob under the plateau footprint, shifted one tile DOWN
        //    so it peeks out below the front cliff and sells the height (guide's method).
        const shadow = this.scene.add
            .image(x0, top + ts, SHADOW.key)
            .setOrigin(0, 0)
            .setDepth(DEPTH_SHADOW)
            .setAlpha(0.5);
        shadow.setDisplaySize(w, cliffY - top);
        this.layer.add(shadow);

        // 2) Plateau grass laid OPAQUE on top of the shadow (so the shadow only peeks out
        //    around/below it), nudged a touch brighter to read as higher ground.
        const grass = this.scene.add
            .tileSprite(x0, top, w, cliffY - top, TILESET.key, TILES.grassFill)
            .setOrigin(0, 0)
            .setDepth(DEPTH_PLATEAU);
        this.layer.add(grass);
        const lift = this.scene.add.graphics().setDepth(DEPTH_PLATEAU + 1);
        lift.fillStyle(0xffffff, 0.06).fillRect(x0, top, w, cliffY - top);
        this.layer.add(lift);

        // 3) Front (south) cliff: the grass-capped stone TOP row only — a clean ground
        //    cliff with no watery foam base — with rounded stone ends.
        this.tile(TILES.cliffTopLeft, x0, cliffY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffTopMid, x0 + ts, x1 - ts, cliffY, DEPTH_CLIFF);
        this.tile(TILES.cliffTopRight, x1 - ts, cliffY, DEPTH_CLIFF);

        // 4) Grass framing: a lip overhanging the cliff top, and a bushy back-fringe along
        //    the north edge, both rounded at the ends.
        this.grassEdge(x0, x1, cliffY - ts, false); // front lip on top of the cliff
        this.grassEdge(x0, x1, top, true); // back-fringe along the north edge

        // 5) Stairs: the pack's stair pieces (2 tiles tall) set into the cliff — the "up"
        //    stair at the left end, the "down" stair at the right/middle end.
        this.stair(TILES.stairLeftTop, TILES.stairLeftBot, x0, cliffY - ts);
        this.stair(TILES.stairRightTop, TILES.stairRightBot, x1 - ts, cliffY - ts);
    }

    // A 2-tile-tall stair (grass-topped steps) at column x, top tile at row-top y.
    private stair(topFrame: number, botFrame: number, x: number, y: number) {
        this.tile(topFrame, x, y, DEPTH_STAIR);
        this.tile(botFrame, x, y + this.ts, DEPTH_STAIR);
    }

    // The grass edge framing the plateau: the front-lip overhang (back=false) above the
    // cliff, or the bushy back-fringe (back=true) at the north edge — rounded at the ends.
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
