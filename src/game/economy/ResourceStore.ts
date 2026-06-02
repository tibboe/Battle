import { CONFIG, ResourceType } from '../config';
import { Faction } from '../units/UnitManager';

// Per-side resource stockpiles (gold / stone / wood) for Milestone 4. Peasants bank into it
// here; later phases (build & upgrade costs) spend from it. Stockpiles are per-match — they
// start from CONFIG.resources.start and are NOT persisted (settings.ts stays tuning-only).
//
// Deliberately tiny and dumb: it holds numbers and exposes add / canAfford / spend. The
// `dirty` flag lets the HUD redraw only when something actually changed.

export type ResourceBag = Record<ResourceType, number>;

const TYPES: ResourceType[] = ['gold', 'stone', 'wood'];

export class ResourceStore {
    // Indexed by faction (player = 0, enemy = 1).
    private readonly bags: ResourceBag[];
    private dirty = true;

    constructor() {
        const start = CONFIG.resources.start;
        this.bags = [
            { gold: start.gold, stone: start.stone, wood: start.wood },
            { gold: start.gold, stone: start.stone, wood: start.wood },
        ];
    }

    get(faction: Faction, type: ResourceType): number {
        return this.bags[faction][type];
    }

    bag(faction: Faction): Readonly<ResourceBag> {
        return this.bags[faction];
    }

    // Bank a gathered load. Used by peasants on each completed trip.
    add(faction: Faction, type: ResourceType, amount: number) {
        if (amount <= 0) return;
        this.bags[faction][type] += amount;
        this.dirty = true;
    }

    // Phase 2+ will spend on buildings/upgrades; the primitives are ready now.
    canAfford(faction: Faction, cost: Partial<ResourceBag>): boolean {
        const b = this.bags[faction];
        return TYPES.every((t) => (cost[t] ?? 0) <= b[t]);
    }

    spend(faction: Faction, cost: Partial<ResourceBag>): boolean {
        if (!this.canAfford(faction, cost)) return false;
        const b = this.bags[faction];
        for (const t of TYPES) b[t] -= cost[t] ?? 0;
        this.dirty = true;
        return true;
    }

    // True once since the last check, whenever a stockpile changed — lets the HUD skip
    // rebuilding its text every frame.
    consumeDirty(): boolean {
        if (!this.dirty) return false;
        this.dirty = false;
        return true;
    }
}
