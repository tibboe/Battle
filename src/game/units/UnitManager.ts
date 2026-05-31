import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { ANIM, MELEE_KEY } from './animations';

// Data-oriented horde with sprite pooling + neighbour-based combat (Milestone 1
// architecture requirements).
//
//  - Units are plain records in parallel typed arrays (struct-of-arrays), kept compact
//    via swap-remove. No per-unit class instances, no per-unit update loop.
//  - A fixed pool of sprites is created ONCE up front; spawning borrows one and exit/
//    death returns it. Nothing is created or destroyed mid-battle.
//  - Movement is plain position maths along the lane; no physics bodies.
//  - Targeting buckets units by lane position and only tests nearby cells — never an
//    all-pairs O(n^2) scan. Targets are re-acquired a few times a second, not per frame.

export const FACTION = { player: 0, enemy: 1 } as const;
export type Faction = (typeof FACTION)[keyof typeof FACTION];

const STATE = { walk: 0, attack: 1, dying: 2 } as const;

export class UnitManager {
    private readonly capacity: number;

    // Number of active slots (includes dying units still playing their death anim).
    private count = 0;
    // Living (non-dying) units per faction — drives the spawn cap.
    private livingByFaction: [number, number] = [0, 0];

    // Struct-of-arrays. Index i refers to one active unit across all of these.
    private readonly x: Float32Array;
    private readonly y: Float32Array;
    private readonly speed: Float32Array;
    private readonly hp: Int16Array;
    private readonly faction: Uint8Array;
    private readonly state: Uint8Array;
    private readonly target: Int32Array;     // index of current enemy, or -1
    private readonly attackCd: Float32Array; // ms until next strike
    private readonly deathTimer: Float32Array; // ms left of death anim before recycle
    private readonly sprites: (Phaser.GameObjects.Sprite | undefined)[];

    // Pool + spawn cadence.
    private readonly freeSprites: Phaser.GameObjects.Sprite[] = [];
    private readonly spawnAcc: [number, number] = [0, 0];
    private reacquireAcc = 0;

    // Targeting buckets (reused each acquire to avoid allocation).
    private readonly cellSize: number;
    private readonly numCells: number;
    private readonly buckets: number[][];

    private readonly playerKeepX: number;
    private readonly enemyKeepX: number;
    private readonly deathDuration: number;

    // Called when a unit reaches the opposing keep (so the scene can damage it).
    private readonly onReachKeep: (attacker: Faction) => void;

    constructor(scene: Phaser.Scene, onReachKeep: (attacker: Faction) => void) {
        this.onReachKeep = onReachKeep;
        this.capacity = CONFIG.spawn.unitsTarget.player + CONFIG.spawn.unitsTarget.enemy + 40;

        this.x = new Float32Array(this.capacity);
        this.y = new Float32Array(this.capacity);
        this.speed = new Float32Array(this.capacity);
        this.hp = new Int16Array(this.capacity);
        this.faction = new Uint8Array(this.capacity);
        this.state = new Uint8Array(this.capacity);
        this.target = new Int32Array(this.capacity);
        this.attackCd = new Float32Array(this.capacity);
        this.deathTimer = new Float32Array(this.capacity);
        this.sprites = new Array(this.capacity);

        // Build the whole sprite pool once. These never get destroyed.
        for (let i = 0; i < this.capacity; i++) {
            const s = scene.add.sprite(0, 0, MELEE_KEY)
                .setOrigin(0.5, 1) // feet on the lane line (ASSET_SPEC §4)
                .setScale(CONFIG.unit.renderScale)
                .setActive(false)
                .setVisible(false);
            this.freeSprites.push(s);
        }

        this.cellSize = CONFIG.unit.range;
        this.numCells = Math.ceil(CONFIG.world.width / this.cellSize) + 1;
        this.buckets = Array.from({ length: this.numCells }, () => []);

        this.playerKeepX = CONFIG.keep.margin;
        this.enemyKeepX = CONFIG.world.width - CONFIG.keep.margin;

        // Use the real death animation length so recycling waits for it (adapts to art).
        this.deathDuration = scene.anims.get(ANIM.death)?.duration ?? 500;
    }

    get activeCount(): number {
        return this.count;
    }

    update(delta: number) {
        this.handleSpawns(delta);

        this.reacquireAcc += delta;
        if (this.reacquireAcc >= CONFIG.combat.reacquireMs) {
            this.reacquireAcc = 0;
            this.acquireTargets();
        }

        this.step(delta);
    }

    // ---- Spawning ----

    private handleSpawns(delta: number) {
        const { spawnInterval, unitsTarget } = CONFIG.spawn;
        for (const f of [FACTION.player, FACTION.enemy] as const) {
            this.spawnAcc[f] += delta;
            if (this.spawnAcc[f] < spawnInterval) continue;
            this.spawnAcc[f] = 0;
            const cap = f === FACTION.player ? unitsTarget.player : unitsTarget.enemy;
            if (this.livingByFaction[f] < cap) this.spawn(f);
        }
    }

    private spawn(faction: Faction) {
        const sprite = this.freeSprites.pop();
        if (!sprite) return; // pool exhausted (shouldn't happen given the cap)

        const i = this.count++;
        const laneHalf = CONFIG.lane.thickness / 2 - 24;
        const y = CONFIG.lane.y + Phaser.Math.FloatBetween(-laneHalf, laneHalf);
        const x = faction === FACTION.player ? this.playerKeepX : this.enemyKeepX;

        this.x[i] = x;
        this.y[i] = y;
        this.speed[i] = CONFIG.unit.moveSpeed * Phaser.Math.FloatBetween(0.9, 1.1);
        this.hp[i] = CONFIG.unit.hp;
        this.faction[i] = faction;
        this.state[i] = STATE.walk;
        this.target[i] = -1;
        this.attackCd[i] = Phaser.Math.FloatBetween(0, CONFIG.unit.attackInterval); // desync
        this.deathTimer[i] = 0;
        this.sprites[i] = sprite;
        this.livingByFaction[faction]++;

        const tint = faction === FACTION.player ? CONFIG.faction.player.tint : CONFIG.faction.enemy.tint;
        sprite
            .setActive(true)
            .setVisible(true)
            .setPosition(x, y)
            .setDepth(y) // lower on screen draws in front, so ranks overlap correctly
            .setTint(tint)
            .setFlipX(faction === FACTION.enemy) // one right-facing art set; enemy mirrors
            .play(ANIM.walk);
    }

