import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { armourMult, critChanceFor, damageBonusFor, hpBonusFor, rangeBonusFor } from '../upgrades';
import { animKey, FactionName, POOL_TEXTURE } from './animations';

// Data-oriented horde with sprite pooling + neighbour-based combat.
//
//  - Units are plain records in parallel typed arrays (struct-of-arrays), kept compact
//    via swap-remove. No per-unit class instances, no per-unit update loop.
//  - A fixed pool of sprites is created ONCE up front; spawning borrows one and exit/
//    death returns it. Nothing is created or destroyed mid-battle.
//  - Each unit carries a `type` (index into CONFIG.unitTypes). Stats, art, and the spawn
//    mix are all read from that table, so adding/retuning a unit type is data-only. The
//    table is mirrored into typed lookup arrays so the hot loops stay allocation-free.
//  - Movement is plain position maths along the lane; no physics bodies.
//  - Targeting buckets units by lane position and only tests nearby cells — never an
//    all-pairs O(n^2) scan. Targets are re-acquired a few times a second, not per frame.
//
// Combat is plain melee-nearest for every type right now; the weapon/armour counter
// matrix, ranged arrows, and the Monk's heal arrive in Phase 2. Support units (the Monk)
// never engage — they just march.

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
    private readonly abilityCd: Float32Array; // ms until the unit's special ability is ready
    private readonly deathTimer: Float32Array; // ms left of death anim before recycle
    private readonly lane: Uint8Array;        // which lane index this unit marches on
    private readonly type: Uint8Array;        // index into the roster lookups below
    private readonly sprites: (Phaser.GameObjects.Sprite | undefined)[];

    // Roster lookups: a typed-array mirror of CONFIG.unitTypes, indexed by unit type, so
    // the per-frame loops read scalars instead of walking config objects.
    private readonly typeArt: string[];
    private readonly typeHp: Int16Array;
    private readonly typeDamage: Int16Array;
    private readonly typeRange2: Float32Array;   // engage distance squared
    private readonly typeReach2: Float32Array;   // strike-validity distance squared (range + slack)
    private readonly typeAttackInterval: Float32Array;
    private readonly typeMoveSpeed: Float32Array;
    private readonly typeScale: Float32Array;
    private readonly typeFootAnchor: Float32Array;
    private readonly typeCanAttack: Uint8Array;  // 0 = never engages (support / no range)
    private readonly typeRanged: Uint8Array;     // 1 = fires a projectile on the strike beat
    private readonly typeKnockback: Uint8Array;  // 1 = shoves its target back on a cooldown
    private readonly typeBlockChance: Float32Array; // chance to fully negate an incoming hit
    private readonly typeHealAmount: Float32Array;   // >0 = support healer (flat HP per beat)
    private readonly typeHealInterval: Float32Array; // ms between heals

    private readonly nTypes: number;
    private readonly typeKey: string[];
    // Counter matrix resolved for this roster: pairMul[attacker*nTypes + target] is the
    // weapon×armour multiplier, so the strike loop does one array read and no string work.
    private readonly pairMul: Float32Array;
    // Live (non-dying) count per [typeIndex*2 + faction] — drives the unit-panel readout.
    private readonly livingByType: Int32Array;

    // Player-only upgrade bonuses, indexed by type (enemy units always use the base stats).
    private readonly pHpBonus: Int16Array;
    private readonly pRange2: Float32Array;
    private readonly pReach2: Float32Array;
    private readonly pDamageBonus: Int16Array;
    private readonly pCritChance: Float32Array;
    private pArmourMult = 1;

    // Lane geometry, derived once from CONFIG.lanes (index == lane index).
    private readonly laneY: Float32Array;
    private readonly laneHalf: Float32Array;  // half-band the unit may roam within

    // Sprite pool.
    private readonly freeSprites: Phaser.GameObjects.Sprite[] = [];
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
    // Emitted on each applied strike (post-matrix damage) so the scene can pop a number;
    // `color` is set for crits.
    private readonly onDamage?: (x: number, y: number, amount: number, color?: string) => void;
    // Emitted when a ranged unit strikes, so the scene can fly a (cosmetic) projectile.
    private readonly onShoot?: (x0: number, y0: number, x1: number, y1: number, faction: Faction) => void;
    // Emitted when a healer tops up an ally, so the scene can pop a (green) heal number.
    private readonly onHeal?: (x: number, y: number, amount: number) => void;
    // Emitted when a unit blocks a hit, so the scene can pop a "block" indicator.
    private readonly onBlock?: (x: number, y: number) => void;

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        onReachKeep: (attacker: Faction) => void,
        onDamage?: (x: number, y: number, amount: number, color?: string) => void,
        onShoot?: (x0: number, y0: number, x1: number, y1: number, faction: Faction) => void,
        onHeal?: (x: number, y: number, amount: number) => void,
        onBlock?: (x: number, y: number) => void,
    ) {
        this.onReachKeep = onReachKeep;
        this.onDamage = onDamage;
        this.onShoot = onShoot;
        this.onHeal = onHeal;
        this.onBlock = onBlock;
        this.capacity = CONFIG.spawn.unitsTarget.player + CONFIG.spawn.unitsTarget.enemy + 40;

        this.x = new Float32Array(this.capacity);
        this.y = new Float32Array(this.capacity);
        this.speed = new Float32Array(this.capacity);
        this.hp = new Int16Array(this.capacity);
        this.faction = new Uint8Array(this.capacity);
        this.state = new Uint8Array(this.capacity);
        this.target = new Int32Array(this.capacity);
        this.attackCd = new Float32Array(this.capacity);
        this.abilityCd = new Float32Array(this.capacity);
        this.deathTimer = new Float32Array(this.capacity);
        this.lane = new Uint8Array(this.capacity);
        this.type = new Uint8Array(this.capacity);
        this.sprites = new Array(this.capacity);

        // Mirror the unit roster into typed lookups.
        const types = CONFIG.unitTypes;
        const nTypes = types.length;
        this.typeArt = new Array(nTypes);
        this.typeKey = new Array(nTypes);
        this.pHpBonus = new Int16Array(nTypes);
        this.pRange2 = new Float32Array(nTypes);
        this.pReach2 = new Float32Array(nTypes);
        this.pDamageBonus = new Int16Array(nTypes);
        this.pCritChance = new Float32Array(nTypes);
        this.typeHp = new Int16Array(nTypes);
        this.typeDamage = new Int16Array(nTypes);
        this.typeRange2 = new Float32Array(nTypes);
        this.typeReach2 = new Float32Array(nTypes);
        this.typeAttackInterval = new Float32Array(nTypes);
        this.typeMoveSpeed = new Float32Array(nTypes);
        this.typeScale = new Float32Array(nTypes);
        this.typeFootAnchor = new Float32Array(nTypes);
        this.typeCanAttack = new Uint8Array(nTypes);
        this.typeRanged = new Uint8Array(nTypes);
        this.typeKnockback = new Uint8Array(nTypes);
        this.typeBlockChance = new Float32Array(nTypes);
        this.typeHealAmount = new Float32Array(nTypes);
        this.typeHealInterval = new Float32Array(nTypes);
        let maxRange = 1;
        for (let t = 0; t < nTypes; t++) {
            const ut = types[t];
            this.typeArt[t] = ut.art;
            this.typeKey[t] = ut.key;
            this.typeHp[t] = ut.hp;
            this.typeDamage[t] = ut.damage;
            this.typeRange2[t] = ut.range * ut.range;
            this.typeReach2[t] = (ut.range + 8) * (ut.range + 8);
            this.typeAttackInterval[t] = ut.attackInterval;
            this.typeMoveSpeed[t] = ut.moveSpeed;
            this.typeScale[t] = ut.scale;
            this.typeFootAnchor[t] = ut.footAnchor;
            // Support units (and anything with no range) never engage — they only march.
            this.typeCanAttack[t] = ut.role !== 'support' && ut.range > 0 ? 1 : 0;
            this.typeRanged[t] = ut.role === 'ranged' ? 1 : 0;
            this.typeKnockback[t] = ut.ability === 'knockback' ? 1 : 0;
            this.typeBlockChance[t] = ut.ability === 'block' ? CONFIG.abilities.block.chance : 0;
            this.typeHealAmount[t] = ut.heal ? ut.heal.amount : 0;
            this.typeHealInterval[t] = ut.heal ? ut.heal.interval : 0;
            if (ut.range > maxRange) maxRange = ut.range;
        }

        // Resolve the weapon×armour matrix into a flat per-pair multiplier table (default 1
        // for any weapon/armour the matrix doesn't list — e.g. the Monk never attacks).
        this.nTypes = nTypes;
        this.pairMul = new Float32Array(nTypes * nTypes);
        this.livingByType = new Int32Array(nTypes * 2);
        const matrix = CONFIG.combat.matrix;
        for (let a = 0; a < nTypes; a++) {
            const row = matrix[types[a].weapon];
            for (let d = 0; d < nTypes; d++) {
                const m = row ? row[types[d].armour] : undefined;
                this.pairMul[a * nTypes + d] = m ?? 1;
            }
        }

        // Derive lane geometry from config (one flat lane today).
        const lanes = CONFIG.lanes;
        this.laneY = new Float32Array(lanes.length);
        this.laneHalf = new Float32Array(lanes.length);
        for (let l = 0; l < lanes.length; l++) {
            this.laneY[l] = lanes[l].y;
            this.laneHalf[l] = lanes[l].thickness / 2 - 24; // keep feet inside the band
        }

        // Build the whole sprite pool once. These never get destroyed. They live on the
        // world layer so the UI camera can ignore them. Origin/scale are set per spawn
        // (types differ); the first type's values are a sane default for the idle pool.
        for (let i = 0; i < this.capacity; i++) {
            const s = scene.add.sprite(0, 0, POOL_TEXTURE)
                .setOrigin(0.5, this.typeFootAnchor[0])
                .setScale(this.typeScale[0])
                .setActive(false)
                .setVisible(false);
            layer.add(s);
            this.freeSprites.push(s);
        }

        // Cells must be at least as wide as the LONGEST engage range so the ±1 neighbour
        // scan never misses an in-range enemy. Headroom (620) covers a maxed Range edit
        // (≤480) plus the Archer +Range upgrade, without rebuilding the grid.
        this.cellSize = Math.max(maxRange, 620);
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
        this.deathDuration = CONFIG.combat.deathFadeMs;

        this.recomputeUpgrades();
    }

    // Resolve the player's active upgrades into per-type bonus lookups (enemy uses base
    // stats). Call after a toggle or a stat edit. HP applies to units spawned from now on;
    // range / damage / armour apply immediately.
    recomputeUpgrades() {
        for (let t = 0; t < this.nTypes; t++) {
            const key = this.typeKey[t];
            const r = CONFIG.unitTypes[t].range + rangeBonusFor(key);
            this.pHpBonus[t] = hpBonusFor(key);
            this.pRange2[t] = r * r;
            this.pReach2[t] = (r + 8) * (r + 8);
            this.pDamageBonus[t] = damageBonusFor(key);
            this.pCritChance[t] = critChanceFor(key);
        }
        this.pArmourMult = armourMult();
    }

    get activeCount(): number {
        return this.count;
    }

    // Re-read per-type stats from CONFIG into the typed lookups, so live edits from the unit
    // panel take effect without a restart. Damage / range / attack cadence apply to all
    // units immediately; hp / speed / scale / anchor apply to units spawned from now on.
    refreshFromConfig() {
        const types = CONFIG.unitTypes;
        for (let t = 0; t < this.nTypes; t++) {
            const ut = types[t];
            this.typeHp[t] = ut.hp;
            this.typeDamage[t] = ut.damage;
            this.typeRange2[t] = ut.range * ut.range;
            this.typeReach2[t] = (ut.range + 8) * (ut.range + 8);
            this.typeAttackInterval[t] = ut.attackInterval;
            this.typeMoveSpeed[t] = ut.moveSpeed;
            this.typeScale[t] = ut.scale;
            this.typeFootAnchor[t] = ut.footAnchor;
            this.typeHealAmount[t] = ut.heal ? ut.heal.amount : 0;
            this.typeHealInterval[t] = ut.heal ? ut.heal.interval : 0;
        }
        this.recomputeUpgrades(); // base range/damage feed the player bonuses
    }

    // Living (non-dying) units of a given type on a given side — for the unit panel.
    livingTypeCount(typeIndex: number, faction: Faction): number {
        return this.livingByType[typeIndex * 2 + faction];
    }

    update(delta: number) {
        this.reacquireAcc += delta;
        if (this.reacquireAcc >= CONFIG.combat.reacquireMs) {
            this.reacquireAcc = 0;
            this.acquireTargets();
        }

        this.step(delta);
        this.applySeparation(delta);
    }

    // ---- Spawning (driven externally by the production buildings) ----

    // Spawn one unit of `typeIndex` for `faction` at (x, y); y is clamped into the lane band
    // so the horde stays readable. Returns false if the side is at its cap or the pool is
    // exhausted. Called by the Buildings system on each production beat.
    spawnAt(faction: Faction, typeIndex: number, x: number, y: number): boolean {
        const cap = faction === FACTION.player
            ? CONFIG.spawn.unitsTarget.player
            : CONFIG.spawn.unitsTarget.enemy;
        if (this.livingByFaction[faction] >= cap) return false;
        const sprite = this.freeSprites.pop();
        if (!sprite) return false; // pool exhausted (shouldn't happen given the cap)

        const t = typeIndex;
        const i = this.count++;
        const half = this.laneHalf[0];
        const yClamped = Phaser.Math.Clamp(y, this.laneY[0] - half, this.laneY[0] + half);

        this.x[i] = x;
        this.y[i] = yClamped;
        this.speed[i] = this.typeMoveSpeed[t] * Phaser.Math.FloatBetween(0.9, 1.1);
        this.hp[i] = this.typeHp[t] + (faction === FACTION.player ? this.pHpBonus[t] : 0);
        this.faction[i] = faction;
        this.state[i] = STATE.walk;
        this.target[i] = -1;
        this.attackCd[i] = Phaser.Math.FloatBetween(0, this.typeAttackInterval[t]); // desync
        this.abilityCd[i] = this.typeKnockback[t]
            ? Phaser.Math.FloatBetween(0, CONFIG.abilities.knockback.cooldown)
            : 0;
        this.deathTimer[i] = 0;
        this.lane[i] = 0;
        this.type[i] = t;
        this.sprites[i] = sprite;
        this.livingByFaction[faction]++;
        this.livingByType[t * 2 + faction]++;

        sprite
            .setActive(true)
            .setVisible(true)
            .setAlpha(1)
            .setScale(this.typeScale[t])            // per type (a recycled sprite may differ)
            .setOrigin(0.5, this.typeFootAnchor[t]) // feet on the lane line
            .setPosition(x, yClamped)
            .setDepth(yClamped) // lower on screen draws in front, so ranks overlap correctly
            .setFlipX(faction === FACTION.enemy)    // right-facing art; enemy marches left
            .play(animKey(this.typeArt[t], FACTION_NAME[faction], 'walk'));
        return true;
    }

    // ---- Targeting (bucketed by lane x; only nearby cells are tested) ----

    private acquireTargets() {
        for (let c = 0; c < this.numCells; c++) this.buckets[c].length = 0;

        // Bucket living units by x-cell (support units included — they are valid targets).
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            const c = this.cellOf(i);
            this.buckets[c].push(i);
        }

        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;

            // Non-combat units don't engage; a support healer instead seeks a hurt ally.
            if (!this.typeCanAttack[this.type[i]]) {
                if (this.typeHealAmount[this.type[i]] > 0) {
                    this.acquireHealTarget(i);
                } else {
                    this.target[i] = -1;
                    this.setState(i, STATE.walk);
                }
                continue;
            }

            const range2 = this.faction[i] === FACTION.player
                ? this.pRange2[this.type[i]]
                : this.typeRange2[this.type[i]];
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

    // Pick the lowest-HP wounded ally within heal range (reuses the targeting buckets).
    private acquireHealTarget(i: number) {
        const range2 = this.typeRange2[this.type[i]];
        const ci = this.cellOf(i);
        let best = -1;
        let bestHp = Infinity;
        for (let dc = -1; dc <= 1; dc++) {
            const c = ci + dc;
            if (c < 0 || c >= this.numCells) continue;
            const bucket = this.buckets[c];
            for (let k = 0; k < bucket.length; k++) {
                const j = bucket[k];
                if (j === i || this.faction[j] !== this.faction[i]) continue;
                if (this.hp[j] >= this.typeHp[this.type[j]]) continue; // already full
                const dx = this.x[j] - this.x[i];
                const dy = this.y[j] - this.y[i];
                if (dx * dx + dy * dy > range2) continue;
                if (this.hp[j] < bestHp) {
                    bestHp = this.hp[j];
                    best = j;
                }
            }
        }
        this.target[i] = best;
        this.setState(i, best >= 0 ? STATE.attack : STATE.walk);
    }

    private cellOf(i: number): number {
        return Phaser.Math.Clamp(Math.floor(this.x[i] / this.cellSize), 0, this.numCells - 1);
    }

    // ---- Per-frame stepping: movement, strikes, death timers ----

    private step(delta: number) {
        const dt = delta / 1000;
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

            if (this.abilityCd[i] > 0) this.abilityCd[i] -= delta; // tick special-ability cd

            if (st === STATE.walk) {
                const sprite = this.sprites[i]!;
                // Funnel: drift toward the lane-path centre until within the tight path,
                // so the streams from the spread-out buildings merge into one lane. Read
                // live from config so the Dev panel's "Lane width" applies instantly.
                const lane = CONFIG.lanes[this.lane[i]];
                const half = lane.pathWidth * 0.5;
                const off = this.laneY[this.lane[i]] - this.y[i]; // +ve = unit is above centre
                if (off > half || off < -half) {
                    const pull = lane.funnelSpeed * dt;
                    const room = Math.abs(off) - half; // don't overshoot the path edge
                    this.y[i] += Math.sign(off) * Math.min(pull, room);
                    sprite.y = this.y[i];
                    sprite.setDepth(this.y[i]);
                }
                const dir = this.faction[i] === FACTION.player ? 1 : -1;
                this.x[i] += dir * this.speed[i] * dt;
                sprite.x = this.x[i];
                const reachedEnd = dir > 0 ? this.x[i] >= this.enemyKeepX : this.x[i] <= this.playerKeepX;
                if (reachedEnd) {
                    // Damage the opposing keep, then recycle this unit.
                    this.onReachKeep(this.faction[i] as Faction);
                    this.livingByFaction[this.faction[i]]--;
                    this.livingByType[this.type[i] * 2 + this.faction[i]]--;
                    this.despawn(i);
                }
                continue;
            }

            // STATE.attack == "acting": a combat strike, or a heal for support healers,
            // applied on this unit type's own cadence.
            this.attackCd[i] -= delta;
            if (this.attackCd[i] > 0) continue;
            const acting = this.type[i];
            const t = this.target[i];

            if (this.typeHealAmount[acting] > 0) {
                // Healer: top up the lowest-HP ally if it is still hurt and in range.
                const maxHp = t >= 0 && t < this.count ? this.typeHp[this.type[t]] : 0;
                const okHeal =
                    t >= 0 && t < this.count && this.state[t] !== STATE.dying &&
                    this.faction[t] === this.faction[i] && this.hp[t] < maxHp;
                if (okHeal) {
                    const dx = this.x[t] - this.x[i];
                    const dy = this.y[t] - this.y[i];
                    if (dx * dx + dy * dy <= this.typeRange2[acting]) {
                        this.attackCd[i] += this.typeHealInterval[acting];
                        const healed = Math.min(this.typeHealAmount[acting], maxHp - this.hp[t]);
                        this.hp[t] += healed;
                        if (healed > 0 && this.onHeal && CONFIG.debug.damageNumbers) {
                            this.onHeal(this.x[t], this.y[t] - 50, healed);
                        }
                        // Re-trigger the heal gesture each beat.
                        this.sprites[i]!.play(animKey(this.typeArt[acting], FACTION_NAME[this.faction[i]], 'heal'));
                        continue;
                    }
                }
                this.target[i] = -1;
                this.attackCd[i] = 0;
                this.setState(i, STATE.walk);
                continue;
            }

            // Combat strike.
            const atkF = this.faction[i];
            const validTarget =
                t >= 0 && t < this.count && this.state[t] !== STATE.dying && this.faction[t] !== this.faction[i];
            const reach2 = atkF === FACTION.player ? this.pReach2[acting] : this.typeReach2[acting];
            if (validTarget) {
                const dx = this.x[t] - this.x[i];
                const dy = this.y[t] - this.y[i];
                if (dx * dx + dy * dy <= reach2) {
                    this.attackCd[i] += this.typeAttackInterval[acting];
                    // Defender's block (innate, both sides): chance to fully negate the hit.
                    const blockChance = this.typeBlockChance[this.type[t]];
                    if (blockChance > 0 && Math.random() < blockChance) {
                        if (this.onBlock && CONFIG.debug.damageNumbers) this.onBlock(this.x[t], this.y[t] - 50);
                        continue;
                    }
                    // Base damage (+ the attacker's melee/ranged upgrade) scaled by the
                    // counter matrix, then reduced by the defender's armour; always ≥ 1.
                    const base = this.typeDamage[acting] + (atkF === FACTION.player ? this.pDamageBonus[acting] : 0);
                    let scaled = base * this.pairMul[acting * this.nTypes + this.type[t]];
                    // Lancer crit (player upgrade): chance to multiply this hit.
                    let crit = false;
                    if (atkF === FACTION.player && this.pCritChance[acting] > 0 && Math.random() < this.pCritChance[acting]) {
                        scaled *= CONFIG.abilities.crit.mult;
                        crit = true;
                    }
                    if (this.faction[t] === FACTION.player) scaled *= this.pArmourMult;
                    const dmg = Math.max(1, Math.round(scaled));
                    this.hp[t] -= dmg;
                    if (this.onDamage && CONFIG.debug.damageNumbers) {
                        this.onDamage(this.x[t], this.y[t] - 50, dmg, crit ? '#ffd24a' : undefined);
                    }
                    // Lancer knockback (innate, both sides): shove the target back on a cd.
                    if (this.typeKnockback[acting] && this.abilityCd[i] <= 0) {
                        const kdir = atkF === FACTION.player ? 1 : -1;
                        this.x[t] = Phaser.Math.Clamp(
                            this.x[t] + kdir * CONFIG.abilities.knockback.distance,
                            this.playerKeepX,
                            this.enemyKeepX,
                        );
                        this.sprites[t]!.x = this.x[t];
                        this.abilityCd[i] = CONFIG.abilities.knockback.cooldown;
                    }
                    // Ranged units fly a cosmetic arrow toward the struck target.
                    if (this.typeRanged[acting] && this.onShoot) {
                        this.onShoot(this.x[i], this.y[i] - 40, this.x[t], this.y[t] - 40, this.faction[i] as Faction);
                    }
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

        // Apply, capped to maxStep px this frame, keeping units within their lane band.
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
        this.livingByType[this.type[i] * 2 + this.faction[i]]--;
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
        const art = this.typeArt[this.type[i]];
        const name = FACTION_NAME[this.faction[i]];
        if (next === STATE.attack) {
            // Combat units loop their attack; support healers play their heal gesture.
            const act = this.typeHealAmount[this.type[i]] > 0 ? 'heal' : 'attack';
            sprite.play(animKey(art, name, act));
        } else if (next === STATE.walk) {
            sprite.play(animKey(art, name, 'walk'));
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
            this.abilityCd[i] = this.abilityCd[last];
            this.deathTimer[i] = this.deathTimer[last];
            this.lane[i] = this.lane[last];
            this.type[i] = this.type[last];
            this.sprites[i] = this.sprites[last];
        }
        this.sprites[last] = undefined;
    }
}
