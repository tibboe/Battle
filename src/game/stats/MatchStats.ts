import { CONFIG, ResourceType } from '../config';
import { serializeSettings } from '../settings';

// Per-match stats recorder. A single module-level instance accumulates counters during a match
// (units produced/killed, damage dealt & taken per unit type, resources gathered & spent, skill
// use, keep damage, peak army sizes). GameScene resets it at the start of a match and calls
// finish() at the end to build a MatchSummary, which is POSTed to the stats API (see submit()).
//
// Faction index: 0 = player, 1 = enemy (matches FACTION in UnitManager). Recording is a no-op
// unless a match is active, so stray calls between matches are ignored.

const SCHEMA = 1;

export interface UnitStat {
    produced: number;
    deaths: number;        // died in combat
    reachedKeep: number;   // marched into the opposing keep (a loss that dealt keep damage)
    damageDealt: number;
    damageTaken: number;
}

export interface FactionStat {
    unitsProduced: number;
    unitsLost: number;     // deaths + reachedKeep
    kills: number;         // opposing units this side killed
    skillCasts: number;
    skillDamage: number;
    keepDamageDealt: number;
    peakArmy: number;
    gathered: Record<ResourceType, number>;
    spent: Record<ResourceType, number>;
}

export interface MatchSummary {
    schema: number;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    winner: 'player' | 'enemy' | 'none';
    playerKeepHp: number;
    enemyKeepHp: number;
    maxKeepHp: number;
    units: { player: Record<string, UnitStat>; enemy: Record<string, UnitStat> };
    factions: { player: FactionStat; enemy: FactionStat };
    settings: ReturnType<typeof serializeSettings>;
}

const zeroRes = (): Record<ResourceType, number> => ({ gold: 0, stone: 0, wood: 0, food: 0 });

class MatchStats {
    private active = false;
    private startMs = 0;
    private startedAt = '';
    private nTypes = 0;

    // [faction * nTypes + type]
    private produced = new Int32Array(0);
    private deaths = new Int32Array(0);
    private reached = new Int32Array(0);
    private dealt = new Float64Array(0);
    private taken = new Float64Array(0);

    private skillCasts: [number, number] = [0, 0];
    private skillDamage: [number, number] = [0, 0];
    private keepDamage: [number, number] = [0, 0];
    private peakArmy: [number, number] = [0, 0];
    private gathered: [Record<ResourceType, number>, Record<ResourceType, number>] = [zeroRes(), zeroRes()];
    private spent: [Record<ResourceType, number>, Record<ResourceType, number>] = [zeroRes(), zeroRes()];

    reset() {
        this.nTypes = CONFIG.unitTypes.length;
        const n = this.nTypes * 2;
        this.produced = new Int32Array(n);
        this.deaths = new Int32Array(n);
        this.reached = new Int32Array(n);
        this.dealt = new Float64Array(n);
        this.taken = new Float64Array(n);
        this.skillCasts = [0, 0];
        this.skillDamage = [0, 0];
        this.keepDamage = [0, 0];
        this.peakArmy = [0, 0];
        this.gathered = [zeroRes(), zeroRes()];
        this.spent = [zeroRes(), zeroRes()];
        this.startMs = performance.now();
        this.startedAt = new Date().toISOString();
        this.active = true;
    }

    private idx(faction: number, type: number) { return faction * this.nTypes + type; }

    produce(faction: number, type: number) { if (this.active) this.produced[this.idx(faction, type)]++; }
    death(faction: number, type: number) { if (this.active) this.deaths[this.idx(faction, type)]++; }
    reachedKeep(faction: number, type: number, keepDamage: number) {
        if (!this.active) return;
        this.reached[this.idx(faction, type)]++;
        this.keepDamage[faction] += keepDamage;
    }