    // ---- Targeting (bucketed by lane x; only nearby cells are tested) ----

    private acquireTargets() {
        for (let c = 0; c < this.numCells; c++) this.buckets[c].length = 0;

        // Bucket living units by x-cell.
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            const c = this.cellOf(i);
            this.buckets[c].push(i);
        }

        const r2 = this.cellSize * this.cellSize; // range^2 (cell size == range)
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            const ci = this.cellOf(i);
            let best = -1;
            let bestD2 = r2;
            // Only this cell and its immediate neighbours can hold an in-range enemy.
            for (let dc = -1; dc <= 1; dc++) {
                const c = ci + dc;
                if (c < 0 || c >= this.numCells) continue;
                const bucket = this.buckets[c];
                for (let k = 0; k < bucket.length; k++) {
                    const j = bucket[k];
                    if (this.faction[j] === this.faction[i]) continue;
                    const dx = this.x[j] - this.x[i];
                    const dy = this.y[j] - this.y[i];
                    const d2 = dx * dx + dy * dy;
                    if (d2 < bestD2) {
                        bestD2 = d2;
                        best = j;
                    }
                }
            }
            this.target[i] = best;
            this.setState(i, best >= 0 ? STATE.attack : STATE.walk);
        }
    }

    private cellOf(i: number): number {
        return Phaser.Math.Clamp(Math.floor(this.x[i] / this.cellSize), 0, this.numCells - 1);
    }

    // ---- Per-frame stepping: movement, strikes, death timers ----

    private step(delta: number) {
        const dt = delta / 1000;
        const reach2 = (CONFIG.unit.range + 8) * (CONFIG.unit.range + 8); // strike validity slack
        // Backwards because despawn() swap-removes from the tail.
        for (let i = this.count - 1; i >= 0; i--) {
            const st = this.state[i];

            if (st === STATE.dying) {
                this.deathTimer[i] -= delta;
                if (this.deathTimer[i] <= 0) this.despawn(i);
                continue;
            }

            if (st === STATE.walk) {
                const dir = this.faction[i] === FACTION.player ? 1 : -1;
                this.x[i] += dir * this.speed[i] * dt;
                this.sprites[i]!.x = this.x[i];
                const reachedEnd = dir > 0 ? this.x[i] >= this.enemyKeepX : this.x[i] <= this.playerKeepX;
                if (reachedEnd) {
                    // Damage the opposing keep, then recycle this unit.
                    this.onReachKeep(this.faction[i] as Faction);
                    this.livingByFaction[this.faction[i]]--;
                    this.despawn(i);
                }
                continue;
            }

            // STATE.attack
            this.attackCd[i] -= delta;
            if (this.attackCd[i] > 0) continue;
            const t = this.target[i];
            const validTarget =
                t >= 0 && t < this.count && this.state[t] !== STATE.dying && this.faction[t] !== this.faction[i];
            if (validTarget) {
                const dx = this.x[t] - this.x[i];
                const dy = this.y[t] - this.y[i];
                if (dx * dx + dy * dy <= reach2) {
                    this.attackCd[i] += CONFIG.unit.attackInterval;
                    this.hp[t] -= CONFIG.unit.damage;
                    if (this.hp[t] <= 0) this.kill(t);
                    continue;
                }
            }
            // Lost the target (moved away, died, or slot reused) — resume marching.
            this.target[i] = -1;
            this.attackCd[i] = 0;
            this.setState(i, STATE.walk);
        }
    }

    // Begin dying: play the death anim once, then recycle when it finishes.
    private kill(i: number) {
        if (this.state[i] === STATE.dying) return;
        this.livingByFaction[this.faction[i]]--;
        this.state[i] = STATE.dying;
        this.target[i] = -1;
        this.deathTimer[i] = this.deathDuration;
        this.sprites[i]!.play(ANIM.death); // non-looping (repeat 0 from registration)
    }

    private setState(i: number, next: number) {
        if (this.state[i] === next) return;
        this.state[i] = next;
        const sprite = this.sprites[i]!;
        if (next === STATE.attack) {
            sprite.play({ key: ANIM.attack, repeat: -1 }); // swing continuously while engaged
        } else if (next === STATE.walk) {
            sprite.play(ANIM.walk);
        }
    }

    // Release the sprite to the pool and swap-remove the slot to keep arrays packed.
    private despawn(i: number) {
        const sprite = this.sprites[i]!;
        sprite.stop();
        sprite.setActive(false).setVisible(false);
        this.freeSprites.push(sprite);

        const last = --this.count;
        if (i !== last) {
            this.x[i] = this.x[last];
            this.y[i] = this.y[last];
            this.speed[i] = this.speed[last];
            this.hp[i] = this.hp[last];
            this.faction[i] = this.faction[last];
            this.state[i] = this.state[last];
            this.target[i] = this.target[last];
            this.attackCd[i] = this.attackCd[last];
            this.deathTimer[i] = this.deathTimer[last];
            this.sprites[i] = this.sprites[last];
        }
        this.sprites[last] = undefined;
    }
}
