import * as Phaser from 'phaser';
import { CONFIG, ResourceType } from '../config';
import { FACTION, Faction } from './UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { ResourceNode, ResourceNodes } from '../economy/ResourceNodes';
import { Buildings, ConstructionSite } from '../structures/buildings';

// Peasants (Milestone 4) — the repurposed Pawn, now a pure WORKER, kept deliberately apart
// from the optimized combat UnitManager. There are only a handful per side, so each is a
// plain object running a small state machine instead of the struct-of-arrays horde:
//
//   SEEK    → walk to the nearest live node of my assigned resource
//   HARVEST → stand and chop/mine for gatherTime, then pick up a load
//   RETURN  → carry the load back to my side's Castle
//   BANK    → pause briefly, deposit carryAmount into the stockpile, repeat
//   BUILD   → (Phase 2) walk to a construction site and hammer it up, then resume gathering
//
// Each House maintains up to CONFIG.peasant.perHouse workers (instantly when a House is built;
// it also trains a replacement after trainTime if one is ever lost — no losses yet). The three
// workers of a House split across gold / wood / stone. Workers never fight and (Phase 1) can't
// be harassed — that lands with the Phase-4 enemy economy. Building a new structure pulls the
// nearest worker off gathering to act as the builder (so construction costs a worker's time).
// Art is the pack's Pawn worker set (chop / mine / hammer + gold/wood carry); stone reuses the
// gold-carry strip, per the milestone's noted gap.

const BASE = 'assets/units/tiny-swords';
const FACTION_DIR = ['Blue Units', 'Red Units']; // indexed by faction

// Worker animation states. `carry-gold` doubles for stone (no stone-carry art in the pack).
type WorkerAnim = 'walk' | 'carry-gold' | 'carry-wood' | 'chop' | 'mine' | 'build';

interface Strip {
    file: string;
    frames: number;
    rate: number;
}

const STRIPS: Record<WorkerAnim, Strip> = {
    walk: { file: 'Pawn_Run.png', frames: 6, rate: 14 },
    'carry-gold': { file: 'Pawn_Run Gold.png', frames: 6, rate: 14 },
    'carry-wood': { file: 'Pawn_Run Wood.png', frames: 6, rate: 14 },
    chop: { file: 'Pawn_Interact Axe.png', frames: 6, rate: 12 },
    mine: { file: 'Pawn_Interact Pickaxe.png', frames: 6, rate: 12 },
    build: { file: 'Pawn_Interact Hammer.png', frames: 3, rate: 10 },
};

const FRAME = 192; // source px per worker frame (square), fixed by the art

const peasantAnimKey = (faction: Faction, anim: WorkerAnim) => `pe-${faction}-${anim}`;

export function loadPeasants(scene: Phaser.Scene) {
    for (const f of [FACTION.player, FACTION.enemy] as const) {
        for (const anim of Object.keys(STRIPS) as WorkerAnim[]) {
            const path = encodeURI(`${BASE}/${FACTION_DIR[f]}/Pawn/${STRIPS[anim].file}`);
            scene.load.spritesheet(peasantAnimKey(f, anim), path, { frameWidth: FRAME, frameHeight: FRAME });
        }
    }
}

export function registerPeasantAnimations(scene: Phaser.Scene) {
    for (const f of [FACTION.player, FACTION.enemy] as const) {
        for (const anim of Object.keys(STRIPS) as WorkerAnim[]) {
            const key = peasantAnimKey(f, anim);
            if (scene.anims.exists(key)) scene.anims.remove(key);
            scene.anims.create({
                key,
                frames: scene.anims.generateFrameNumbers(key, { start: 0, end: STRIPS[anim].frames - 1 }),
                frameRate: STRIPS[anim].rate,
                repeat: -1,
            });
        }
    }
}

// Plain const map (not a const enum — those are disallowed under isolatedModules).
const State = { Seek: 0, Harvest: 1, Return: 2, Bank: 3, Build: 4 } as const;
type State = (typeof State)[keyof typeof State];

// Each House's workers cycle through the resources in this order.
const ROTATION: ResourceType[] = ['gold', 'wood', 'stone'];

