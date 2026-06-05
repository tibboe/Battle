import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { TILES, TILESET } from './tileset';
import { BUSHES, CLOUDS, DUCK, FOAM, ROCKS, STUMPS, TREES, WATER, WATER_ROCKS } from './environment';

// Draws the battlefield: a flat grass ISLAND on an open sea. Bottom-up:
//   • water background tiled over the whole world,
//   • an animated foam ring along the island's coastline,
//   • the flat-ground grass island (a 4×4 autotile) the armies fight on,
//   • scatter decorations (bushes/rocks on land, water rocks/duck at sea),
//   • drifting clouds along the top/left/right edges, above the water.
// Leveling/plateaus are parked — this is a single flat plain.
export class TerrainRenderer {
    private readonly scene: Phaser.Scene;
    // The ground (water + grass island) goes on `ground`, which turns with the camera when the
    // screen is rotated. Decorations (trees, rocks, clouds) go on `deco` (the world layer) so
    // they stay upright — they are anchored to the ground but billboarded by the scene.
    private readonly ground: Phaser.GameObjects.Layer;
    private readonly deco: Phaser.GameObjects.Layer;
    private readonly ts = CONFIG.terrain.renderTile;

    // Island bounds in world px (tile-aligned), computed from the water margin.
    private islandLeft = 0;
    private islandTop = 0;
    private islandRight = 0;
    private islandBottom = 0;

    constructor(scene: Phaser.Scene, ground: Phaser.GameObjects.Layer, deco: Phaser.GameObjects.Layer) {
        this.scene = scene;
        this.ground = ground;
        this.deco = deco;
    }

    /** The grass island rectangle in world coords — used to keep units/keeps on land. */
    get island() {
        return { left: this.islandLeft, top: this.islandTop, right: this.islandRight, bottom: this.islandBottom };
    }

    // Entry point.
    draw() {
        this.computeIsland();
        this.drawWater();
        this.drawFoam();
        this.drawGrassIsland();
        this.drawDecorations();
        this.drawForest();
        this.drawClouds();
    }

    // A scattered forest filling the grass ABOVE and BELOW the marching lane: random x/y
    // (so it goes up and down and right up to the path edge), random pick of tree / stump /
    // bush, random horizontal flip, slight scale jitter, and world-y depth so nearer trees
    // overlap farther ones (and units). A clear corridor over the lane keeps the path open.
    private drawForest() {
        const rnd = Phaser.Math.RND;
        const ts = this.ts;
        const lane = CONFIG.lanes[0];
        const x0 = this.islandLeft + ts * 0.5;
        const x1 = this.islandRight - ts * 0.5;
        // Bands of grass either side of the lane corridor; trees may touch the path edge.
        const corridor = CONFIG.decorations.laneClear; // half-height of the kept-clear path
        const bands = [
            { lo: this.islandTop + ts * 0.4, hi: lane.y - corridor }, // above the lane
            { lo: lane.y + corridor, hi: this.islandBottom - ts * 0.2 }, // below the lane
        ];
        const totalH = bands.reduce((a, b) => a + Math.max(0, b.hi - b.lo), 0);
        for (const band of bands) {
            if (band.hi <= band.lo) continue;
            const count = Math.round((CONFIG.decorations.forest * (band.hi - band.lo)) / totalH);
            for (let i = 0; i < count; i++) {
                const x = rnd.between(x0, x1);
                const y = rnd.between(band.lo, band.hi);
                const roll = rnd.frac();
                if (roll < 0.6) {
                    const t = TREES[rnd.between(0, TREES.length - 1)];
                    const s = this.scene.add
                        .sprite(x, y, t.key)
                        .setOrigin(0.5, 0.92)
                        .setScale(rnd.realInRange(0.6, 0.95))
                        .setFlipX(rnd.frac() < 0.5)
                        .play(t.anim);
                    s.anims.setProgress(rnd.frac());
                    s.setDepth(y);
                    this.deco.add(s);
                } else if (roll < 0.78) {
                    const st = STUMPS[rnd.between(0, STUMPS.length - 1)];
                    const img = this.scene.add
                        .image(x, y, st.key)
                        .setOrigin(0.5, 0.92)
                        .setScale(rnd.realInRange(0.7, 0.95))
                        .setFlipX(rnd.frac() < 0.5)
                        .setDepth(y);
                    this.deco.add(img);
                } else {
                    const b = BUSHES[rnd.between(0, BUSHES.length - 1)];
                    const s = this.scene.add
                        .sprite(x, y, b.key)
                        .setOrigin(0.5, 0.85)
                        .setFlipX(rnd.frac() < 0.5)
                        .play(b.anim);
                    s.anims.setProgress(rnd.frac());
                    s.setDepth(y);
                    this.deco.add(s);
                }
            }
        }
    }

