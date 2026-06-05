import * as Phaser from 'phaser';
import { CONFIG, ResourceType, RESOURCE_TYPES } from '../config';
import { FACTION, Faction, UnitManager } from './UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { ResourceNode, ResourceNodes } from '../economy/ResourceNodes';
import { Buildings, ConstructionSite } from '../structures/buildings';
import { peasantCarryBonus, peasantFleeBurst, peasantSpeedBonus } from '../upgrades';
import { cameraAngle } from '../controls/billboard';

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
const State = { Seek: 0, Harvest: 1, Return: 2, Bank: 3, Build: 4, Flee: 5 } as const;
type State = (typeof State)[keyof typeof State];

const RESOURCES = RESOURCE_TYPES;

interface Peasant {
    faction: Faction;
    house: number;        // index into that faction's houses (for refill accounting)
    resource: ResourceType | null; // null = idle (no assignment) — player peasants start idle
    state: State;
    x: number;
    y: number;
    sprite: Phaser.GameObjects.Sprite;
    node?: ResourceNode;
    site?: ConstructionSite; // the build job this worker is on (Build state)
    timer: number;        // ms accumulated in Harvest / Bank
    carrying: number;
    hp: number;           // workers can be cut down by a nearby enemy army (Phase 4)
    dead: boolean;        // killed this frame; pruned after the step loop
    anim: WorkerAnim;
    burst: number;        // ms of flee speed-burst remaining (peasantFlee upgrade)
    burstCd: number;      // ms until the flee burst can trigger again
    faceX: number;        // world-facing sign (+1 right / −1 left); on-screen flip derives from this
}

export class PeasantManager {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly store: ResourceStore;
    private readonly nodes: ResourceNodes;
    private readonly buildings: Buildings;
    private readonly units: UnitManager;

    private peasants: Peasant[] = [];
    private removeDead = false; // set when a worker dies, so we prune the array after stepping
    // Per faction, per house: workers alive and a refill timer used when a House is below
    // perHouse. `houseCount` tracks how many Houses we have staffed so newly built Houses get
    // picked up.
    private readonly alive: [number[], number[]] = [[], []];
    private readonly refill: [number[], number[]] = [[], []];
    private readonly houseCount: [number, number] = [0, 0];

    // Desired number of workers on each resource, per side. The player steers theirs from the
    // HUD's +/- (see adjustTarget); the enemy keeps an even split. Workers re-pick their
    // resource toward these targets each gather cycle (and immediately when a node runs dry).
    private readonly targets: [Record<ResourceType, number>, Record<ResourceType, number>] = [
        { gold: 1, wood: 1, stone: 1, food: 1 },
        { gold: 1, wood: 1, stone: 1, food: 1 },
    ];

    // Player FIFO focus queue: the HUD pushes a resource onto it; each free PLAYER peasant
    // (newly spawned or just-banked) takes the next one from the front. Empty = auto (spread
    // out, then keep). The enemy ignores this and auto-balances toward `targets`.
    private readonly focus: [ResourceType[], ResourceType[]] = [[], []];

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        store: ResourceStore,
        nodes: ResourceNodes,
        buildings: Buildings,
        units: UnitManager,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.store = store;
        this.nodes = nodes;
        this.buildings = buildings;
        this.units = units;

