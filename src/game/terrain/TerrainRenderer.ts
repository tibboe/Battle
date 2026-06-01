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
            if (b.flip) continue; // rise edges have no stone cliff to cast a shadow
            // Foot of the 1-tile ground cliff, and the direction the shadow spills south.
            const footY = b.gapTop + ts;
            const dir = 1;
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

    // A boundary where the two lanes differ in level. The pack only draws stone cliffs
    // that FACE THE VIEWER (a downward drop), so we treat the two directions differently:
    //   • DROP (flip=false, higher lane on top): a 2-tile stone cliff fills the gap, its
    //     left/right ENDS replaced by the pack's grassy sloped-corner pieces so the
    //     plateau ramps down to the ground at its ends instead of stopping at a hard
    //     wall. A grass lip overhangs on the plateau above.
    //   • RISE (flip=true, higher lane below): there is no upward-facing stone tile, so we
    //     don't fake one — the raised plateau's back edge is capped with a grass
    //     back-fringe and the elevation reads from that fringe plus the level shading.
    private drawCliff(b: { gapTop: number; flip: boolean }) {
        const ts = this.ts;
        const L = CONFIG.elevation.rampInset;
        const R = CONFIG.world.width - CONFIG.elevation.rampInset;
        const topY = b.gapTop;
        const botY = b.gapTop + ts;

        if (b.flip) {
            // Up-slope edge of the plateau below: grass back-fringe only, no stone.
            this.grassEdge(L, R, b.gapTop + 2 * ts, true);
            return;
        }

        // Front drop, GROUND style: only the grass-capped stone cliff TOP row (frames
        // 41/42/43). The pack's lower cliff row + the diagonal slope ends carry a watery
        // foam base (they're the water-island pieces), so we leave them out on our
        // landlocked field — this is a clean 1-tile ground cliff with rounded stone ends.
        this.tile(TILES.cliffTopLeft, L, topY, DEPTH_CLIFF);
        this.tileRun(TILES.cliffTopMid, L + ts, R - ts, topY, DEPTH_CLIFF);
        this.tile(TILES.cliffTopRight, R - ts, topY, DEPTH_CLIFF);
        // Grass lip overhanging the cliff top, rounded at both ends.
        this.grassEdge(L, R, b.gapTop - ts, false);
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
