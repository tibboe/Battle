import * as Phaser from 'phaser';
import { CONFIG, laneBottom, laneTop } from '../config';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';

// Production buildings + the Castle keep, drawn from the pack's building art. Each side
// fields one building per unit type (see CONFIG.production.buildings); every building emits
// its unit on its own timer by calling UnitManager.spawnAt. The Castle is just the keep's
// art — its HP lives in the scene. Buildings sort with the units by base-y depth.

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
    x: number;      // where the unit musters (the keep front)
    y: number;      // band-clamped spawn y, biased to the building's position
    every: number;  // ms between emits
    acc: number;    // accumulator
}

export class Buildings {
    private readonly units: UnitManager;
    private readonly producers: Producer[] = [];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, units: UnitManager) {
        this.units = units;
        const laneY = CONFIG.lanes[0].y;
        const bandTop = laneTop() + 24;
        const bandBottom = laneBottom() - 24;

        for (const f of [FACTION.player, FACTION.enemy] as const) {
            const keepX = f === FACTION.player ? CONFIG.keep.margin : CONFIG.world.width - CONFIG.keep.margin;
            const flip = f === FACTION.enemy; // mirror the enemy cluster

            // The Castle keep (HP target; HP itself is tracked by the scene).
            this.place(scene, layer, buildingKey(f, CONFIG.keep.art), keepX, laneY, CONFIG.keep.scale, flip);

            // One production building per unit type.
            for (const b of CONFIG.production.buildings) {
                const bx = f === FACTION.player ? keepX + b.dx : keepX - b.dx;
                const by = laneY + b.dy;
                this.place(scene, layer, buildingKey(f, b.art), bx, by, b.scale, flip);

                const typeIndex = CONFIG.unitTypes.findIndex((u) => u.key === b.produces);
                if (typeIndex < 0) continue; // produces an unknown unit key — skip
                this.producers.push({
                    faction: f,
                    typeIndex,
                    x: keepX, // units enter at the keep front for consistent marching
                    y: Phaser.Math.Clamp(by, bandTop, bandBottom),
                    every: b.every,
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
            .setOrigin(0.5, 0.92) // base near the placement point
            .setScale(scale)
            .setDepth(y) // sort with the units by base-y
            .setFlipX(flip);
        layer.add(s);
    }

    update(delta: number) {
        const scale = Math.max(0.05, CONFIG.production.rateScale); // higher = faster
        for (const p of this.producers) {
            p.acc += delta * scale;
            if (p.acc >= p.every) {
                p.acc -= p.every;
                this.units.spawnAt(p.faction, p.typeIndex, p.x, p.y);
            }
        }
    }
}
