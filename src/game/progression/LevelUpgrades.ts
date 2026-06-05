import { CONFIG } from '../config';

// The level-up perk system: on each level-up the player drafts 1 of 3 perks (see GameScene's
// level-up modal). Perks STACK — picking the same perk again raises its level, and every
// effect scales with that level × the per-level magnitude in CONFIG.levelUp. Player-only and
// per-match (GameScene calls resetPerks() at match start, like resetUpgrades()).
//
// This module owns: the catalog (PERKS), the chosen-level map, the random draft, and the
// effect getters that the combat / economy / ability / castle systems read. It is deliberately
// parallel to (and independent of) the building-purchased upgrades in ../upgrades.ts — a player
// can own both, and they stack.

export type PerkCategory = 'Units' | 'Economy' | 'Skills' | 'Castle';

export interface PerkDef {
    key: string;
    name: string;
    icon: string;            // emoji shown on the choice card
    category: PerkCategory;
    max: number;             // highest level this perk can reach
    // Human description of what the NEXT level grants (nextLevel = current + 1).
    desc: (nextLevel: number) => string;
}

const lu = () => CONFIG.levelUp;
const armourPct = (level: number) => Math.round((1 - Math.pow(lu().armourMult, level)) * 100);

// The catalog. Built from the units, buildings, skills and economy that exist in the game today.
export const PERKS: PerkDef[] = [
    // --- Units ---
    { key: 'meleeAtk', name: 'Sharpened Blades', icon: '⚔️', category: 'Units', max: 8,
      desc: (n) => `Melee units +${n * lu().meleeAtk} damage` },
    { key: 'rangedAtk', name: 'Master Fletching', icon: '🏹', category: 'Units', max: 8,
      desc: (n) => `Archers +${n * lu().rangedAtk} damage` },
    { key: 'warriorHp', name: 'Iron Warriors', icon: '🛡️', category: 'Units', max: 8,
      desc: (n) => `Warriors +${n * lu().warriorHp} max HP` },
    { key: 'archerRange', name: 'Eagle Eye', icon: '👁️', category: 'Units', max: 6,
      desc: (n) => `Archers +${n * lu().archerRange} range` },
    { key: 'lancerCrit', name: "Lancer's Fury", icon: '💥', category: 'Units', max: 7,
      desc: (n) => `Lancers ${Math.round(n * lu().lancerCrit * 100)}% critical-hit chance` },
    { key: 'monkHeal', name: 'Battlefield Medicine', icon: '✚', category: 'Units', max: 6,
      desc: (n) => (n === 1 ? `Monks heal an AREA, +${lu().monkHeal} healing` : `Monks +${n * lu().monkHeal} healing`) },
    { key: 'moveSpeed', name: 'Forced March', icon: '🥾', category: 'Units', max: 8,
      desc: (n) => `All units +${n * lu().moveSpeed} move speed` },
    { key: 'armour', name: 'Plate Armour', icon: '🦾', category: 'Units', max: 6,
      desc: (n) => `Your units take ${armourPct(n)}% less damage` },

    // --- Economy ---
    { key: 'peasantCarry', name: 'Strong Backs', icon: '🧺', category: 'Economy', max: 6,
      desc: (n) => `Peasants carry +${n * lu().peasantCarry} per trip` },
    { key: 'peasantSpeed', name: 'Fleet Workers', icon: '👟', category: 'Economy', max: 6,
      desc: (n) => `Peasants +${n * lu().peasantSpeed} move speed` },

    // --- Skills ---
    { key: 'volley', name: 'Arrow Storm', icon: '☔', category: 'Skills', max: 5,
      desc: (n) => `Arrow Volley +${n * lu().volleyArrows} arrows, −${(n * lu().volleyCdCut) / 1000}s cooldown` },
    { key: 'mercs', name: 'Hired Blades', icon: '🪙', category: 'Skills', max: 5,
      desc: (n) => `Mercenaries +${n * lu().mercCount} archer${n * lu().mercCount === 1 ? '' : 's'}, −${(n * lu().mercCdCut) / 1000}s cooldown` },

    // --- Castle ---
    { key: 'keepHp', name: 'Fortify', icon: '🏰', category: 'Castle', max: 6,
      desc: (n) => `Castle +${n * lu().keepHp} max HP (repairs now)` },
    { key: 'bulwark', name: 'Iron Gate', icon: '⛩️', category: 'Castle', max: 5,
      desc: (n) => `Breaching enemies deal −${n * lu().bulwark} Castle damage` },
];

