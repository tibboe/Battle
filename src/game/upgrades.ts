import { CONFIG } from './config';

// Phase-4 upgrades — player-only, free to toggle from a building, one level each for now.
// This module owns which upgrades are ON (the effect magnitudes live in CONFIG.upgrades).
// UnitManager reads the effect getters into its per-faction stat bonuses; the building
// upgrade popup toggles levels; settings.ts persists them. Enemy units always use base
// stats — upgrades are the player's decision hook.

export interface UpgradeDef {
    key: string;   // matches CONFIG.upgrades + the level map
    kind: string;  // which building hosts it: a unit key, or 'general'
    label: string;
    desc: string;
}

// Only the upgrades wired up so far appear here; abilities add their rows as they land.
export const UPGRADES: UpgradeDef[] = [
    { key: 'warriorHp', kind: 'warrior', label: '+Health', desc: 'Warriors spawn with more HP' },
    { key: 'archerRange', kind: 'archer', label: '+Range', desc: 'Archers engage from farther' },
    { key: 'lancerCrit', kind: 'lancer', label: 'Crit chance', desc: 'Lancers can land critical hits' },
    { key: 'armour', kind: 'general', label: 'Armour', desc: 'Your units take less damage' },
    { key: 'melee', kind: 'general', label: 'Melee atk', desc: '+damage, your melee units' },
    { key: 'ranged', kind: 'general', label: 'Ranged atk', desc: '+damage, your ranged units' },
];

// Active level per upgrade key (0 or 1 for now). Player side only.
const levels: Record<string, number> = {};

export const upgradesForKind = (kind: string) => UPGRADES.filter((u) => u.kind === kind);
export const upgradeLevel = (key: string) => levels[key] ?? 0;
export const upgradeActive = (key: string) => upgradeLevel(key) > 0;
export const toggleUpgrade = (key: string) => {
    levels[key] = upgradeActive(key) ? 0 : 1;
};

// Persistence hooks (used by settings.ts).
export const getUpgradeLevels = (): Record<string, number> => ({ ...levels });
export function setUpgradeLevels(saved: Record<string, unknown> | undefined) {
    if (!saved) return;
    for (const u of UPGRADES) {
        const v = saved[u.key];
        if (typeof v === 'number' && Number.isFinite(v)) levels[u.key] = v;
    }
}

// ---- Effect getters (read by UnitManager.recomputeUpgrades) — player units only ----

const roleOf = (unitKey: string) => CONFIG.unitTypes.find((u) => u.key === unitKey)?.role;

export const hpBonusFor = (unitKey: string) =>
    unitKey === 'warrior' && upgradeActive('warriorHp') ? CONFIG.upgrades.warriorHp : 0;

export const rangeBonusFor = (unitKey: string) =>
    unitKey === 'archer' && upgradeActive('archerRange') ? CONFIG.upgrades.archerRange : 0;

export function damageBonusFor(unitKey: string): number {
    const r = roleOf(unitKey);
    if (r === 'melee' && upgradeActive('melee')) return CONFIG.upgrades.melee;
    if (r === 'ranged' && upgradeActive('ranged')) return CONFIG.upgrades.ranged;
    return 0;
}

export const armourMult = () => (upgradeActive('armour') ? CONFIG.upgrades.armour : 1);

// Player-only crit chance for a unit (0 if it can't crit or the upgrade is off).
export const critChanceFor = (unitKey: string) =>
    unitKey === 'lancer' && upgradeActive('lancerCrit') ? CONFIG.abilities.crit.chance : 0;
