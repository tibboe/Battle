import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { FACTION, UnitManager } from '../units/UnitManager';
import { Buildings } from '../structures/buildings';
import { spawnPuff } from '../units/effects';

// Enemy reinforcement arrivals — a THIRD enemy spawn source alongside its built producers and the
// muster. On a fixed countdown (CONFIG.enemyAI.reinforcements.intervalSeconds, a Dev knob) a fresh
// squad PUFFS into existence just below the enemy keep and marches straight at the player base
// (forceAuto, so it ignores the gather-then-charge muster). Each wave escalates: more units, and —
// as waves stack — more variety, unlocking the roster from warriors outward. The scene reads
// `secondsToNext` to drive the on-screen reinforcement countdown.

// Escalating roster: earlier entries arrive first; later waves unlock the next types so squads grow
// in diversity as well as size. Keys must match CONFIG.unitTypes.
const ROSTER = ['warrior', 'archer', 'lancer', 'monk'];

export class EnemyReinforcements {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;
    private readonly buildings: Buildings;
    private acc = 0;   // ms accumulated toward the next arrival
    private waves = 0; // arrivals released so far (drives the escalation)

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        units: UnitManager,
        buildings: Buildings,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;
        this.buildings = buildings;
    }

    update(delta: number) {
        const r = CONFIG.enemyAI.reinforcements;
        // Off → hold the countdown at full so turning it back on starts a fresh interval.
        if (!r.enabled) { this.acc = 0; return; }

        this.acc += delta;
        const interval = r.intervalSeconds * 1000;
        if (this.acc < interval) return;
        this.acc -= interval;
        this.spawnWave();
        this.waves++;
    }

    // Seconds remaining until the next arrival (for the HUD countdown). 0 when disabled.
    get secondsToNext(): number {
        const r = CONFIG.enemyAI.reinforcements;
        if (!r.enabled) return 0;
        return Math.max(0, r.intervalSeconds - this.acc / 1000);
    }

    get enabled(): boolean { return CONFIG.enemyAI.reinforcements.enabled; }
    get wave(): number { return this.waves; }

    private spawnWave() {
        const r = CONFIG.enemyAI.reinforcements;
        const count = Math.min(r.maxCount, r.baseCount + Math.floor(this.waves * r.countGrowth));
        const unlocked = Math.min(ROSTER.length, 1 + Math.floor(this.waves / r.diversifyEvery));

        // Spawn just BELOW the enemy keep; the puff + squad appear there and head left for the player.
        const keep = this.buildings.keepPosition(FACTION.enemy);
        const baseX = keep.x;
        const baseY = keep.y + r.spawnOffsetY;

        for (let n = 0; n < count; n++) {
            const key = ROSTER[n % unlocked];
            const t = CONFIG.unitTypes.findIndex((u) => u.key === key);
            if (t < 0) continue; // roster/config drift — skip an unknown key
            const x = baseX + Phaser.Math.Between(-r.spawnSpread, r.spawnSpread);
            const y = baseY + Phaser.Math.Between(-r.spawnSpread, r.spawnSpread) * 0.4;
            // forceAuto: march straight on the player keep even while the muster is enabled.
            if (this.units.spawnAt(FACTION.enemy, t, x, y, -1, true)) {
                spawnPuff(this.scene, this.layer, x, y);
            }
        }
    }
}