    // Snap the island to the tile grid inside the requested water margin.
    private computeIsland() {
        const { world } = CONFIG;
        const ts = this.ts;
        const margin = CONFIG.island.margin;
        this.islandLeft = Math.ceil(margin / ts) * ts;
        this.islandTop = Math.ceil(margin / ts) * ts;
        const cols = Math.floor((world.width - 2 * this.islandLeft) / ts);
        const rows = Math.floor((world.height - 2 * this.islandTop) / ts);
        this.islandRight = this.islandLeft + cols * ts;
        this.islandBottom = this.islandTop + rows * ts;
    }

    private drawWater() {
        const { world } = CONFIG;
        const sea = this.scene.add
            .tileSprite(0, 0, world.width, world.height, WATER.key)
            .setOrigin(0, 0)
            .setDepth(DEPTH_WATER);
        this.ground.add(sea);
    }

    // Animated foam ring: a foam sprite straddling every coastline cell. The inland half
    // is hidden by the grass island drawn on top; the seaward half shows as moving surf.
    // Each starts on a random frame so the coast doesn't pulse in unison.
    private drawFoam() {
        const ts = this.ts;
        const place = (cx: number, cy: number) => {
            const s = this.scene.add
                .sprite(cx, cy, FOAM.key)
                .setDepth(DEPTH_FOAM)
                .play(FOAM.anim);
            s.anims.setProgress(Math.random());
            this.ground.add(s);
        };
        // Centres of the perimeter cells (sprite origin is centre by default).
        for (let x = this.islandLeft; x < this.islandRight; x += ts) {
            place(x + ts / 2, this.islandTop + ts / 2);
            place(x + ts / 2, this.islandBottom - ts / 2);
        }
        for (let y = this.islandTop; y < this.islandBottom; y += ts) {
            place(this.islandLeft + ts / 2, y + ts / 2);
            place(this.islandRight - ts / 2, y + ts / 2);
        }
    }

    // The flat grass island as a 4×4 autotile: corners, edges, interior fill.
    private drawGrassIsland() {
        const ts = this.ts;
        const L = this.islandLeft;
        const T = this.islandTop;
        const R = this.islandRight;
        const B = this.islandBottom;

        // Interior fill (one tiled object), then the four edges and corners over it.
        const fill = this.scene.add
            .tileSprite(L, T, R - L, B - T, TILESET.key, TILES.flatFill)
            .setOrigin(0, 0)
            .setDepth(DEPTH_GROUND);
        this.ground.add(fill);

        this.runX(TILES.flatTop, L + ts, R - ts, T, DEPTH_EDGE);
        this.runX(TILES.flatBot, L + ts, R - ts, B - ts, DEPTH_EDGE);
        this.runY(TILES.flatLeft, L, T + ts, B - ts, DEPTH_EDGE);
        this.runY(TILES.flatRight, R - ts, T + ts, B - ts, DEPTH_EDGE);
        this.tile(TILES.flatTopLeft, L, T, DEPTH_EDGE);
        this.tile(TILES.flatTopRight, R - ts, T, DEPTH_EDGE);
        this.tile(TILES.flatBotLeft, L, B - ts, DEPTH_EDGE);
        this.tile(TILES.flatBotRight, R - ts, B - ts, DEPTH_EDGE);
    }

