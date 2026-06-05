import { CONFIG } from '../config';
import { UnitManager } from '../units/UnitManager';

// Enemy "gather-then-charge": instead of letting every freshly-spawned enemy unit trickle
// forward, the enemy holds them at a rally point just ahead of its keep and only LAUNCHES once
// the gathered force's combined points (CONFIG.unitTypes[].points) cross a threshold. The bar
// rises by `growth` after each wave, so as the enemy adds producers its attacks stay big.
//
// Distinguishing waiting from launched units is free: a waiting unit is a non-garrison enemy on
// ORDER.hold; once released it becomes ORDER.auto and no longer counts (UnitManager handles the
// flag at spawn and the release). The current threshold is recomputed each tick from the wave
// count, so live Dev edits to the base/growth knobs take effect immediately.

const CHECK_EVERY = 200; // ms between muster checks (cheap; no need to scan every frame)

export class EnemyMuster {
    private readonly units: UnitManager;
    private waves = 0;
    private acc = 0;

    constructor(units: UnitManager) {
        this.units = units;
    }

    update(delta: number) {
        const m = CONFIG.enemyAI.muster;
        if (!m.enabled) {
            // Feature off → spawn enemies straight into auto-march (the old steady stream).
            this.units.setEnemyMuster(false, 0);
            return;
        }
        this.units.setEnemyMuster(true, m.rallyOffset);

        this.acc += delta;
        if (this.acc < CHECK_EVERY) return;
        this.acc = 0;

        const threshold = m.startThreshold + m.growth * this.waves;
        if (this.units.enemyMusterPoints() >= threshold) {
            this.units.releaseEnemyMuster();
            this.waves++;
        }
    }
}
