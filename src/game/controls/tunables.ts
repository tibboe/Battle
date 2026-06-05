import * as Phaser from 'phaser';
import { CONFIG } from '../config';

// The set of game tunables surfaced in BOTH the in-game Dev panel and the pre-game Setup
// screen. Each Setting reads/writes CONFIG live via closures and carries display metadata.
// Defined once here so the two UIs never drift apart. Persistence of these values lives in
// settings.ts (saved to localStorage, re-applied on boot).

export interface Setting {
    section: string;
    label: string;
    get: () => number;
    set: (v: number) => void;
    step: number;
    min: number;
    max: number;
    live: boolean; // true = applies instantly in-game; false = needs a battle restart
    bool?: boolean; // render as an ON/OFF toggle (either −/+ flips it)
    fmt?: (v: number) => string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Build the tunables list against the current CONFIG. Sections appear in first-mention order.
export function buildTunables(): Setting[] {
    const av = CONFIG.abilities.arrowVolley;
    const merc = CONFIG.abilities.mercenaries;
    const settings: Setting[] = [
        { section: 'Production', label: 'Spawn secs', get: () => CONFIG.production.spawnSeconds, set: (v) => (CONFIG.production.spawnSeconds = v), step: 1, min: 1, max: 30, live: true, fmt: (v) => `${v}s` },

        { section: 'Combat', label: 'Atk interval', get: () => CONFIG.combat.attackIntervalScale, set: (v) => (CONFIG.combat.attackIntervalScale = v), step: 0.25, min: 0.5, max: 4, live: true, fmt: (v) => `${v}×` },
        { section: 'Combat', label: 'Unit HP', get: () => CONFIG.combat.hpScale, set: (v) => (CONFIG.combat.hpScale = v), step: 0.5, min: 0.5, max: 5, live: true, fmt: (v) => `${v}×` },

        { section: 'Armies', label: 'Your army', get: () => CONFIG.spawn.unitsTarget.player, set: (v) => (CONFIG.spawn.unitsTarget.player = v), step: 5, min: 5, max: 300, live: false },
        { section: 'Armies', label: 'Enemy army', get: () => CONFIG.spawn.unitsTarget.enemy, set: (v) => (CONFIG.spawn.unitsTarget.enemy = v), step: 5, min: 5, max: 300, live: false },

        // Enemy muster: gather a force at the rally then charge once its points cross the bar.
        { section: 'Enemy', label: 'Muster', get: () => (CONFIG.enemyAI.muster.enabled ? 1 : 0), set: (v) => (CONFIG.enemyAI.muster.enabled = v > 0), step: 1, min: 0, max: 1, live: true, bool: true, fmt: (v) => (v ? 'ON' : 'OFF') },
        { section: 'Enemy', label: 'Attack pts', get: () => CONFIG.enemyAI.muster.startThreshold, set: (v) => (CONFIG.enemyAI.muster.startThreshold = v), step: 2, min: 0, max: 200, live: true },
        { section: 'Enemy', label: 'Pts/wave', get: () => CONFIG.enemyAI.muster.growth, set: (v) => (CONFIG.enemyAI.muster.growth = v), step: 2, min: 0, max: 100, live: true },

        { section: 'Economy', label: 'Start food', get: () => CONFIG.resources.start.food, set: (v) => (CONFIG.resources.start.food = v), step: 10, min: 0, max: 400, live: false },
    ];

    // Per-unit food-to-train (closes over the unit object, so config order is irrelevant).
    for (const u of CONFIG.unitTypes) {
        settings.push({ section: 'Economy', label: `${cap(u.key)} food`, get: () => u.foodCost ?? 0, set: (v) => (u.foodCost = v), step: 1, min: 0, max: 50, live: true });
    }

    settings.push(
        { section: 'Skills', label: 'Volley arrows', get: () => av.arrows, set: (v) => (av.arrows = v), step: 5, min: 5, max: 200, live: true },
        { section: 'Skills', label: 'Volley dmg', get: () => av.damage, set: (v) => (av.damage = v), step: 1, min: 1, max: 100, live: true },
        { section: 'Skills', label: 'Volley radius', get: () => av.radius, set: (v) => (av.radius = v), step: 20, min: 40, max: 600, live: true, fmt: (v) => `${v}px` },
        { section: 'Skills', label: 'Volley hit r', get: () => av.hitRadius, set: (v) => (av.hitRadius = v), step: 5, min: 5, max: 120, live: true, fmt: (v) => `${v}px` },
        { section: 'Skills', label: 'Volley rain', get: () => av.duration, set: (v) => (av.duration = v), step: 200, min: 0, max: 5000, live: true, fmt: (v) => `${v}ms` },
        { section: 'Skills', label: 'Volley cd', get: () => av.cooldown, set: (v) => (av.cooldown = v), step: 1000, min: 0, max: 30000, live: true, fmt: (v) => `${v / 1000}s` },

        { section: 'Skills', label: 'Mercs count', get: () => merc.count, set: (v) => (merc.count = v), step: 1, min: 1, max: 20, live: true },
        { section: 'Skills', label: 'Mercs spread', get: () => merc.spread, set: (v) => (merc.spread = v), step: 10, min: 20, max: 400, live: true, fmt: (v) => `${v}px` },
        { section: 'Skills', label: 'Mercs gold', get: () => merc.cost, set: (v) => (merc.cost = v), step: 10, min: 0, max: 500, live: true },
        { section: 'Skills', label: 'Mercs cd', get: () => merc.cooldown, set: (v) => (merc.cooldown = v), step: 1000, min: 0, max: 60000, live: true, fmt: (v) => `${v / 1000}s` },

        { section: 'Battlefield', label: 'Lane width', get: () => CONFIG.lanes[0].pathWidth, set: (v) => (CONFIG.lanes[0].pathWidth = v), step: 20, min: 40, max: 600, live: true },
        { section: 'Battlefield', label: 'Map width', get: () => CONFIG.world.width, set: (v) => (CONFIG.world.width = v), step: 500, min: 2000, max: 8000, live: false },
        { section: 'Battlefield', label: 'Water edge', get: () => CONFIG.island.margin, set: (v) => (CONFIG.island.margin = v), step: 32, min: 64, max: 640, live: false },

        { section: 'Environment', label: 'Forest', get: () => CONFIG.decorations.forest, set: (v) => (CONFIG.decorations.forest = v), step: 4, min: 0, max: 120, live: false },
        { section: 'Environment', label: 'Clouds', get: () => CONFIG.clouds.count, set: (v) => (CONFIG.clouds.count = v), step: 2, min: 0, max: 30, live: false },

        { section: 'Debug', label: 'Dmg numbers', get: () => (CONFIG.debug.damageNumbers ? 1 : 0), set: (v) => (CONFIG.debug.damageNumbers = v > 0), step: 1, min: 0, max: 1, live: true, bool: true, fmt: (v) => (v ? 'ON' : 'OFF') },
    );

    return settings;
}

// Apply a +/- step to a setting (shared bump logic). Returns true if the value changed.
export function bumpSetting(s: Setting, dir: number): boolean {
    if (s.bool) { s.set(s.get() > 0 ? 0 : 1); return true; }
    const next = Phaser.Math.Clamp(Math.round((s.get() + dir * s.step) * 100) / 100, s.min, s.max);
    if (next === s.get()) return false;
    s.set(next);
    return true;
}