const byKey: Record<string, PerkDef> = Object.fromEntries(PERKS.map((p) => [p.key, p]));

// Chosen level per perk key (0 = not taken). Player-only, per-match.
const levels: Record<string, number> = {};

export const perkLevel = (key: string) => levels[key] ?? 0;

// Raise a perk one level (clamped to its max). Returns the new level.
export function choosePerk(key: string): number {
    const def = byKey[key];
    if (!def) return 0;
    const next = Math.min(def.max, perkLevel(key) + 1);
    levels[key] = next;
    return next;
}

// Clear every chosen perk — called at match start (per-match, like resetUpgrades).
export const resetPerks = () => { for (const k of Object.keys(levels)) delete levels[k]; };

// The perks the player has taken, in catalog order, for the review panel.
export function chosenPerks(): { def: PerkDef; level: number }[] {
    return PERKS.filter((p) => perkLevel(p.key) > 0).map((p) => ({ def: p, level: perkLevel(p.key) }));
}

// Draft up to `n` distinct perks for a level-up choice — random among those not yet maxed.
// Internal helper for draftOptions (the public draft API).
function draftPerks(n = 3): PerkDef[] {
    const pool = PERKS.filter((p) => perkLevel(p.key) < p.max);
    // Fisher–Yates shuffle, then take the first n.
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

// One drafted choice: a perk, the player's current level in it, and the luck multiplier rolled
// for THIS card (how many levels picking it grants at once).
export interface DraftOption {
    def: PerkDef;
    level: number; // current chosen level (0 = new)
    mult: number;  // 1 (normal), 2, or 3 — already clamped so level+mult never exceeds max
}

// Roll a card's luck multiplier: x3 first, then x2, else x1 (probabilities from CONFIG).
function rollLuck(): number {
    const { x2Chance, x3Chance } = CONFIG.levelUp.luck;
    const r = Math.random();
    if (r < x3Chance) return 3;
    if (r < x3Chance + x2Chance) return 2;
    return 1;
}

// Draft `n` choices, each with its own rolled luck multiplier (clamped to the perk's headroom
// so a lucky card never overshoots the cap).
export function draftOptions(n = 3): DraftOption[] {
    return draftPerks(n).map((def) => {
        const level = perkLevel(def.key);
        const mult = Math.min(rollLuck(), def.max - level); // headroom ≥ 1 (pool excludes maxed)
        return { def, level, mult };
    });
}

// ---- Effect getters (player-only). Read by the combat / economy / ability / castle systems. ----

const roleOf = (unitKey: string) => CONFIG.unitTypes.find((u) => u.key === unitKey)?.role;

// Bonus flat damage for a unit, by role.
export function luUnitDamage(unitKey: string): number {
    const r = roleOf(unitKey);
    if (r === 'melee') return perkLevel('meleeAtk') * lu().meleeAtk;
    if (r === 'ranged') return perkLevel('rangedAtk') * lu().rangedAtk;
    return 0;
}

export const luUnitHp = (unitKey: string) =>
    unitKey === 'warrior' ? perkLevel('warriorHp') * lu().warriorHp : 0;

export const luUnitRange = (unitKey: string) =>
    unitKey === 'archer' ? perkLevel('archerRange') * lu().archerRange : 0;

export const luUnitCrit = (unitKey: string) =>
    unitKey === 'lancer' ? perkLevel('lancerCrit') * lu().lancerCrit : 0;

// Monk perk: any level makes the heal hit an area; the amount scales with the level.
export const luMonkAoe = () => perkLevel('monkHeal') > 0;
export const luMonkHeal = () => perkLevel('monkHeal') * lu().monkHeal;

// Multiplicative incoming-damage reduction for all your units (1 = none).
export const luArmourMult = () => Math.pow(lu().armourMult, perkLevel('armour'));

export const luUnitSpeed = () => perkLevel('moveSpeed') * lu().moveSpeed;

export const luPeasantCarry = () => perkLevel('peasantCarry') * lu().peasantCarry;
export const luPeasantSpeed = () => perkLevel('peasantSpeed') * lu().peasantSpeed;

export const luVolleyArrows = () => perkLevel('volley') * lu().volleyArrows;
export const luVolleyCdCut = () => perkLevel('volley') * lu().volleyCdCut;
export const luMercCount = () => perkLevel('mercs') * lu().mercCount;
export const luMercCdCut = () => perkLevel('mercs') * lu().mercCdCut;

export const luKeepHpBonus = () => perkLevel('keepHp') * lu().keepHp;
export const luBulwark = () => perkLevel('bulwark') * lu().bulwark;