    // A unit strike: attacker (aFaction/aType) hit victim (vFaction/vType) for `amt`.
    unitDamage(aFaction: number, aType: number, vFaction: number, vType: number, amt: number) {
        if (!this.active) return;
        this.dealt[this.idx(aFaction, aType)] += amt;
        this.taken[this.idx(vFaction, vType)] += amt;
    }

    // A skill (e.g. arrow volley / long shot from no attributable unit) hit a victim.
    skillDamageDealt(aFaction: number, vFaction: number, vType: number, amt: number) {
        if (!this.active) return;
        this.skillDamage[aFaction] += amt;
        this.taken[this.idx(vFaction, vType)] += amt;
    }

    skillCast(faction: number) { if (this.active) this.skillCasts[faction]++; }
    gather(faction: number, res: ResourceType, amt: number) { if (this.active) this.gathered[faction][res] += amt; }
    spend(faction: number, res: ResourceType, amt: number) { if (this.active) this.spent[faction][res] += amt; }
    tickPeak(playerLiving: number, enemyLiving: number) {
        if (!this.active) return;
        if (playerLiving > this.peakArmy[0]) this.peakArmy[0] = playerLiving;
        if (enemyLiving > this.peakArmy[1]) this.peakArmy[1] = enemyLiving;
    }

    isActive() { return this.active; }

    // Build the summary and stop recording. `winner` 0/1 = faction, -1 = none/draw.
    finish(winner: number, playerKeepHp: number, enemyKeepHp: number): MatchSummary {
        this.active = false;
        const types = CONFIG.unitTypes;
        const unitsFor = (f: number): Record<string, UnitStat> => {
            const out: Record<string, UnitStat> = {};
            for (let t = 0; t < this.nTypes; t++) {
                const i = this.idx(f, t);
                out[types[t].key] = {
                    produced: this.produced[i],
                    deaths: this.deaths[i],
                    reachedKeep: this.reached[i],
                    damageDealt: Math.round(this.dealt[i]),
                    damageTaken: Math.round(this.taken[i]),
                };
            }
            return out;
        };
        const factionFor = (f: number): FactionStat => {
            const foe = f === 0 ? 1 : 0;
            let produced = 0, lost = 0;
            for (let t = 0; t < this.nTypes; t++) {
                const i = this.idx(f, t);
                produced += this.produced[i];
                lost += this.deaths[i] + this.reached[i];
            }
            // kills this side made = opponents that died (their deaths counter)
            let kills = 0;
            for (let t = 0; t < this.nTypes; t++) kills += this.deaths[this.idx(foe, t)];
            return {
                unitsProduced: produced,
                unitsLost: lost,
                kills,
                skillCasts: this.skillCasts[f],
                skillDamage: Math.round(this.skillDamage[f]),
                keepDamageDealt: Math.round(this.keepDamage[f]),
                peakArmy: this.peakArmy[f],
                gathered: { ...this.gathered[f] },
                spent: { ...this.spent[f] },
            };
        };
        return {
            schema: SCHEMA,
            startedAt: this.startedAt,
            endedAt: new Date().toISOString(),
            durationMs: Math.round(performance.now() - this.startMs),
            winner: winner === 0 ? 'player' : winner === 1 ? 'enemy' : 'none',
            playerKeepHp,
            enemyKeepHp,
            maxKeepHp: CONFIG.keep.hp,
            units: { player: unitsFor(0), enemy: unitsFor(1) },
            factions: { player: factionFor(0), enemy: factionFor(1) },
            settings: serializeSettings(),
        };
    }
}

export const matchStats = new MatchStats();

// POST a finished match to the stats API. Best-effort: failures (e.g. running the Vite dev
// server with no backend) are swallowed; the summary is always mirrored to localStorage and the
// console so it's never lost.
export async function submitMatch(summary: MatchSummary): Promise<void> {
    try { localStorage.setItem('lanebreaker.lastMatch', JSON.stringify(summary)); } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.log('[match]', summary);
    try {
        await fetch('/api/matches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(summary),
        });
    } catch { /* no backend (dev) or offline — already saved locally */ }
}
