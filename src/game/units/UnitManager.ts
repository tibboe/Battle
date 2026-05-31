import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { ANIM, MELEE_KEY } from './animations';

// Data-oriented horde with sprite pooling (Milestone 1 architecture requirements).
//
//  - Units are plain records in parallel typed arrays (struct-of-arrays), kept compact
//    via swap-remove. No per-unit class instances, no per-unit update loop.
//  - A fixed pool of sprites is created ONCE up front; spawning borrows one and death/
//    exit returns it. Nothing is created or destroyed mid-battle.
//  - Movement is plain position maths along the lane; no physics bodies.
//
// Phase 3 has no combat yet: units just march to the far keep and recycle. Combat
// (neighbour-based targeting, attack/death) lands in Phase 4.

export const FACTION = { player: 0, enemy: 1 } as const;
export type Faction = (typeof FACTION)[keyof typeof FACTION];

export class UnitManager {
    private readonly capacity: number;

    // Number of active units (always packed into indices 0..count-1).
    private count = 0;
    private countByFaction: [number, number] = [0, 0];

    // Struct-of-arrays. Index i refers to one active unit across all of these.
    private readonly x: Float32Array;
    private readonly y: Float32Array;
    private readonly speed: Float32Array;
    private readonly faction: Uint8Array;
    private readonly sprites: (Phaser.GameObjects.Sprite | undefined)[];

    // Pool of reusable sprites and per-side spawn accumulators.
    private readonly freeSprites: Phaser.GameObjects.Sprite[] = [];
    private readonly spawnAcc: [number, number] = [0, 0];

    private readonly playerKeepX: number;
    private readonly enemyKeepX: number;

    constructor(scene: Phaser.Scene) {
        this.capacity = CONFIG.spawn.unitsTarget * 2 + 40;

        this.x = new Float32Array(this.capacity);
        this.y = new Float32Array(this.capacity);
        this.speed = new Float32Array(this.capacity);
        this.faction = new Uint8Array(this.capacity);
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

        this.playerKeepX = CONFIG.keep.margin;
        this.enemyKeepX = CONFIG.world.width - CONFIG.keep.margin;
    }

    get activeCount(): number {
        return this.count;
    }

    update(delta: number) {
        this.handleSpawns(delta);
        this.moveUnits(delta);
    }

    private handleSpawns(delta: number) {
        const { spawnInterval, unitsTarget } = CONFIG.spawn;
        for (const f of [FACTION.player, FACTION.enemy] as const) {
            this.spawnAcc[f] += delta;
            if (this.spawnAcc[f] < spawnInterval) continue;
            this.spawnAcc[f] = 0;
            if (this.countByFaction[f] < unitsTarget) this.spawn(f);
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
        this.faction[i] = faction;
        this.sprites[i] = sprite;
        this.countByFaction[faction]++;

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

    private moveUnits(delta: number) {
        const dt = delta / 1000;
        // Iterate backwards because despawn() swap-removes from the tail.
        for (let i = this.count - 1; i >= 0; i--) {
            const dir = this.faction[i] === FACTION.player ? 1 : -1;
            this.x[i] += dir * this.speed[i] * dt;
            this.sprites[i]!.x = this.x[i];

            // Reached the opposing keep -> recycle (Phase 5 will damage the keep here).
            const reachedEnd = dir > 0 ? this.x[i] >= this.enemyKeepX : this.x[i] <= this.playerKeepX;
            if (reachedEnd) this.despawn(i);
        }
    }

    private despawn(i: number) {
        const sprite = this.sprites[i]!;
        sprite.stop();
        sprite.setActive(false).setVisible(false);
        this.freeSprites.push(sprite);
        this.countByFaction[this.faction[i]]--;

        // Swap the last active unit into slot i to keep the arrays packed.
        const last = --this.count;
        if (i !== last) {
            this.x[i] = this.x[last];
            this.y[i] = this.y[last];
            this.speed[i] = this.speed[last];
            this.faction[i] = this.faction[last];
            this.sprites[i] = this.sprites[last];
        }
        this.sprites[last] = undefined;
    }
}