interface Peasant {
    faction: Faction;
    house: number;        // index into that faction's houses (for refill accounting)
    resource: ResourceType;
    state: State;
    x: number;
    y: number;
    sprite: Phaser.GameObjects.Sprite;
    node?: ResourceNode;
    site?: ConstructionSite; // the build job this worker is on (Build state)
    timer: number;        // ms accumulated in Harvest / Bank
    carrying: number;
    anim: WorkerAnim;
}

export class PeasantManager {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly store: ResourceStore;
    private readonly nodes: ResourceNodes;
    private readonly buildings: Buildings;

    private readonly peasants: Peasant[] = [];
    // Per faction, per house: workers alive, the rotation cursor, and a refill timer used when
    // a House is below perHouse. `houseCount` tracks how many Houses we have staffed so far so
    // newly built Houses get picked up.
    private readonly alive: [number[], number[]] = [[], []];
    private readonly cursor: [number[], number[]] = [[], []];
    private readonly refill: [number[], number[]] = [[], []];
    private readonly houseCount: [number, number] = [0, 0];

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        store: ResourceStore,
        nodes: ResourceNodes,
        buildings: Buildings,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.store = store;
        this.nodes = nodes;
        this.buildings = buildings;

        // Staff the Houses each side starts with.
        for (const f of [FACTION.player, FACTION.enemy] as const) this.reconcileHouses(f);
    }

    // Pick up any newly built Houses (and staff the starting ones), filling each to perHouse.
    private reconcileHouses(faction: Faction) {
        const houses = this.buildings.housePositions(faction);
        while (this.houseCount[faction] < houses.length) {
            const h = this.houseCount[faction];
            this.alive[faction][h] = 0;
            this.cursor[faction][h] = 0;
            this.refill[faction][h] = 0;
            this.houseCount[faction] = h + 1;
            for (let n = 0; n < CONFIG.peasant.perHouse; n++) this.spawn(faction, h);
        }
    }

    private spawn(faction: Faction, house: number) {
        const home = this.buildings.housePositions(faction)[house];
        const resource = ROTATION[this.cursor[faction][house] % ROTATION.length];
        this.cursor[faction][house]++;

        const jx = Phaser.Math.Between(-24, 24);
        const jy = Phaser.Math.Between(-12, 12);
        const sprite = this.scene.add
            .sprite(home.x + jx, home.y + jy, peasantAnimKey(faction, 'walk'))
            .setOrigin(0.5, CONFIG.peasant.footAnchor)
            .setScale(CONFIG.peasant.scale)
            .setDepth(home.y);
        this.layer.add(sprite);
        sprite.play(peasantAnimKey(faction, 'walk'));

        this.peasants.push({
            faction,
            house,
            resource,
            state: State.Seek,
            x: home.x + jx,
            y: home.y + jy,
            sprite,
            node: undefined,
            site: undefined,
            timer: 0,
            carrying: 0,
            anim: 'walk',
        });
        this.alive[faction][house]++;
    }

    update(delta: number) {
        for (const f of [FACTION.player, FACTION.enemy] as const) this.reconcileHouses(f);
        this.dispatchBuilders();
        this.maintain(delta);
        const dt = delta / 1000;
        for (const p of this.peasants) this.step(p, delta, dt);
    }

    // Assign the nearest free worker to any construction site that lacks a builder.
    private dispatchBuilders() {
        for (const f of [FACTION.player, FACTION.enemy] as const) {
            for (const site of this.buildings.sitesFor(f)) {
                if (site.claimed) continue;
                let best: Peasant | undefined;
                let bestD2 = Infinity;
                for (const p of this.peasants) {
                    if (p.faction !== f || p.state === State.Build) continue;
                    const dx = site.x - p.x;
                    const dy = site.y - p.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestD2) { bestD2 = d2; best = p; }
                }
                if (best) {
                    best.state = State.Build;
                    best.site = site;
                    best.node = undefined;
                    best.carrying = 0; // drops whatever it was carrying to go build
                    site.claimed = true;
                }
            }
        }
    }

    // Refill any House below perHouse (unused in Phase 1 — no losses yet).
    private maintain(delta: number) {
        for (const f of [FACTION.player, FACTION.enemy] as const) {
            for (let h = 0; h < this.houseCount[f]; h++) {
                if (this.alive[f][h] >= CONFIG.peasant.perHouse) {
                    this.refill[f][h] = 0;
                    continue;
                }
                this.refill[f][h] += delta;
                if (this.refill[f][h] >= CONFIG.peasant.trainTime) {
                    this.refill[f][h] -= CONFIG.peasant.trainTime;
                    this.spawn(f, h);
                }
            }
        }
    }

    private step(p: Peasant, delta: number, dt: number) {
        switch (p.state) {
            case State.Seek: {
                if (!p.node || !p.node.alive) p.node = this.nodes.nearest(p.resource, p.x, p.y);
                if (!p.node) {
                    // Nothing of this type left — idle in place (Phase 1 safe nodes never run out).
                    this.setAnim(p, 'walk');
                    break;
                }
                if (this.moveTo(p, p.node.x, p.node.y, CONFIG.peasant.arrive, dt)) {
                    p.state = State.Harvest;
                    p.timer = 0;
                    this.faceTo(p, p.node.x);
                    this.setAnim(p, p.resource === 'wood' ? 'chop' : 'mine');
                } else {
                    this.setAnim(p, 'walk');
                }
                break;
            }
            case State.Harvest: {
                if (!p.node || !p.node.alive) { p.state = State.Seek; p.node = undefined; break; }
                p.timer += delta;
                if (p.timer >= CONFIG.peasant.gatherTime) {
                    const got = this.nodes.harvest(p.node, CONFIG.peasant.carryAmount);
                    if (got <= 0) { p.state = State.Seek; p.node = undefined; break; }
                    p.carrying = got;
                    p.state = State.Return;
                    this.setAnim(p, p.resource === 'wood' ? 'carry-wood' : 'carry-gold');
                }
                break;
            }
            case State.Return: {
                const bank = this.buildings.keepPosition(p.faction);
                if (this.moveTo(p, bank.x, bank.y, CONFIG.peasant.bankArrive, dt)) {
                    p.state = State.Bank;
                    p.timer = 0;
                } else {
                    this.setAnim(p, p.resource === 'wood' ? 'carry-wood' : 'carry-gold');
                }
                break;
            }
            case State.Bank: {
                p.timer += delta;
                if (p.timer >= CONFIG.peasant.bankTime) {
                    this.store.add(p.faction, p.resource, p.carrying);
                    p.carrying = 0;
                    p.state = State.Seek;
                    this.setAnim(p, 'walk');
                }
                break;
            }
            case State.Build: {
                const site = p.site;
                if (!site || site.done) { p.site = undefined; p.state = State.Seek; this.setAnim(p, 'walk'); break; }
                if (this.moveTo(p, site.x, site.y, CONFIG.peasant.arrive, dt)) {
                    this.faceTo(p, site.x);
                    this.setAnim(p, 'build');
                    this.buildings.hammerSite(site, delta);
                } else {
                    this.setAnim(p, 'walk');
                }
                break;
            }
        }
    }

    // Walk toward (tx, ty); returns true once within `arrive` px. Updates sprite + depth.
    private moveTo(p: Peasant, tx: number, ty: number, arrive: number, dt: number): boolean {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= arrive) return true;
        const stepDist = CONFIG.peasant.moveSpeed * dt;
        const k = Math.min(stepDist, dist) / dist;
        p.x += dx * k;
        p.y += dy * k;
        this.faceTo(p, tx);
        p.sprite.setPosition(p.x, p.y).setDepth(p.y);
        return false;
    }

    private faceTo(p: Peasant, tx: number) {
        // Art faces right; flip when the target is to the left.
        p.sprite.setFlipX(tx < p.x);
    }

    private setAnim(p: Peasant, anim: WorkerAnim) {
        if (p.anim === anim) return;
        p.anim = anim;
        p.sprite.play(peasantAnimKey(p.faction, anim));
    }
}
