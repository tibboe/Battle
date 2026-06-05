import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { armourMult, critChanceFor, damageBonusFor, healAoeFor, hpBonusFor, rangeBonusFor } from '../upgrades';
import { animDurationMs, animKey, FactionName, healEffectKey, POOL_TEXTURE } from './animations';
import { ORDER, Order } from './commands';
import { matchStats } from '../stats/MatchStats';
import { cameraAngle, rotatesWithCamera, screenOffset } from '../controls/billboard';

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
    private readonly animLock: Float32Array;   // ms left of a one-shot pose (block / shoot) before resuming
    private readonly drawTimer: Float32Array;  // ms left of an Archer's long-shot draw (0 = not drawing)
    private readonly drawLx: Float32Array;     // long-shot landing point captured at draw start
    private readonly drawLy: Float32Array;
    private readonly lane: Uint8Array;        // which lane index this unit marches on
    private readonly type: Uint8Array;        // index into the roster lookups below
    private readonly producer: Int32Array;    // id of the building that spawned this unit (-1 = none)
    // Player command state. `order` is one of ORDER.*; (destX, destY) is the unit's formation
    // slot / move target, or its hold/free anchor. Enemy + un-commanded player units stay auto.
    private readonly order: Uint8Array;
    private readonly destX: Float32Array;
    private readonly destY: Float32Array;
    private readonly moving: Uint8Array; // 1 = locomoting this frame (walk anim); 0 = standing (idle anim)
    private readonly rangeMul: Float32Array; // per-unit normal-range multiplier (garrison archers = 2)
    private readonly garrison: Uint8Array;   // 1 = pinned building defender (no separation/obstacle push)
    // Garrison defenders sit above their building's base by a SCREEN-space offset (so they stay on
    // the roof when the battlefield is turned). destX/destY hold the building-base anchor; these
    // hold the offset (px right / px up on screen) re-applied each frame in repositionGarrison.
    private readonly gOffRight: Float32Array;
    private readonly gOffUp: Float32Array;
    private readonly level: Uint8Array;      // elevation tier (0 = ground; roofs/high terrain > 0). Melee
                                             // can only strike same-level targets; ranged can hit any level.
    private obstacleProvider?: () => { x: number; y: number; r: number }[]; // building footprints
    // Frontline x per faction (furthest-advanced combat unit) — support healers trail it so they
    // tuck behind the line and idle rather than charging ahead. Refreshed each targeting pass.
    private readonly frontX: [number, number] = [0, 0];
    // Standing order PER PLAYER UNIT TYPE: the last command issued to a type, so units that spawn
    // later inherit it (a Move/Free keeps a rally point; auto = no standing order). Length nTypes.
    private standingOrder!: Uint8Array;
    private standingX!: Float32Array;
    private standingY!: Float32Array;
    private readonly sprites: (Phaser.GameObjects.Sprite | undefined)[];

    // Living (non-dying) units per producer id — lets a building cap how many it keeps alive.
    private readonly livingByProducer = new Map<number, number>();

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
    private readonly typeLongshot: Uint8Array;   // 1 = lobs a long-shot arrow on a cooldown
    private readonly typeHealAmount: Float32Array;   // >0 = support healer (flat HP per beat)
    private readonly typeHealInterval: Float32Array; // ms between heals
    private readonly typeAttackAnimMs: Float32Array; // one attack swing's animation length
    private readonly typeHealAnimMs: Float32Array;   // one heal gesture's animation length

    private readonly nTypes: number;
    private readonly typeKey: string[];
    private longshotType = -1;              // type index that has the long shot (or -1)
    private readonly longScratch: number[] = []; // reused candidate buffer for long-shot aim
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
    private readonly pHealAoe: Uint8Array; // player Monk: heal hits an area instead of one ally
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

    // One Graphics object redraws every damaged unit's health bar each frame (cheaper than a
    // pool of per-unit bar objects). Lives on the world layer so it pans/zooms with the units.
    private readonly healthBars: Phaser.GameObjects.Graphics;

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
    // Emitted when an Archer lobs a long shot — the scene flies an arcing arrow whose
    // landing calls back into resolveLongShotHit.
    private readonly onLongShot?: (x0: number, y0: number, x1: number, y1: number, faction: Faction) => void;
    private readonly scene: Phaser.Scene; // kept for the live camera angle (health bars / garrison)
    private readonly layer: Phaser.GameObjects.Layer; // world layer, for spawning effect sprites

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        onReachKeep: (attacker: Faction) => void,
        onDamage?: (x: number, y: number, amount: number, color?: string) => void,
        onShoot?: (x0: number, y0: number, x1: number, y1: number, faction: Faction) => void,
        onHeal?: (x: number, y: number, amount: number) => void,
        onBlock?: (x: number, y: number) => void,
        onLongShot?: (x0: number, y0: number, x1: number, y1: number, faction: Faction) => void,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.onReachKeep = onReachKeep;
        this.onDamage = onDamage;
        this.onShoot = onShoot;
        this.onHeal = onHeal;
        this.onBlock = onBlock;
        this.onLongShot = onLongShot;
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
        this.animLock = new Float32Array(this.capacity);
        this.drawTimer = new Float32Array(this.capacity);
        this.drawLx = new Float32Array(this.capacity);
        this.drawLy = new Float32Array(this.capacity);
        this.lane = new Uint8Array(this.capacity);
        this.type = new Uint8Array(this.capacity);
        this.producer = new Int32Array(this.capacity);
        this.order = new Uint8Array(this.capacity);
        this.destX = new Float32Array(this.capacity);
        this.destY = new Float32Array(this.capacity);
        this.moving = new Uint8Array(this.capacity);
        this.rangeMul = new Float32Array(this.capacity);
        this.garrison = new Uint8Array(this.capacity);
        this.gOffRight = new Float32Array(this.capacity);
        this.gOffUp = new Float32Array(this.capacity);
        this.level = new Uint8Array(this.capacity);
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
        this.pHealAoe = new Uint8Array(nTypes);
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
        this.typeLongshot = new Uint8Array(nTypes);
        this.typeHealAmount = new Float32Array(nTypes);
        this.typeHealInterval = new Float32Array(nTypes);
        this.typeAttackAnimMs = new Float32Array(nTypes);
        this.typeHealAnimMs = new Float32Array(nTypes);
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
            this.typeLongshot[t] = ut.ability === 'longshot' ? 1 : 0;
            if (ut.ability === 'longshot') this.longshotType = t;
            this.typeHealAmount[t] = ut.heal ? ut.heal.amount : 0;
            this.typeHealInterval[t] = ut.heal ? ut.heal.interval : 0;
            this.typeAttackAnimMs[t] = animDurationMs(ut.art, 'attack');
            this.typeHealAnimMs[t] = animDurationMs(ut.art, 'heal');
            if (ut.range > maxRange) maxRange = ut.range;
        }

        // Resolve the weapon×armour matrix into a flat per-pair multiplier table (default 1
        // for any weapon/armour the matrix doesn't list — e.g. the Monk never attacks).
        this.nTypes = nTypes;
        this.pairMul = new Float32Array(nTypes * nTypes);
        this.livingByType = new Int32Array(nTypes * 2);
        this.standingOrder = new Uint8Array(nTypes); // all ORDER.auto at match start
        this.standingX = new Float32Array(nTypes);
        this.standingY = new Float32Array(nTypes);
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

        // Health bars draw above every unit sprite (unit depth == world-y, max ~world.height).
        // Tagged rotatesWithCamera because drawHealthBars already draws each bar at the right
        // screen-up offset and angle — the scene's billboard pass must not re-rotate it.
        this.healthBars = scene.add.graphics().setDepth(CONFIG.world.height + 1000);
        rotatesWithCamera(this.healthBars);
        layer.add(this.healthBars);

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
            this.pHealAoe[t] = healAoeFor(key);
        }
        this.pArmourMult = armourMult();
    }

    // Archer special: begin a long shot — pick a far enemy (beyond normal reach), then STOP and
    // slowly draw for drawTime ms (the Shoot strip stretched to fill it). The arrow looses at the
    // end (releaseLongShot). Only started when no enemy is in normal range (see step()).
    private startLongShot(i: number) {
        const ls = CONFIG.abilities.longshot;
        const f = this.faction[i];
        const dir = f === FACTION.player ? 1 : -1;
        const minDist = CONFIG.unitTypes[this.type[i]].range; // shoot past normal range
        const min2 = minDist * minDist;
        const reach = minDist + ls.bonusRange;
        const max2 = reach * reach;
        const xi = this.x[i];
        const yi = this.y[i];

        const cand = this.longScratch;
        cand.length = 0;
        for (let j = 0; j < this.count; j++) {
            if (this.state[j] === STATE.dying || this.faction[j] === f) continue;
            const dx = this.x[j] - xi;
            if (dx * dir <= 0) continue; // must be ahead of the archer
            const dy = this.y[j] - yi;
            const d2 = dx * dx + dy * dy;
            if (d2 < min2 || d2 > max2) continue;
            cand.push(j);
        }
        if (!cand.length) {
            this.abilityCd[i] = 300; // nothing far to shoot — try again soon
            return;
        }
        const target = cand[(Math.random() * cand.length) | 0];
        // Aim where the target is now (with scatter); it may move during the draw — that misses.
        this.drawLx[i] = this.x[target] + Phaser.Math.FloatBetween(-ls.spread, ls.spread);
        this.drawLy[i] = this.y[target] + Phaser.Math.FloatBetween(-ls.spread, ls.spread);
        this.drawTimer[i] = ls.drawTime;

        // Play the Shoot strip stretched over the whole draw, so the bow draws slowly.
        const sprite = this.sprites[i]!;
        const art = this.typeArt[this.type[i]];
        sprite.play(animKey(art, FACTION_NAME[f], 'attack'));
        const shootMs = this.typeAttackAnimMs[this.type[i]] || ls.drawTime;
        sprite.anims.timeScale = Math.max(0.05, shootMs / ls.drawTime);
    }

    // Draw finished: loose the arrow (resolved where it lands), reset animation speed, cooldown.
    private releaseLongShot(i: number) {
        const ls = CONFIG.abilities.longshot;
        const f = this.faction[i];
        const sprite = this.sprites[i]!;
        sprite.anims.timeScale = 1;
        if (this.onLongShot) this.onLongShot(this.x[i], this.y[i] - 40, this.drawLx[i], this.drawLy[i], f as Faction);
        this.abilityCd[i] = ls.cooldown;
        this.playStateAnim(i); // back to idle / walk
    }

    // Called when a long-shot arrow lands: damage the nearest enemy at the impact point if
    // one is within hitRadius (otherwise it simply missed).
    resolveLongShotHit(x: number, y: number, attacker: Faction) {
        const ls = CONFIG.abilities.longshot;
        let best = -1;
        let bestD2 = ls.hitRadius * ls.hitRadius;
        for (let j = 0; j < this.count; j++) {
            if (this.state[j] === STATE.dying || this.faction[j] === attacker) continue;
            const dx = this.x[j] - x;
            const dy = this.y[j] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestD2) {
                bestD2 = d2;
                best = j;
            }
        }
        if (best < 0) return; // missed — no unit where it landed
        const at = this.longshotType >= 0 ? this.longshotType : 0;
        const base = this.typeDamage[at] + (attacker === FACTION.player ? this.pDamageBonus[at] : 0);
        let scaled = base * this.pairMul[at * this.nTypes + this.type[best]];
        if (this.faction[best] === FACTION.player) scaled *= this.pArmourMult;
        const dmg = Math.max(1, Math.round(scaled));
        this.hp[best] -= dmg;
        matchStats.unitDamage(attacker, at, this.faction[best], this.type[best], dmg);
        if (this.onDamage && CONFIG.debug.damageNumbers) this.onDamage(this.x[best], this.y[best] - 50, dmg);
        if (this.hp[best] <= 0) this.kill(best);
    }

    // Called when an Arrow Volley arrow lands at (x, y). `caster` is the side that cast the
    // volley; the arrow damages the nearest OPPOSING unit within the volley's hitRadius (flat,
    // tunable damage) — arrows landing on empty ground or on friendlies do nothing. Returns
    // true if it actually struck a unit.
    resolveVolleyHit(x: number, y: number, caster: Faction): boolean {
        const av = CONFIG.abilities.arrowVolley;
        let best = -1;
        let bestD2 = av.hitRadius * av.hitRadius;
        for (let j = 0; j < this.count; j++) {
            if (this.state[j] === STATE.dying || this.faction[j] === caster) continue;
            const dx = this.x[j] - x;
            const dy = this.y[j] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestD2) {
                bestD2 = d2;
                best = j;
            }
        }
        if (best < 0) return false; // hit empty ground
        const dmg = Math.max(1, Math.round(av.damage));
        this.hp[best] -= dmg;
        matchStats.skillDamageDealt(caster, this.faction[best], this.type[best], dmg);
        if (this.onDamage && CONFIG.debug.damageNumbers) this.onDamage(this.x[best], this.y[best] - 50, dmg);
        if (this.hp[best] <= 0) this.kill(best);
        return true;
    }

    // Max HP of a unit, including the player's +Health upgrade and the global HP scale (so
    // heals and the health bar use the real maximum, not the base value).
    private maxHpOf(j: number): number {
        const base = this.typeHp[this.type[j]] + (this.faction[j] === FACTION.player ? this.pHpBonus[this.type[j]] : 0);
        return Math.max(1, Math.round(base * CONFIG.combat.hpScale));
    }

    // Monk Heal-area upgrade: top up every wounded ally within heal range (pops a green
    // number on each), including the Monk itself.
    private areaHeal(healer: number, acting: number) {
        const f = this.faction[healer];
        const r2 = this.typeRange2[acting];
        const amt = this.typeHealAmount[acting];
        const xi = this.x[healer];
        const yi = this.y[healer];
        for (let j = 0; j < this.count; j++) {
            if (this.state[j] === STATE.dying || this.faction[j] !== f) continue;
            const maxHp = this.maxHpOf(j);
            if (this.hp[j] >= maxHp) continue;
            const dx = this.x[j] - xi;
            const dy = this.y[j] - yi;
            if (dx * dx + dy * dy > r2) continue;
            const healed = Math.min(amt, maxHp - this.hp[j]);
            this.hp[j] += healed;
            if (healed > 0) {
                this.healFlash(j);
                if (this.onHeal && CONFIG.debug.damageNumbers) this.onHeal(this.x[j], this.y[j] - 50, healed);
            }
        }
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

    // Total living (non-dying) units on a side — for peak-army stats.
    livingCount(faction: Faction): number {
        return this.livingByFaction[faction];
    }

    // ---- Player commands (selection lives in the UI; orders are stored per unit here) ----

    // Visit every living PLAYER unit (its index, type, and position). Used by the command UI to
    // draw selection rings and to gather the units a command targets.
    forEachPlayerUnit(cb: (i: number, type: number, x: number, y: number) => void) {
        for (let i = 0; i < this.count; i++) {
            // Garrison defenders are pinned to their building — never selectable/commandable.
            if (this.faction[i] !== FACTION.player || this.state[i] === STATE.dying || this.garrison[i]) continue;
            cb(i, this.type[i], this.x[i], this.y[i]);
        }
    }

    // Give unit `i` an order with an anchor / formation-slot at (ax, ay). The y is clamped into
    // the lane band so a slot is always reachable. Resets the unit to walk so movement re-plans.
    setOrder(i: number, order: Order, ax: number, ay: number) {
        if (i < 0 || i >= this.count || this.state[i] === STATE.dying || this.garrison[i]) return;
        this.order[i] = order;
        this.destX[i] = ax;
        this.destY[i] = this.clampLaneY(ay);
        this.target[i] = -1;
        this.setState(i, STATE.walk);
    }

    // Record the standing order for a player unit type, so units of that type that SPAWN later
    // inherit it (with the given rally point). Pass ORDER.auto to clear it (resume auto-advance).
    setStandingOrder(typeIndex: number, order: Order, x: number, y: number) {
        if (typeIndex < 0 || typeIndex >= this.nTypes) return;
        this.standingOrder[typeIndex] = order;
        this.standingX[typeIndex] = x;
        this.standingY[typeIndex] = y;
    }

    // Clamp a world y into the lane band (so commanded destinations stay on the battlefield).
    clampLaneY(y: number): number {
        return Phaser.Math.Clamp(y, this.laneY[0] - this.laneHalf[0], this.laneY[0] + this.laneHalf[0]);
    }

    // Damage the opposing keep with unit `i`, then recycle it (shared by the auto-march and the
    // commanded-onto-the-keep paths).
    private reachKeep(i: number) {
        this.onReachKeep(this.faction[i] as Faction);
        matchStats.reachedKeep(this.faction[i], this.type[i], CONFIG.keep.damagePerUnit);
        this.livingByFaction[this.faction[i]]--;
        this.livingByType[this.type[i] * 2 + this.faction[i]]--;
        this.releaseProducer(i);
        this.despawn(i);
    }

    // Is any OPPOSING combat unit within `radius` of (x, y)? Used by the peasant system so
    // workers flee/die when an enemy army reaches their gathering line (Phase 4 harassment).
    // `faction` is the worker's own side — units of that side don't threaten it.
    threatNear(faction: Faction, x: number, y: number, radius: number): boolean {
        const r2 = radius * radius;
        for (let j = 0; j < this.count; j++) {
            if (this.state[j] === STATE.dying || this.faction[j] === faction) continue;
            const dx = this.x[j] - x;
            const dy = this.y[j] - y;
            if (dx * dx + dy * dy <= r2) return true;
        }
        return false;
    }

    update(delta: number) {
        this.reacquireAcc += delta;
        if (this.reacquireAcc >= CONFIG.combat.reacquireMs) {
            this.reacquireAcc = 0;
            this.acquireTargets();
        }

        this.step(delta);
        this.applySeparation(delta);
        this.applyObstacles(delta);
        this.repositionGarrison();
        this.drawHealthBars();
    }

    // Push units out of building footprints so they flow around buildings instead of through
    // them. Soft (capped per frame) so a marching crowd slides around rather than hard-stopping;
    // keeps are deliberately not in the list, so units can still reach and sack them.
    private applyObstacles(delta: number) {
        if (!this.obstacleProvider) return;
        const obs = this.obstacleProvider();
        if (obs.length === 0) return;
        const maxStep = CONFIG.command.obstaclePush * (delta / 1000);
        const unitR = CONFIG.separation.radius * 0.5;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying || this.garrison[i]) continue; // defenders are pinned
            const ln = this.lane[i];
            const yMin = this.laneY[ln] - this.laneHalf[ln];
            const yMax = this.laneY[ln] + this.laneHalf[ln];
            for (let o = 0; o < obs.length; o++) {
                const ob = obs[o];
                const dx = this.x[i] - ob.x;
                const dy = this.y[i] - ob.y;
                const minD = ob.r + unitR;
                const d2 = dx * dx + dy * dy;
                if (d2 >= minD * minD) continue;
                const fwd = this.faction[i] === FACTION.player ? 1 : -1;
                let nx: number;
                let ny: number;
                if (d2 < 0.01) {
                    // Dead-centre (e.g. just spawned inside its own producer): exit forwards.
                    nx = fwd * minD;
                    ny = 0;
                } else {
                    const d = Math.sqrt(d2);
                    const pen = minD - d;
                    // Radial push out of the footprint…
                    const rxn = dx / d;
                    const ryn = dy / d;
                    // …plus a TANGENTIAL slide so a unit pressing straight into a building rounds
                    // it instead of stalling. Bias the tangent toward the unit's forward heading.
                    let txn = -ryn;
                    let tyn = rxn;
                    if (txn * fwd < 0) { txn = -txn; tyn = -tyn; }
                    nx = (rxn + txn * 0.9) * pen;
                    ny = (ryn + tyn * 0.9) * pen;
                }
                const m = Math.hypot(nx, ny);
                if (m > maxStep) { const s = maxStep / m; nx *= s; ny *= s; }
                this.x[i] += nx;
                this.y[i] = Phaser.Math.Clamp(this.y[i] + ny, yMin, yMax);
                this.syncSprite(i);
            }
        }
    }

    // Wire the building system's footprints in (called once after buildings exist).
    setObstacleProvider(fn: () => { x: number; y: number; r: number }[]) {
        this.obstacleProvider = fn;
    }

    // ---- Spawning (driven externally by the production buildings) ----

    // Living (non-dying) units attributed to a producer id — drives per-building unit caps.
    producerLivingCount(producerId: number): number {
        return this.livingByProducer.get(producerId) ?? 0;
    }

    // Spawn one unit of `typeIndex` for `faction` at (x, y); y is clamped into the lane band
    // so the horde stays readable. `producerId` attributes the unit to the building that made
    // it (-1 = unattributed) so that building can cap its live count. Returns false if the side
    // is at its cap or the pool is exhausted. Called by the Buildings system on each beat.
    spawnAt(faction: Faction, typeIndex: number, x: number, y: number, producerId = -1): boolean {
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
        const baseHp = this.typeHp[t] + (faction === FACTION.player ? this.pHpBonus[t] : 0);
        this.hp[i] = Math.max(1, Math.round(baseHp * CONFIG.combat.hpScale));
        this.faction[i] = faction;
        this.state[i] = STATE.walk;
        this.target[i] = -1;
        this.animLock[i] = 0;
        this.drawTimer[i] = 0;
        this.attackCd[i] = Phaser.Math.FloatBetween(0, this.typeAttackInterval[t]); // desync
        this.abilityCd[i] = this.typeKnockback[t]
            ? Phaser.Math.FloatBetween(0, CONFIG.abilities.knockback.cooldown)
            : this.typeLongshot[t]
                ? Phaser.Math.FloatBetween(0, CONFIG.abilities.longshot.cooldown)
                : 0;
        this.deathTimer[i] = 0;
        this.lane[i] = 0;
        this.type[i] = t;
        this.producer[i] = producerId;
        // Inherit the type's standing order so reinforcements join the last command given to
        // that type; otherwise march on the keep (auto). Enemy units never have a standing order.
        const standing = faction === FACTION.player ? this.standingOrder[t] : ORDER.auto;
        this.order[i] = standing;
        this.destX[i] = standing === ORDER.auto ? 0 : this.standingX[t];
        this.destY[i] = standing === ORDER.auto ? 0 : this.clampLaneY(this.standingY[t]);
        this.moving[i] = 1; // spawns marching (walk anim)
        this.rangeMul[i] = 1;
        this.garrison[i] = 0;
        this.level[i] = 0;
        this.sprites[i] = sprite;
        this.livingByFaction[faction]++;
        this.livingByType[t * 2 + faction]++;
        if (producerId >= 0) this.livingByProducer.set(producerId, (this.livingByProducer.get(producerId) ?? 0) + 1);
        matchStats.produce(faction, t);

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
        sprite.anims.timeScale = 1; // clear any stretched long-shot draw from a previous user
        return true;
    }

    // Post a pinned building defender (an archer) at (x, y): same combat behaviour as a normal
    // archer but with its normal range multiplied (CONFIG.garrison.rangeMul), holding its post.
    // Bypasses the faction cap + lane clamp; rendered above buildings so it reads as "on top".
    // (x, y) is the defender's fixed combat point (its θ=0 roof spot). offRight/offUp are the
    // SCREEN-space offset from the building base to that spot, so repositionGarrison can keep the
    // sprite on the roof as the battlefield turns.
    spawnDefender(faction: Faction, typeIndex: number, x: number, y: number, offRight: number, offUp: number): boolean {
        const sprite = this.freeSprites.pop();
        if (!sprite) return false;
        const t = typeIndex;
        const i = this.count++;

        this.x[i] = x;
        this.y[i] = y;
        this.gOffRight[i] = offRight;
        this.gOffUp[i] = offUp;
        this.speed[i] = this.typeMoveSpeed[t];
        const baseHp = this.typeHp[t] + (faction === FACTION.player ? this.pHpBonus[t] : 0);
        this.hp[i] = Math.max(1, Math.round(baseHp * CONFIG.combat.hpScale));
        this.faction[i] = faction;
        this.state[i] = STATE.walk;
        this.target[i] = -1;
        this.animLock[i] = 0;
        this.drawTimer[i] = 0;
        this.attackCd[i] = Phaser.Math.FloatBetween(0, this.typeAttackInterval[t]);
        this.abilityCd[i] = this.typeLongshot[t] ? Phaser.Math.FloatBetween(0, CONFIG.abilities.longshot.cooldown) : 0;
        this.deathTimer[i] = 0;
        this.lane[i] = 0;
        this.type[i] = t;
        this.producer[i] = -1;
        this.order[i] = ORDER.hold; // hold the post — never marches
        this.destX[i] = x;
        this.destY[i] = y;
        this.moving[i] = 0;
        this.rangeMul[i] = CONFIG.garrison.rangeMul;
        this.garrison[i] = 1;
        this.level[i] = 1; // on the roof — only ranged enemies can hit it
        this.sprites[i] = sprite;
        this.livingByFaction[faction]++;
        this.livingByType[t * 2 + faction]++;
        matchStats.produce(faction, t);

        sprite
            .setActive(true)
            .setVisible(true)
            .setAlpha(1)
            .setScale(this.typeScale[t])
            .setOrigin(0.5, this.typeFootAnchor[t])
            .setPosition(x, y)
            .setDepth(CONFIG.world.height + 800) // above buildings, so it reads as "on top"
            .setFlipX(faction === FACTION.enemy)
            .play(animKey(this.typeArt[t], FACTION_NAME[faction], 'idle'));
        sprite.anims.timeScale = 1;
        return true;
    }

    // ---- Targeting (bucketed by lane x; only nearby cells are tested) ----

    private acquireTargets() {
        // Units look this far to pick an enemy to advance on; they only STRIKE within their own
        // (shorter) range. Squared once per pass.
        const aggro2 = CONFIG.combat.aggroRange * CONFIG.combat.aggroRange;
        const free2 = CONFIG.command.freeRadius * CONFIG.command.freeRadius;
        for (let c = 0; c < this.numCells; c++) this.buckets[c].length = 0;

        // Bucket living units by x-cell (support units included — they are valid targets), and
        // track each side's frontline (furthest-forward combat unit) for the healers to trail.
        this.frontX[FACTION.player] = this.playerKeepX;
        this.frontX[FACTION.enemy] = this.enemyKeepX;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            this.buckets[this.cellOf(i)].push(i);
            if (this.typeCanAttack[this.type[i]]) {
                const f = this.faction[i];
                if (f === FACTION.player) { if (this.x[i] > this.frontX[f]) this.frontX[f] = this.x[i]; }
                else if (this.x[i] < this.frontX[f]) this.frontX[f] = this.x[i];
            }
        }

        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;

            // A Move order ignores everything (even a Monk's heals) — the unit just walks to its
            // slot. Checked first so it applies to combat and support units alike.
            if (this.order[i] === ORDER.move) {
                this.target[i] = -1;
                this.setState(i, STATE.walk);
                continue;
            }

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

            const ord = this.order[i];
            const rm2 = this.rangeMul[i] * this.rangeMul[i]; // garrison archers see/strike 2× as far
            const range2 = (this.faction[i] === FACTION.player
                ? this.pRange2[this.type[i]]
                : this.typeRange2[this.type[i]]) * rm2;
            // Perceive at least the aggro radius (so melee chase) but never less than the unit's
            // own strike range (so long-range units still target everything they can hit). A
            // Hold order shrinks perception to strike range so the unit never leaves its post.
            const seek2 = ord === ORDER.hold ? range2 : Math.max(range2, aggro2);
            const ci = this.cellOf(i);
            let best = -1;
            let bestD2 = Infinity;
            // Only this cell and its immediate neighbours can hold a nearby enemy.
            for (let dc = -1; dc <= 1; dc++) {
                const c = ci + dc;
                if (c < 0 || c >= this.numCells) continue;
                const bucket = this.buckets[c];
                for (let k = 0; k < bucket.length; k++) {
                    const j = bucket[k];
                    if (this.faction[j] === this.faction[i]) continue;
                    // Elevation: a melee attacker can't reach a target on a different level (e.g.
                    // ground units can't hit roof-top garrison archers); ranged can hit any level.
                    if (this.level[i] !== this.level[j] && !this.typeRanged[this.type[i]]) continue;
                    const dx = this.x[j] - this.x[i];
                    const dy = this.y[j] - this.y[i];
                    const d2 = dx * dx + dy * dy;
                    if (d2 > seek2 || d2 >= bestD2) continue;
                    // Free roam only hunts enemies inside the ordered area (around the anchor).
                    if (ord === ORDER.free) {
                        const ax = this.x[j] - this.destX[i];
                        const ay = this.y[j] - this.destY[i];
                        if (ax * ax + ay * ay > free2) continue;
                    }
                    bestD2 = d2;
                    best = j;
                }
            }
            this.target[i] = best;
            // In strike range → attack; acquired but still approaching → walk (the walk step
            // steers toward the target instead of marching straight ahead).
            this.setState(i, best >= 0 && bestD2 <= range2 ? STATE.attack : STATE.walk);
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

            // Mid long-shot draw: the archer stands frozen and slowly draws; loose at the end.
            if (this.drawTimer[i] > 0) {
                this.drawTimer[i] -= delta;
                if (this.drawTimer[i] <= 0) this.releaseLongShot(i);
                continue;
            }

            // A one-shot pose (block / shoot) holds for its duration, then we resume the
            // animation that matches the unit's current state.
            if (this.animLock[i] > 0) {
                this.animLock[i] -= delta;
                if (this.animLock[i] <= 0) this.playStateAnim(i);
            }
            // Archers lob a long shot ONLY as a fallback: when no enemy is in normal range
            // (no target, so they're marching), and the ability is off cooldown.
            if (this.typeLongshot[this.type[i]] && this.abilityCd[i] <= 0
                && st === STATE.walk && this.target[i] < 0) {
                this.startLongShot(i);
                continue; // begin the draw this frame
            }

            if (st === STATE.walk) {
                const sprite = this.sprites[i]!;
                const ln = this.lane[i];
                const yMin = this.laneY[ln] - this.laneHalf[ln];
                const yMax = this.laneY[ln] + this.laneHalf[ln];
                const ord = this.order[i];

                // Advance on an acquired-but-not-yet-reachable enemy: steer toward it in both
                // axes so melee close the gap instead of marching past offset foes. A Holding
                // unit never chases — it waits for the enemy to enter its strike range.
                const tgt = this.target[i];
                if (ord !== ORDER.hold && tgt >= 0 && tgt < this.count && this.state[tgt] !== STATE.dying
                    && this.faction[tgt] !== this.faction[i]) {
                    const dx = this.x[tgt] - this.x[i];
                    const dy = this.y[tgt] - this.y[i];
                    const d = Math.hypot(dx, dy) || 1;
                    this.face(i, dx);
                    const stepLen = this.speed[i] * dt;
                    this.x[i] += (dx / d) * stepLen;
                    this.y[i] = Phaser.Math.Clamp(this.y[i] + (dy / d) * stepLen, yMin, yMax);
                    this.syncSprite(i);
                    this.setMoving(i, true);
                    continue;
                }

                // Hold / Free with nothing to fight: sit on the anchor, drifting back to it if
                // separation (or a chase that ended) shoved the unit off its post.
                if (ord === ORDER.hold || ord === ORDER.free) {
                    const dx = this.destX[i] - this.x[i];
                    const dy = this.destY[i] - this.y[i];
                    const d = Math.hypot(dx, dy);
                    if (d > CONFIG.command.holdReturn) {
                        const stepLen = Math.min(this.speed[i] * dt, d);
                        this.x[i] += (dx / d) * stepLen;
                        this.y[i] = Phaser.Math.Clamp(this.y[i] + (dy / d) * stepLen, yMin, yMax);
                        this.syncSprite(i);
                        this.face(i, dx);
                        this.setMoving(i, true);
                    } else {
                        this.setMoving(i, false); // standing on post → idle
                    }
                    continue;
                }

                // Move / Attack-move: walk to the formation slot, then dig in (Hold) on arrival.
                if (ord === ORDER.move || ord === ORDER.attackMove) {
                    const dx = this.destX[i] - this.x[i];
                    const dy = this.destY[i] - this.y[i];
                    const d = Math.hypot(dx, dy);
                    if (d <= CONFIG.command.arrive) {
                        this.order[i] = ORDER.hold;
                        this.destX[i] = this.x[i];
                        this.destY[i] = this.y[i];
                        this.target[i] = -1;
                        this.setMoving(i, false); // arrived → stand idle
                        continue;
                    }
                    const stepLen = Math.min(this.speed[i] * dt, d);
                    this.x[i] += (dx / d) * stepLen;
                    this.y[i] = Phaser.Math.Clamp(this.y[i] + (dy / d) * stepLen, yMin, yMax);
                    this.syncSprite(i);
                    this.face(i, dx);
                    this.setMoving(i, true);
                    // A unit commanded onto the enemy keep still sacks it.
                    if (this.faction[i] === FACTION.player && this.x[i] >= this.enemyKeepX) this.reachKeep(i);
                    continue;
                }

                // Support healers (Monks) trail the frontline and idle when caught up — they tend
                // the army from behind and rest between heals, instead of charging the keep.
                if (this.typeHealAmount[this.type[i]] > 0) {
                    const goalX = this.faction[i] === FACTION.player ? this.frontX[0] - 90 : this.frontX[1] + 90;
                    const dx = goalX - this.x[i];
                    if (Math.abs(dx) > 10) {
                        this.x[i] += Math.sign(dx) * Math.min(this.speed[i] * dt, Math.abs(dx));
                        this.syncSprite(i);
                        this.face(i, dx);
                        this.setMoving(i, true);
                    } else {
                        this.setMoving(i, false); // caught up — idle behind the line
                    }
                    continue;
                }

                // ORDER.auto: the original flow — funnel into the lane-path centre, then march on
                // the keep. Read lane width live so the Dev "Lane width" applies instantly.
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
                this.face(i, dir);
                this.setMoving(i, true);
                const reachedEnd = dir > 0 ? this.x[i] >= this.enemyKeepX : this.x[i] <= this.playerKeepX;
                if (reachedEnd) this.reachKeep(i);
                continue;
            }

            // STATE.attack == "acting": a combat strike, or a heal for support healers,
            // applied on this unit type's own cadence.
            this.attackCd[i] -= delta;
            if (this.attackCd[i] > 0) continue;
            const acting = this.type[i];
            const t = this.target[i];

            if (this.typeHealAmount[acting] > 0) {
                const f = this.faction[i];
                // Player Monk with the Heal-area upgrade tops up everyone nearby; otherwise
                // it heals the single lowest-HP ally it acquired.
                if (f === FACTION.player && this.pHealAoe[acting]) {
                    const hasTarget = t >= 0 && t < this.count && this.state[t] !== STATE.dying && this.faction[t] === f;
                    if (hasTarget) {
                        this.attackCd[i] += this.typeHealInterval[acting];
                        this.areaHeal(i, acting);
                        this.playOneShot(i, 'heal', this.typeHealAnimMs[acting]);
                        continue;
                    }
                } else {
                    const maxHp = t >= 0 && t < this.count ? this.maxHpOf(t) : 0;
                    const okHeal =
                        t >= 0 && t < this.count && this.state[t] !== STATE.dying &&
                        this.faction[t] === f && this.hp[t] < maxHp;
                    if (okHeal) {
                        const dx = this.x[t] - this.x[i];
                        const dy = this.y[t] - this.y[i];
                        if (dx * dx + dy * dy <= this.typeRange2[acting]) {
                            this.attackCd[i] += this.typeHealInterval[acting];
                            const healed = Math.min(this.typeHealAmount[acting], maxHp - this.hp[t]);
                            this.hp[t] += healed;
                            if (healed > 0) {
                                this.healFlash(t);
                                if (this.onHeal && CONFIG.debug.damageNumbers) this.onHeal(this.x[t], this.y[t] - 50, healed);
                            }
                            this.playOneShot(i, 'heal', this.typeHealAnimMs[acting]);
                            continue;
                        }
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
            const reach2 = (atkF === FACTION.player ? this.pReach2[acting] : this.typeReach2[acting])
                * this.rangeMul[i] * this.rangeMul[i];
            if (validTarget) {
                const dx = this.x[t] - this.x[i];
                const dy = this.y[t] - this.y[i];
                this.face(i, dx); // turn to face whatever we're striking
                if (dx * dx + dy * dy <= reach2) {
                    this.attackCd[i] += this.typeAttackInterval[acting] * CONFIG.combat.attackIntervalScale;
                    this.playOneShot(i, 'attack', this.typeAttackAnimMs[acting]); // one swing per beat
                    // Defender's block (innate, both sides): chance to fully negate the hit.
                    const blockChance = this.typeBlockChance[this.type[t]];
                    if (blockChance > 0 && Math.random() < blockChance) {
                        if (this.onBlock && CONFIG.debug.damageNumbers) this.onBlock(this.x[t], this.y[t] - 50);
                        this.playOneShot(t, 'block', 480); // raise the guard pose
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
                    matchStats.unitDamage(atkF, acting, this.faction[t], this.type[t], dmg);
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

        // Rebuild x-buckets for living units (garrison defenders are pinned — excluded entirely
        // so they neither push nor get pushed).
        for (let c = 0; c < this.numSepCells; c++) this.sepBuckets[c].length = 0;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying || this.garrison[i]) continue;
            this.sepBuckets[this.sepCellOf(i)].push(i);
        }

        // Accumulate a push vector per unit from neighbours in this + adjacent x-cells.
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying || this.garrison[i]) continue;
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
                        // Anti-column: two units nearly in single file (small vertical gap)
                        // barely separate from the radial push alone, so the rear keeps bumping
                        // the one ahead. Add a sideways nudge so they fan out and flow around.
                        if (Math.abs(dy) < 10) py += (i < j ? -1 : 1) * w;
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
        matchStats.death(this.faction[i], this.type[i]);
        this.livingByFaction[this.faction[i]]--;
        this.livingByType[this.type[i] * 2 + this.faction[i]]--;
        this.releaseProducer(i);
        this.state[i] = STATE.dying;
        this.target[i] = -1;
        this.deathTimer[i] = this.deathDuration;
        // No death animation in the pack: freeze on the current frame and dim, then the
        // dying branch in step() fades it out before recycling.
        this.sprites[i]!.anims.stop();
        this.sprites[i]!.setTint(0x6a6a6a);
    }

    // Drop a unit from its producer's live tally (on death or on reaching the keep) so the
    // building may spawn a replacement. Clears the attribution so it can't be counted twice.
    private releaseProducer(i: number) {
        const id = this.producer[i];
        if (id < 0) return;
        const n = (this.livingByProducer.get(id) ?? 0) - 1;
        if (n > 0) this.livingByProducer.set(id, n);
        else this.livingByProducer.delete(id);
        this.producer[i] = -1;
    }

    private setState(i: number, next: number) {
        if (this.state[i] === next) return;
        this.state[i] = next;
        // If a one-shot pose (block / shoot) is showing, keep it; its expiry resumes the
        // (now-current) state's animation.
        if (this.animLock[i] > 0) return;
        this.playStateAnim(i);
    }

    // Play the looping animation that matches a unit's current state. Engaged units REST in idle
    // between strikes/heals; a unit in walk state plays walk only while actually locomoting —
    // a unit standing on its post (holding / arrived) shows idle, not a march in place.
    private playStateAnim(i: number) {
        const sprite = this.sprites[i];
        if (!sprite) return;
        const art = this.typeArt[this.type[i]];
        const name = FACTION_NAME[this.faction[i]];
        const walking = this.state[i] === STATE.walk && this.moving[i] === 1;
        sprite.play(animKey(art, name, walking ? 'walk' : 'idle'));
    }

    // Flip a unit's locomotion (walk vs idle) and reflect it immediately when it's in a plain
    // walk pose (not attacking, not mid one-shot). Called from the step loop each frame.
    private setMoving(i: number, m: boolean) {
        const v = m ? 1 : 0;
        if (this.moving[i] === v) return;
        this.moving[i] = v;
        if (this.state[i] === STATE.walk && this.animLock[i] <= 0) this.playStateAnim(i);
    }

    // Face the sprite along a horizontal direction (the art faces right, so flipX = facing left).
    // Ignores tiny/zero dx so purely-vertical motion doesn't waggle the facing.
    private face(i: number, dx: number) {
        const s = this.sprites[i];
        if (!s) return;
        if (dx > 0.01) s.setFlipX(false);
        else if (dx < -0.01) s.setFlipX(true);
    }

    // Push a unit's logical (x, y) onto its sprite, sorting by base-y so nearer units draw in front.
    private syncSprite(i: number) {
        const s = this.sprites[i]!;
        s.x = this.x[i];
        s.y = this.y[i];
        s.setDepth(this.y[i]);
    }

    // Play the Monk's heal effect over a unit that just got healed (visual feedback on the
    // TARGET), plus a brief green flash on the unit itself.
    private healFlash(j: number) {
        const s = this.sprites[j];
        if (!s) return;
        s.setTint(0x7be08a);
        s.scene.time.delayedCall(260, () => { if (s.tintTopLeft === 0x7be08a) s.clearTint(); });

        // A one-shot effect sprite centred on the unit's body; recycled when the anim finishes.
        const fx = s.scene.add.sprite(this.x[j], this.y[j] - s.displayHeight * 0.35, healEffectKey(FACTION_NAME[this.faction[j]]))
            .setDepth(this.y[j] + 1)
            .setScale(this.typeScale[this.type[j]] * 0.9);
        this.layer.add(fx);
        fx.once('animationcomplete', () => fx.destroy());
        fx.play(healEffectKey(FACTION_NAME[this.faction[j]]));
    }

    // Play a brief one-shot pose (a swing, heal gesture, or guard) over the current state's
    // loop; `durMs` is how long to hold it before resuming idle/walk.
    private playOneShot(i: number, anim: 'block' | 'attack' | 'heal', durMs: number) {
        if (durMs <= 0) return;
        const sprite = this.sprites[i];
        if (!sprite || this.state[i] === STATE.dying) return;
        const key = animKey(this.typeArt[this.type[i]], FACTION_NAME[this.faction[i]], anim);
        sprite.play(key);
        this.animLock[i] = durMs;
    }

    // Redraw every damaged unit's health bar (green→red) just above its head. One Graphics,
    // cleared and rebuilt each frame; undamaged units get no bar.
    private drawHealthBars() {
        const g = this.healthBars;
        g.clear();
        const W = 30;
        const H = 5;
        // Draw each bar upright (φ = −θ) at a screen-up offset, so bars stay horizontal and
        // above their unit even when the battlefield is turned.
        const phi = -cameraAngle(this.scene);
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        const off = new Phaser.Math.Vector2();
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STATE.dying) continue;
            const max = this.maxHpOf(i);
            if (this.hp[i] >= max) continue; // full health — no bar
            const frac = Math.max(0, this.hp[i] / max);
            const sprite = this.sprites[i]!;
            // Centre of the bar: `up` px above the unit's anchor on screen.
            const up = sprite.displayHeight * this.typeFootAnchor[this.type[i]] + 2 - H / 2;
            screenOffset(this.scene, 0, up, off);
            const cx = this.x[i] + off.x;
            const cy = this.y[i] + off.y;
            // Backing box (W+2 × H+2), centred.
            this.fillRotRect(g, cx, cy, -(W + 2) / 2, -(H + 2) / 2, (W + 2) / 2, (H + 2) / 2, 0x000000, 0.55, cos, sin);
            // Fill bar grows from the left edge. Lerp green (full) → red (empty).
            const r = Math.round(0xd9 + (0x4a - 0xd9) * frac);
            const gg = Math.round(0x3a + (0xd6 - 0x3a) * frac);
            const b = Math.round(0x3a + (0x4a - 0x3a) * frac);
            this.fillRotRect(g, cx, cy, -W / 2, -H / 2, -W / 2 + W * frac, H / 2, (r << 16) | (gg << 8) | b, 1, cos, sin);
        }
    }

    // Fill an axis-aligned rectangle (given as local corners around cx,cy) rotated by the angle
    // whose cos/sin are passed in. Used to paint the health bars upright over a turned map.
    private fillRotRect(
        g: Phaser.GameObjects.Graphics,
        cx: number, cy: number,
        lx0: number, ly0: number, lx1: number, ly1: number,
        color: number, alpha: number, cos: number, sin: number,
    ) {
        const p = (x: number, y: number) => new Phaser.Math.Vector2(cx + x * cos - y * sin, cy + x * sin + y * cos);
        g.fillStyle(color, alpha);
        g.fillPoints([p(lx0, ly0), p(lx1, ly0), p(lx1, ly1), p(lx0, ly1)], true);
    }

    // Re-place a pinned garrison defender's SPRITE on its building's roof for the current screen
    // angle. The combat position (x/y) is the fixed θ=0 roof point; the building base is that
    // minus the θ=0 offset, and the sprite renders at base + the rotated screen offset, so the
    // defender appears on the roof at every orientation while its line-of-fire stays put.
    private repositionGarrison() {
        const off = new Phaser.Math.Vector2();
        for (let i = 0; i < this.count; i++) {
            if (!this.garrison[i] || this.state[i] === STATE.dying) continue;
            const baseX = this.x[i] - this.gOffRight[i];
            const baseY = this.y[i] + this.gOffUp[i];
            screenOffset(this.scene, this.gOffRight[i], this.gOffUp[i], off);
            const s = this.sprites[i]!;
            s.x = baseX + off.x;
            s.y = baseY + off.y;
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
            this.animLock[i] = this.animLock[last];
            this.drawTimer[i] = this.drawTimer[last];
            this.drawLx[i] = this.drawLx[last];
            this.drawLy[i] = this.drawLy[last];
            this.lane[i] = this.lane[last];
            this.type[i] = this.type[last];
            this.producer[i] = this.producer[last];
            this.order[i] = this.order[last];
            this.destX[i] = this.destX[last];
            this.destY[i] = this.destY[last];
            this.moving[i] = this.moving[last];
            this.rangeMul[i] = this.rangeMul[last];
            this.garrison[i] = this.garrison[last];
            this.level[i] = this.level[last];
            this.sprites[i] = this.sprites[last];
        }
        this.sprites[last] = undefined;
    }
}
