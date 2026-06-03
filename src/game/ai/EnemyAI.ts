import { CONFIG } from '../config';
import { FACTION } from '../units/UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { Buildings, catalogDef } from '../structures/buildings';

// The enemy's scripted build economy (Milestone 4 Phase 4 — the "hybrid" the director picked:
// enemy peasants gather for real and are harassable, but WHAT the enemy builds is scripted).
//
// Every CONFIG.enemyAI.decideEvery ms it looks at the next building in CONFIG.enemyAI.buildOrder
// and, if the enemy stockpile can afford it and a slot is free, pays for it and starts
// construction — an enemy peasant then hammers it up (PeasantManager dispatches builders for
// both sides). It SAVES UP rather than skipping, so raiding the enemy's gathering line (killing
// its peasants) directly slows its army. Once the plan is done it stops; harden the enemy by
// extending the order or shortening the cadence.

export class EnemyAI {
    private readonly buildings: Buildings;
    private readonly store: ResourceStore;
    private acc = 0;
    private planIndex = 0;

    constructor(buildings: Buildings, store: ResourceStore) {
        this.buildings = buildings;
        this.store = store;
    }

    update(delta: number) {
        const plan = CONFIG.enemyAI.buildOrder;
        if (this.planIndex >= plan.length) return; // plan complete

        this.acc += delta;
        if (this.acc < CONFIG.enemyAI.decideEvery) return;
        this.acc = 0;

        const def = catalogDef(plan[this.planIndex]);
        if (!def) { this.planIndex++; return; } // unknown key — skip it

        const free = this.buildings.freeSlots(FACTION.enemy);
        if (!free.length) { this.planIndex = plan.length; return; } // nowhere left to build

        // Save up for the next item; only build once affordable (don't skip ahead).
        if (this.store.spend(FACTION.enemy, def.cost)) {
            this.buildings.startConstruction(FACTION.enemy, free[0], def.key);
            this.planIndex++;
        }
    }
}