    // Scatter decorations: bushes/rocks on the grass (clear of the lane), water rocks and
    // a duck in the sea. Deterministic-ish via Phaser RNG so a session looks stable.
    private drawDecorations() {
        const ts = this.ts;
        const rnd = Phaser.Math.RND;
        const decorations = CONFIG.decorations;
        const lane = CONFIG.lanes[0];
        const laneTop = lane.y - lane.thickness / 2 - 40;
        const laneBot = lane.y + lane.thickness / 2 + 40;

        // Land scatter (bushes + rocks), kept off the marching lane and off the very edge.
        for (let i = 0; i < decorations.land; i++) {
            const x = rnd.between(this.islandLeft + ts, this.islandRight - ts);
            const y = rnd.between(this.islandTop + ts, this.islandBottom - ts);
            if (y > laneTop && y < laneBot) continue; // leave the lane clear
            if (rnd.frac() < 0.55) {
                const b = BUSHES[rnd.between(0, BUSHES.length - 1)];
                const s = this.scene.add.sprite(x, y, b.key).setOrigin(0.5, 0.8).play(b.anim);
                s.anims.setProgress(rnd.frac());
                s.setDepth(y);
                this.deco.add(s);
            } else {
                const r = ROCKS[rnd.between(0, ROCKS.length - 1)];
                const img = this.scene.add.image(x, y, r.key).setOrigin(0.5, 0.8).setDepth(y);
                this.deco.add(img);
            }
        }

        // Sea scatter (water rocks + the odd duck) in the water margin around the island.
        for (let i = 0; i < decorations.sea; i++) {
            const onSide = rnd.frac() < 0.5;
            const x = onSide
                ? (rnd.frac() < 0.5 ? rnd.between(ts, this.islandLeft - ts) : rnd.between(this.islandRight + ts, CONFIG.world.width - ts))
                : rnd.between(ts, CONFIG.world.width - ts);
            const y = onSide
                ? rnd.between(ts, CONFIG.world.height - ts)
                : (rnd.frac() < 0.5 ? rnd.between(ts, this.islandTop - ts) : rnd.between(this.islandBottom + ts, CONFIG.world.height - ts));
            if (rnd.frac() < 0.85) {
                const w = WATER_ROCKS[rnd.between(0, WATER_ROCKS.length - 1)];
                const s = this.scene.add.sprite(x, y, w.key).setDepth(DEPTH_SEADECO).play(w.anim);
                s.anims.setProgress(rnd.frac());
                this.deco.add(s);
            } else {
                const s = this.scene.add.sprite(x, y, DUCK.key).setScale(1.4).setDepth(DEPTH_SEADECO).play(DUCK.anim);
                s.anims.setProgress(rnd.frac());
                this.deco.add(s);
            }
        }
    }

    // Clouds drift over the sea along the TOP, LEFT and RIGHT edges (never the bottom).
    // Drawn above everything else so they read as overhead atmosphere.
    private drawClouds() {
        const rnd = Phaser.Math.RND;
        const { world } = CONFIG;
        const place = (x: number, y: number) => {
            const c = CLOUDS[rnd.between(0, CLOUDS.length - 1)];
            const img = this.scene.add
                .image(x, y, c.key)
                .setScale(rnd.realInRange(0.55, 0.9))
                .setAlpha(0.9)
                .setDepth(DEPTH_CLOUD);
            this.deco.add(img);
        };
        const n = CONFIG.clouds.count;
        // Top band.
        for (let i = 0; i < n; i++) place(rnd.between(0, world.width), rnd.between(0, this.islandTop));
        // Left and right bands.
        for (let i = 0; i < Math.ceil(n / 2); i++) {
            place(rnd.between(0, this.islandLeft), rnd.between(0, world.height));
            place(rnd.between(this.islandRight, world.width), rnd.between(0, world.height));
        }
    }

    // ── primitives ──
    private runX(frame: number, x0: number, x1: number, y: number, depth: number) {
        if (x1 - x0 <= 0) return;
        const run = this.scene.add
            .tileSprite(x0, y, x1 - x0, this.ts, TILESET.key, frame)
            .setOrigin(0, 0)
            .setDepth(depth);
        this.ground.add(run);
    }
    private runY(frame: number, x: number, y0: number, y1: number, depth: number) {
        const ts = this.ts;
        for (let y = y0; y < y1; y += ts) this.tile(frame, x, y, depth);
    }
    private tile(frame: number, x: number, y: number, depth: number) {
        const img = this.scene.add.image(x, y, TILESET.key, frame).setOrigin(0, 0).setDepth(depth);
        this.ground.add(img);
    }
}

// Draw order (units use world-y as depth, ~700+). Sea decorations sit just above the
// foam; clouds sit above everything.
export const DEPTH_WATER = -1000;
export const DEPTH_FOAM = -980;
export const DEPTH_GROUND = -960;
export const DEPTH_EDGE = -950;
export const DEPTH_SEADECO = -940;
export const DEPTH_CLOUD = 2_000_000;