        // Staff the Houses each side starts with.
        for (const f of [FACTION.player, FACTION.enemy] as const) this.reconcileHouses(f);
    }

    // Pick up any newly built Houses (and staff the starting ones), filling each to perHouse.
    private reconcileHouses(faction: Faction) {
        const houses = this.buildings.housePositions(faction);
        while (this.houseCount[faction] < houses.length) {
            const h = this.houseCount[faction];
            this.alive[faction][h] = 0;
            this.refill[faction][h] = 0;
            this.houseCount[faction] = h + 1;
            for (let n = 0; n < CONFIG.peasant.perHouse; n++) this.spawn(faction, h);
        }
    }

    // ---- Resource allocation ----

    // Live worker count on each resource for a side.
    private counts(faction: Faction): Record<ResourceType, number> {
        const c: Record<ResourceType, number> = { gold: 0, wood: 0, stone: 0, food: 0 };
        for (const p of this.peasants) if (!p.dead && p.faction === faction && p.resource) c[p.resource]++;
        return c;
    }

    // The resource a free worker should take: the one most under its target (preferring ones
    // that still have live nodes); once every target is met, the least-staffed one (even split).
    private pickResource(faction: Faction): ResourceType {
        const c = this.counts(faction);
        const t = this.targets[faction];
        let cands = RESOURCES.filter((r) => this.nodes.anyLive(r));
        if (!cands.length) cands = RESOURCES; // everything drained — assign anyway, it'll idle
        let best = cands[0];
        let bestDef = -Infinity;
        for (const r of cands) {
            const def = t[r] - c[r];
            if (def > bestDef) { bestDef = def; best = r; }
        }
        if (bestDef <= 0) {
            let min = Infinity;
            for (const r of cands) if (c[r] < min) { min = c[r]; best = r; }
        }
        return best;
    }

    // The resource a free worker should take next. Player: the front of the FIFO focus queue if
    // any, else keep its current (if still live), else IDLE (null) — the player tells idle
    // peasants what to gather. Enemy: target-based auto split (never idle).
    private nextResource(faction: Faction, current?: ResourceType | null): ResourceType | null {
        if (faction === FACTION.player) {
            const q = this.focus[faction];
            if (q.length) return q.shift()!;
            if (current && this.nodes.anyLive(current)) return current;
            return null;
        }
        return this.pickResource(faction);
    }

    // Re-pick a worker's resource at the end of a trip: player pulls from its focus queue, keeps
    // its current resource if still live, else goes idle (so you reassign it); the enemy
    // converges toward targets.
    private rebalance(p: Peasant) {
        if (p.faction === FACTION.player) {
            const q = this.focus[p.faction];
            if (q.length) { p.resource = q.shift()!; p.node = undefined; return; }
            if (!p.resource || !this.nodes.anyLive(p.resource)) { p.resource = null; p.node = undefined; }
            return;
        }
        const c = this.counts(p.faction);
        if (c[p.resource as ResourceType] > this.targets[p.faction][p.resource as ResourceType] || !this.nodes.anyLive(p.resource as ResourceType)) {
            p.resource = this.pickResource(p.faction);
            p.node = undefined;
        }
    }

    // ---- Player focus queue (driven by the HUD) ----
    enqueueFocus(faction: Faction, res: ResourceType) { this.focus[faction].push(res); }
    clearFocus(faction: Faction) { this.focus[faction].length = 0; }
    focusList(faction: Faction): ResourceType[] { return this.focus[faction].slice(); }

    // Live worker count on a resource (for the HUD readout).
    workerCount(faction: Faction, res: ResourceType): number {
        return this.counts(faction)[res];
    }

    private spawn(faction: Faction, house: number) {
        const home = this.buildings.housePositions(faction)[house];
        const resource = this.nextResource(faction);

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
            hp: CONFIG.peasant.hp,
            dead: false,
            anim: 'walk',
            burst: 0,
            burstCd: 0,
            faceX: faction === FACTION.enemy ? -1 : 1,
        });
        this.alive[faction][house]++;
    }

    update(delta: number) {
        for (const f of [FACTION.player, FACTION.enemy] as const) this.reconcileHouses(f);
        this.dispatchBuilders();
        this.maintain(delta);
        const dt = delta / 1000;
        for (const p of this.peasants) if (!p.dead) this.step(p, delta, dt);
        this.applyFacing();
        if (this.removeDead) {
            this.peasants = this.peasants.filter((p) => !p.dead);
            this.removeDead = false;
        }
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
        if (p.burst > 0) p.burst -= delta;
        if (p.burstCd > 0) p.burstCd -= delta;

        // Harassment (Phase 4): a nearby enemy combat unit bleeds the worker and makes it flee.
        const threatened = this.units.threatNear(p.faction, p.x, p.y, CONFIG.peasant.dangerRadius);
        if (threatened) {
            p.hp -= CONFIG.peasant.harassDps * dt;
            if (p.hp <= 0) { this.kill(p); return; }
            if (p.state !== State.Flee) {
                // Drop the current job and run for home.
                if (p.site) { p.site.claimed = false; p.site = undefined; }
                p.node = undefined;
                p.carrying = 0;
                p.state = State.Flee;
                // Flee-burst upgrade (player): sprint away if it's off cooldown.
                if (p.faction === FACTION.player && peasantFleeBurst() && p.burstCd <= 0) {
                    p.burst = CONFIG.abilities.peasantFlee.duration;
                    p.burstCd = CONFIG.abilities.peasantFlee.cooldown;
                }
            }
        }

        switch (p.state) {
            case State.Seek: {
                // Idle (no assignment): grab the next focus ticket if one is queued, else stand
                // and wait to be told what to gather (player peasants start here).
                if (p.resource === null) {
                    const q = this.focus[p.faction];
                    if (p.faction === FACTION.player && q.length) { p.resource = q.shift()!; p.node = undefined; }
                    else { p.sprite.anims.stop(); break; }
                }
                const res = p.resource;
                if (!res) break;
                if (!p.node || !p.node.alive) {
                    // If this resource has been fully mined out, re-evaluate (player → idle).
                    if (!this.nodes.anyLive(res)) { this.rebalance(p); break; }
                    p.node = this.nodes.nearest(res, p.x, p.y);
                }
                if (!p.node) { this.setAnim(p, 'walk'); break; }
                if (this.moveTo(p, p.node.x, p.node.y, CONFIG.peasant.arrive, dt)) {
                    p.state = State.Harvest;
                    p.timer = 0;
                    this.faceTo(p, p.node.x);
                    this.setAnim(p, res === 'wood' ? 'chop' : 'mine');
                } else {
                    this.setAnim(p, 'walk');
                }
                break;
            }
            case State.Harvest: {
                if (!p.node || !p.node.alive) { p.state = State.Seek; p.node = undefined; break; }
                p.timer += delta;
                if (p.timer >= CONFIG.peasant.gatherTime) {
                    const want = CONFIG.peasant.carryAmount
                        + (p.faction === FACTION.player ? peasantCarryBonus() : 0);
                    const got = this.nodes.harvest(p.node, want);
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
                    if (p.resource) this.store.add(p.faction, p.resource, p.carrying);
                    p.carrying = 0;
                    this.rebalance(p); // converge toward the target split as workers recycle
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
            case State.Flee: {
                // Run to the Castle; once the threat has passed, get back to work.
                if (!threatened) { p.state = State.Seek; this.setAnim(p, 'walk'); break; }
                const bank = this.buildings.keepPosition(p.faction);
                this.moveTo(p, bank.x, bank.y, CONFIG.peasant.bankArrive, dt);
                this.setAnim(p, 'walk');
                break;
            }
        }
    }

    // A worker is cut down: free any build job, fade the sprite out, and let its House train a
    // replacement (the alive count drops, so maintain() refills after trainTime).
    private kill(p: Peasant) {
        if (p.dead) return;
        p.dead = true;
        this.removeDead = true;
        this.alive[p.faction][p.house]--;
        if (p.site && !p.site.done) p.site.claimed = false;
        const spr = p.sprite;
        spr.anims.stop();
        spr.setTint(0x6a6a6a);
        this.scene.tweens.add({
            targets: spr,
            alpha: 0,
            duration: CONFIG.peasant.deathFadeMs,
            onComplete: () => spr.destroy(),
        });
    }

    // Walk toward (tx, ty); returns true once within `arrive` px. Updates sprite + depth.
    private moveTo(p: Peasant, tx: number, ty: number, arrive: number, dt: number): boolean {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= arrive) return true;
        const stepDist = this.speedOf(p) * dt;
        const k = Math.min(stepDist, dist) / dist;
        p.x += dx * k;
        p.y += dy * k;
        this.faceTo(p, tx);
        p.sprite.setPosition(p.x, p.y).setDepth(p.y);
        return false;
    }

    private faceTo(p: Peasant, tx: number) {
        // Record world-facing; the on-screen flip is applied (camera-angle aware) in update().
        if (tx < p.x - 0.01) p.faceX = -1;
        else if (tx > p.x + 0.01) p.faceX = 1;
    }

    // Flip each peasant to face its world direction ON SCREEN (see UnitManager.applyFacing).
    private applyFacing() {
        const cos = Math.cos(cameraAngle(this.scene));
        for (const p of this.peasants) if (!p.dead) p.sprite.setFlipX(p.faceX * cos < 0);
    }

    // Effective walk speed: base + the player's worker-speed upgrade, ×burst while fleeing.
    private speedOf(p: Peasant): number {
        let s = CONFIG.peasant.moveSpeed;
        if (p.faction === FACTION.player) s += peasantSpeedBonus();
        if (p.burst > 0) s *= CONFIG.abilities.peasantFlee.mult;
        return s;
    }

    private setAnim(p: Peasant, anim: WorkerAnim) {
        if (p.anim === anim) return;
        p.anim = anim;
        p.sprite.play(peasantAnimKey(p.faction, anim));
    }
}
