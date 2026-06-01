import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { animKey, FactionName, POOL_TEXTURE } from './animations';

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

// Numeric faction -> the name the animation system uses (blue/red art sets).
const FACTION_NAME: readonly FactionName[] = ['player', 'enemy'];

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
    private readonly lane: Uint8Array;        // which lane index this unit marches on
    private readonly sprites: (Phaser.GameObjects.Sprite | undefined)[];

    // Lane geometry, derived once from CONFIG.lanes (index == lane index).
    private readonly laneY: Float32Array;
    private readonly laneHalf: Float32Array;  // half-band the unit may roam within
    private readonly laneCumWeight: Float32Array; // cumulative spawn weights for picking
    private readonly laneWeightTotal: number;

    // Pool + spawn cadence.
    private readonly freeSprites: Phaser.GameObjects.Sprite[] = [];
    private readonly spawnAcc: [number, number] = [0, 0];
    private reacquireAcc = 0;

    // Targeting buckets (reused each acquire to avoid allocation).
    private readonly cellSize: number;
    private readonly numCells: number;
    private readonly buckets: number[][];

    // Separation: a fresh x-bucketing each frame + per-unit accumulated push (no allocation).
    private readonly sepCellSize: number;
    private readonly numSepCells: number;
    private readonly sepBuckets: number[][];
    private readonly pushX: Float32Array;
    private readonly pushY: Float32Array;

    private readonly playerKeepX: number;
    private readonly enemyKeepX: number;
    private readonly deathDuration: number;

    // Called when a unit reaches the opposing keep (so the scene can damage it).
    private readonly onReachKeep: (attacker: Faction) => void;

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        onReachKeep: (attacker: Faction) => void,
    ) {
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
        this.lane = new Uint8Array(this.capacity);
        this.sprites = new Array(this.capacity);

        // Derive lane geometry + a cumulative spawn-weight table from config.
        const lanes = CONFIG.lanes;
        this.laneY = new Float32Array(lanes.length);
        this.laneHalf = new Float32Array(lanes.length);
        this.laneCumWeight = new Float32Array(lanes.length);
        let cum = 0;
        for (let l = 0; l < lanes.length; l++) {
            this.laneY[l] = lanes[l].y;
            this.laneHalf[l] = lanes[l].thickness / 2 - 24; // keep feet inside the band
            cum += CONFIG.spawn.laneDistribution[l] ?? 0;
            this.laneCumWeight[l] = cum;
        }
        this.laneWeightTotal = cum;

        // Build the whole sprite pool once. These never get destroyed. They live on the
        // world layer so the UI camera can ignore them.
        for (let i = 0; i < this.capacity; i++) {
            const s = scene.add.sprite(0, 0, POOL_TEXTURE)
                .setOrigin(0.5, CONFIG.unit.footAnchor) // feet on the lane line
                .setScale(CONFIG.unit.renderScale)
                .setActive(false)
                .setVisible(false);
            layer.add(s);
            this.freeSprites.push(s);
        }

        // Cells must be at least as wide as the engage range so the ±1 neighbour scan
        // never misses an in-range enemy.
        this.cellSize = CONFIG.unit.range;
        this.numCells = Math.ceil(CONFIG.world.width / this.cellSize) + 1;
        this.buckets = Array.from({ length: this.numCells }, () => []);

        this.sepCellSize = CONFIG.separation.radius;
        this.numSepCells = Math.ceil(CONFIG.world.width / this.sepCellSize) + 1;
        this.sepBuckets = Array.from({ length: this.numSepCells }, () => []);
        this.pushX = new Float32Array(this.capacity);
        this.pushY = new Float32Array(this.capacity);

        this.playerKeepX = CONFIG.keep.margin;
        this.enemyKeepX = CONFIG.world.width - CONFIG.keep.margin;

        // Tiny Swords has no death animation, so death is a synthesised fade of this length.
        this.deathDuration = CONFIG.unit.deathFadeMs;
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
        this.applySeparation(delta);
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
        const laneIdx = this.pickLane();
        const half = this.laneHalf[laneIdx];
        const y = this.laneY[laneIdx] + Phaser.Math.FloatBetween(-half, half);
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
        this.lane[i] = laneIdx;
        this.sprites[i] = sprite;
        this.livingByFaction[faction]++;

        sprite
            .setActive(true)
            .setVisible(true)
            .setAlpha(1)
            .setPosition(x, y)
            .setDepth(y) // lower on screen draws in front, so ranks overlap correctly
            .setFlipX(faction === FACTION.enemy) // right-facing art; enemy marches left
            .play(animKey(FACTION_NAME[faction], 'walk'));
    }

    // Weighted random lane pick (CONFIG.spawn.laneDistribution). One lane today, but the
    // machinery stays so spawn weighting survives if lanes return.
    private pickLane(): number {
        const r = Phaser.Math.FloatBetween(0, this.laneWeightTotal);
        for (let l = 0; l < this.laneCumWeight.length; l++) {
            if (r <= this.laneCumWeight[l]) return l;
        }
        return this.laneCumWeight.length - 1;
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

        // Single melee engage distance (flat field — no elevation).
        const range2 = CONFIG.unit.range * CONFIG.unit.range;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            const ci = this.cellOf(i);
            let best = -1;
            let bestD2 = Infinity;
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
                    if (d2 <= range2 && d2 < bestD2) {
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
        // Strike-validity distance (a little slack on the engage range).
        const meleeReach2 = (CONFIG.unit.range + 8) * (CONFIG.unit.range + 8);
        // Backwards because despawn() swap-removes from the tail.
        for (let i = this.count - 1; i >= 0; i--) {
            const st = this.state[i];

            if (st === STATE.dying) {
                this.deathTimer[i] -= delta;
                // Synthesised death: fade the frozen sprite out over deathDuration.
                this.sprites[i]!.alpha = Math.max(0, this.deathTimer[i] / this.deathDuration);
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
                if (dx * dx + dy * dy <= meleeReach2) {
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

    // ---- Soft separation: nudge overlapping units apart so the horde stays a loose mass ----

    // Uses its own per-frame x-bucketing (positions move every frame, so the targeting
    // buckets are too stale to reuse). The total nudge is capped per frame, so dense piles
    // relax smoothly without jitter. Dying units neither push nor are pushed.
    private applySeparation(delta: number) {
        const radius = CONFIG.separation.radius;
        const r2 = radius * radius;

        // Rebuild x-buckets for living units.
        for (let c = 0; c < this.numSepCells; c++) this.sepBuckets[c].length = 0;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            this.sepBuckets[this.sepCellOf(i)].push(i);
        }

        // Accumulate a push vector per unit from neighbours in this + adjacent x-cells.
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            let px = 0;
            let py = 0;
            const ci = this.sepCellOf(i);
            for (let dc = -1; dc <= 1; dc++) {
                const c = ci + dc;
                if (c < 0 || c >= this.numSepCells) continue;
                const bucket = this.sepBuckets[c];
                for (let k = 0; k < bucket.length; k++) {
                    const j = bucket[k];
                    if (j === i) continue;
                    const dx = this.x[i] - this.x[j];
                    const dy = this.y[i] - this.y[j];
                    const d2 = dx * dx + dy * dy;
                    if (d2 >= r2) continue;
                    if (d2 > 0.01) {
                        const d = Math.sqrt(d2);
                        const w = (radius - d) / radius; // 1 when touching, 0 at the edge
                        px += (dx / d) * w;
                        py += (dy / d) * w;
                    } else {
                        py += i < j ? -1 : 1; // exactly stacked: deterministic shove apart
                    }
                }
            }
            this.pushX[i] = px;
            this.pushY[i] = py;
        }

        // Apply, capped to maxStep px this frame, keeping units within the lane band.
        const maxStep = CONFIG.separation.strength * (delta / 1000);
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            let nx = this.pushX[i] * maxStep;
            let ny = this.pushY[i] * maxStep;
            const disp = Math.hypot(nx, ny);
            if (disp <= 0.0001) continue;
            if (disp > maxStep) {
                const s = maxStep / disp;
                nx *= s;
                ny *= s;
            }
            const ln = this.lane[i];
            const yMin = this.laneY[ln] - this.laneHalf[ln];
            const yMax = this.laneY[ln] + this.laneHalf[ln];
            this.x[i] += nx;
            this.y[i] = Phaser.Math.Clamp(this.y[i] + ny, yMin, yMax);
            const sprite = this.sprites[i]!;
            sprite.x = this.x[i];
            sprite.y = this.y[i];
            sprite.setDepth(this.y[i]);
        }
    }

    private sepCellOf(i: number): number {
        return Phaser.Math.Clamp(Math.floor(this.x[i] / this.sepCellSize), 0, this.numSepCells - 1);
    }

    // Begin dying: play the death anim once, then recycle when it finishes.
    private kill(i: number) {
        if (this.state[i] === STATE.dying) return;
        this.livingByFaction[this.faction[i]]--;
        this.state[i] = STATE.dying;
        this.target[i] = -1;
        this.deathTimer[i] = this.deathDuration;
        // No death animation in the pack: freeze on the current frame and dim, then the
        // dying branch in step() fades it out before recycling.
        this.sprites[i]!.anims.stop();
        this.sprites[i]!.setTint(0x6a6a6a);
    }

    private setState(i: number, next: number) {
        if (this.state[i] === next) return;
        this.state[i] = next;
        const sprite = this.sprites[i]!;
        const name = FACTION_NAME[this.faction[i]];
        if (next === STATE.attack) {
            sprite.play(animKey(name, 'attack')); // loops while engaged
        } else if (next === STATE.walk) {
            sprite.play(animKey(name, 'walk'));
        }
    }

    // Release the sprite to the pool and swap-remove the slot to keep arrays packed.
    private despawn(i: number) {
        const sprite = this.sprites[i]!;
        sprite.stop();
        sprite.clearTint();
        sprite.setActive(false).setVisible(false).setAlpha(1);
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
            this.lane[i] = this.lane[last];
            this.sprites[i] = this.sprites[last];
        }
        this.sprites[last] = undefined;
    }
}
