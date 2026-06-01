import { CONFIG } from './config';

// Tiny persistence layer: snapshot the tunables the Dev/Unit panels edit into localStorage
// and re-apply them on boot, so the director's tweaks survive a refresh. Only a curated set
// of editable values is stored (keyed by unit/building name, so reordering config is safe);
// everything else always comes from config.ts. `resetSettings()` clears the snapshot.

const KEY = 'lanebreaker.settings.v1';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function serializeSettings() {
    const lane = CONFIG.lanes[0];
    const every: Record<string, number> = {};
    for (const b of CONFIG.production.buildings) every[b.produces] = b.every;
    const units: Record<string, Record<string, number>> = {};
    for (const u of CONFIG.unitTypes) {
        const o: Record<string, number> = {
            hp: u.hp, damage: u.damage, range: u.range, attackInterval: u.attackInterval,
            moveSpeed: u.moveSpeed, scale: u.scale, footAnchor: u.footAnchor,
        };
        if (u.heal) { o.healAmount = u.heal.amount; o.healInterval = u.heal.interval; }
        units[u.key] = o;
    }
    return {
        lane: { thickness: lane.thickness, pathWidth: lane.pathWidth, funnelSpeed: lane.funnelSpeed },
        spawn: { player: CONFIG.spawn.unitsTarget.player, enemy: CONFIG.spawn.unitsTarget.enemy },
        world: { width: CONFIG.world.width },
        island: { margin: CONFIG.island.margin },
        decorations: { forest: CONFIG.decorations.forest },
        clouds: { count: CONFIG.clouds.count },
        debug: { damageNumbers: CONFIG.debug.damageNumbers },
        production: { rateScale: CONFIG.production.rateScale, every },
        units,
    };
}

export function saveSettings() {
    try {
        localStorage.setItem(KEY, JSON.stringify(serializeSettings()));
    } catch {
        /* storage unavailable (private mode, quota) — tuning just won't persist */
    }
}

export function resetSettings() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        /* ignore */
    }
}

// Apply a saved snapshot over CONFIG. Call once, before the scene reads config (see
// game/main.ts). Every field is guarded, so a partial or stale snapshot can't break boot.
export function applySavedSettings() {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(KEY);
    } catch {
        return;
    }
    if (!raw) return;
    let s: any;
    try {
        s = JSON.parse(raw);
    } catch {
        return;
    }
    if (!s || typeof s !== 'object') return;

    const lane = CONFIG.lanes[0];
    if (s.lane) {
        if (isNum(s.lane.thickness)) lane.thickness = s.lane.thickness;
        if (isNum(s.lane.pathWidth)) lane.pathWidth = s.lane.pathWidth;
        if (isNum(s.lane.funnelSpeed)) lane.funnelSpeed = s.lane.funnelSpeed;
    }
    if (s.spawn) {
        if (isNum(s.spawn.player)) CONFIG.spawn.unitsTarget.player = s.spawn.player;
        if (isNum(s.spawn.enemy)) CONFIG.spawn.unitsTarget.enemy = s.spawn.enemy;
    }
    if (s.world && isNum(s.world.width)) CONFIG.world.width = s.world.width;
    if (s.island && isNum(s.island.margin)) CONFIG.island.margin = s.island.margin;
    if (s.decorations && isNum(s.decorations.forest)) CONFIG.decorations.forest = s.decorations.forest;
    if (s.clouds && isNum(s.clouds.count)) CONFIG.clouds.count = s.clouds.count;
    if (s.debug && typeof s.debug.damageNumbers === 'boolean') CONFIG.debug.damageNumbers = s.debug.damageNumbers;
    if (s.production) {
        if (isNum(s.production.rateScale)) CONFIG.production.rateScale = s.production.rateScale;
        if (s.production.every) {
            for (const b of CONFIG.production.buildings) {
                const e = s.production.every[b.produces];
                if (isNum(e)) b.every = e;
            }
        }
    }
    if (s.units) {
        for (const u of CONFIG.unitTypes) {
            const o = s.units[u.key];
            if (!o) continue;
            if (isNum(o.hp)) u.hp = o.hp;
            if (isNum(o.damage)) u.damage = o.damage;
            if (isNum(o.range)) u.range = o.range;
            if (isNum(o.attackInterval)) u.attackInterval = o.attackInterval;
            if (isNum(o.moveSpeed)) u.moveSpeed = o.moveSpeed;
            if (isNum(o.scale)) u.scale = o.scale;
            if (isNum(o.footAnchor)) u.footAnchor = o.footAnchor;
            if (u.heal) {
                if (isNum(o.healAmount)) u.heal.amount = o.healAmount;
                if (isNum(o.healInterval)) u.heal.interval = o.healInterval;
            }
        }
    }
}
