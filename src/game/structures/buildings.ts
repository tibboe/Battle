import * as Phaser from 'phaser';
import { CONFIG, laneBottom, laneTop } from '../config';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';

// Production buildings + the Castle keep, laid out on a per-side 3×3 build grid (spots
// numbered 1-9, left→right, top→bottom). The keep sits on CONFIG.grid.keepSpot; each
// production building sits on its `spot`; the remaining spots are clear, drawn as faint
// plinths and doubling as the gaps units march through. Every building emits its unit on
// its own timer (read live from config) via UnitManager.spawnAt; units spawn at their
// building's spot and funnel into the lane. The Castle is just the keep's art — its HP
// lives in the scene. Sprites sort with the units by base-y depth.

const BASE = 'assets/environment/tiny-swords/buildings';
const DIR = ['Blue Buildings', 'Red Buildings']; // indexed by faction

function buildingKey(faction: Faction, name: string) {
    return `bld-${faction}-${name}`;
}

// Every distinct building art referenced by config (keep + producers).
function buildingNames(): string[] {
    const set = new Set<string>([CONFIG.keep.art]);
    for (const b of CONFIG.production.buildings) set.add(b.art);
    return [...set];
}

export function loadBuildings(scene: Phaser.Scene) {
    for (const f of [FACTION.player, FACTION.enemy] as const) {
        for (const name of buildingNames()) {
            scene.load.image(buildingKey(f, name), encodeURI(`${BASE}/${DIR[f]}/${name}.png`));
        }
    }
}

interface Producer {
    faction: Faction;
    typeIndex: number;
    x: number;            // spawn x (the building's spot)
    y: number;            // band-clamped spawn y
    cfg: { every: number }; // the config building (read live so edits apply instantly)
    acc: number;          // accumulator
}

export class Buildings {
    private readonly units: UnitManager;
    private readonly producers: Producer[] = [];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, units: UnitManager) {
        this.units = units;
        const g = CONFIG.grid;
        const pitchX = g.cellW + g.gap;
        const pitchY = g.cellH + g.gap;
        const keepCol = (g.keepSpot - 1) % g.cols;
        const keepRow = Math.floor((g.keepSpot - 1) / g.cols);
        const laneY = CONFIG.lanes[0].y;
        const bandTop = laneTop() + 24;
        const bandBottom = laneBottom() - 24;
        const spotCount = g.cols * g.rows;

        for (const f of [FACTION.player, FACTION.enemy] as const) {
            const keepX = f === FACTION.player ? CONFIG.keep.margin : CONFIG.world.width - CONFIG.keep.margin;
            const dir = f === FACTION.player ? 1 : -1; // grid fans toward the lane
            const flip = f === FACTION.enemy;

            // World centre of a spot (1-based), relative to the keep's spot.
            const pos = (spot: number) => {
                const col = (spot - 1) % g.cols;
                const row = Math.floor((spot - 1) / g.cols);
                return {
                    x: keepX + dir * (col - keepCol) * pitchX,
                    y: laneY + (row - keepRow) * pitchY,
                };
            };

            const occupied = new Set<number>([g.keepSpot]);
            for (const b of CONFIG.production.buildings) occupied.add(b.spot);

            // Faint plinths on the clear (buildable) spots — also the unit paths.
            for (let spot = 1; spot <= spotCount; spot++) {
                if (occupied.has(spot)) continue;
                const p = pos(spot);
                const plinth = scene.add.rectangle(p.x, p.y, g.cellW, g.cellH, 0xffffff, 0.05)
                    .setOrigin(0.5, 0.5)
                    .setStrokeStyle(2, 0xffffff, 0.16)
                    .setDepth(3); // above terrain, below units (depth = world-y)
                layer.add(plinth);
            }

            // The Castle keep (HP target; HP itself is tracked by the scene).
            const kp = pos(g.keepSpot);
            this.place(scene, layer, buildingKey(f, CONFIG.keep.art), kp.x, kp.y, CONFIG.keep.scale, flip);

            // One production building per unit type, on its spot.
            for (const b of CONFIG.production.buildings) {
                const p = pos(b.spot);
                this.place(scene, layer, buildingKey(f, b.art), p.x, p.y, b.scale, flip);

                const typeIndex = CONFIG.unitTypes.findIndex((u) => u.key === b.produces);
                if (typeIndex < 0) continue; // produces an unknown unit key — skip
                this.producers.push({
                    faction: f,
                    typeIndex,
                    x: p.x,
                    y: Phaser.Math.Clamp(p.y, bandTop, bandBottom),
                    cfg: b, // live reference — editing `every` applies without a restart
                    acc: Phaser.Math.FloatBetween(0, b.every), // desync the first emit
                });
            }
        }
    }

    private place(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        key: string,
        x: number,
        y: number,
        scale: number,
        flip: boolean,
    ) {
        const s = scene.add.image(x, y, key)
            .setOrigin(0.5, 0.92) // base near the spot centre
            .setScale(scale)
            .setDepth(y) // sort with the units by base-y
            .setFlipX(flip);
        layer.add(s);
    }

    update(delta: number) {
        const scale = Math.max(0.05, CONFIG.production.rateScale); // higher = faster
        for (const p of this.producers) {
            p.acc += delta * scale;
            if (p.acc >= p.cfg.every) {
                p.acc -= p.cfg.every;
                this.units.spawnAt(p.faction, p.typeIndex, p.x, p.y);
            }
        }
    }
}
