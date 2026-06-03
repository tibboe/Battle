import * as Phaser from 'phaser';
import { BuildingDef, CONFIG, laneBottom, laneTop } from '../config';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';

// The per-side 3×3 build grid (spots 1-9, left→right, top→bottom). The Castle keep sits on
// CONFIG.grid.keepSpot and the shared-upgrades building on its spot; everything else is
// data-driven from CONFIG.production:
//   • `start` lists the buildings each side begins with (free, instant). The player gets just
//     a House; the enemy gets a full base.
//   • `catalog` is what a peasant can BUILD on an empty slot (Milestone 4 Phase 2). The player
//     taps an empty slot → picks from the catalog → pays → a peasant hammers it up over its
//     buildTime, then it activates (a producer starts emitting; a House starts making peasants).
// Producers emit their unit on a timer; the Castle is just art (its HP lives in the scene).
// Sprites sort with the units by base-y depth.

const BASE = 'assets/environment/tiny-swords/buildings';
const DIR = ['Blue Buildings', 'Red Buildings']; // indexed by faction

function buildingKey(faction: Faction, name: string) {
    return `bld-${faction}-${name}`;
}

// Every distinct building art referenced by config (the Castle keep + the whole catalog).
function buildingNames(): string[] {
    const set = new Set<string>([CONFIG.keep.art]);
    for (const b of CONFIG.production.catalog) set.add(b.art);
    return [...set];
}

export function loadBuildings(scene: Phaser.Scene) {
    for (const f of [FACTION.player, FACTION.enemy] as const) {
        for (const name of buildingNames()) {
            scene.load.image(buildingKey(f, name), encodeURI(`${BASE}/${DIR[f]}/${name}.png`));
        }
    }
}

interface Producer {
    faction: Faction;
    typeIndex: number;
    x: number;            // spawn x (the building's spot)
    y: number;            // band-clamped spawn y
    acc: number;          // accumulator (ms toward the next spawn)
    id: number;           // unique id, used to attribute its units for the live-count cap
    cap: number;          // max units it may keep alive at once (0 = uncapped)
}

// A building being hammered up on a slot. Progress only advances while a builder peasant is
// present (PeasantManager.hammerSite), so construction genuinely costs a worker's time.
export interface ConstructionSite {
    faction: Faction;
    spot: number;
    x: number;            // slot centre (where the builder stands / the building lands)
    y: number;
    def: BuildingDef;
    progress: number;     // ms hammered so far
    done: boolean;        // set when finished (lets the builder peasant release)
    claimed: boolean;     // a peasant has been dispatched to build it
    scaffold: Phaser.GameObjects.Image;
    barBg: Phaser.GameObjects.Rectangle;
    barFill: Phaser.GameObjects.Rectangle;
    barWidth: number;
}

export class Buildings {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;
    // Selection callbacks (the SelectionHud): a building/Castle/House was tapped (tag = unit key
    // | 'general' | 'house', plus its world position for the highlight), or an empty slot was.
    private readonly onSelect?: (tag: string, x: number, y: number) => void;
    private readonly onSelectSlot?: (faction: Faction, spot: number, x: number, y: number) => void;

    private readonly producers: Producer[] = [];
    private nextProducerId = 0; // hands out a stable id per producer for its live-count cap
    private readonly sites: ConstructionSite[] = [];

    // Soft collision footprints for the unit system (production buildings + Houses, NOT keeps —
    // units must be able to reach a keep to sack it). Grows as buildings are constructed.
    private readonly obstacleList: { x: number; y: number; r: number }[] = [];

    // Per-faction base geometry the peasant system needs: the Castle (bank) and the live list
    // of Houses (grows as the player builds more).
    private readonly keepPos: { x: number; y: number }[] = [];
    private readonly housePos: { x: number; y: number }[][] = [[], []];

    // Build-slot plinths (+ the player's "＋" hint), keyed `${faction}:${spot}`, so we can
    // remove them when the slot is built on.
    private readonly plinths = new Map<string, Phaser.GameObjects.Rectangle>();
    private readonly slotHints = new Map<string, Phaser.GameObjects.Text>();
    // Which spots are taken (keep / general / built / under construction), per faction.
    private readonly occupied: [Set<number>, Set<number>] = [new Set(), new Set()];

    // Cached grid geometry (computed once; the grid never moves mid-match).
    private readonly pitchX: number;
    private readonly pitchY: number;
    private readonly keepCol: number;
    private readonly keepRow: number;
    private readonly laneY: number;
    private readonly bandTop: number;
    private readonly bandBottom: number;

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        units: UnitManager,
        onSelect?: (tag: string, x: number, y: number) => void,                  // tap building/Castle/House
        onSelectSlot?: (faction: Faction, spot: number, x: number, y: number) => void, // tap empty slot
    ) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;
        this.onSelect = onSelect;
        this.onSelectSlot = onSelectSlot;

        const g = CONFIG.grid;
        this.pitchX = g.cellW + g.gap;
        this.pitchY = g.cellH + g.gap;
        this.keepCol = (g.keepSpot - 1) % g.cols;
        this.keepRow = Math.floor((g.keepSpot - 1) / g.cols);
        this.laneY = CONFIG.lanes[0].y;
        this.bandTop = laneTop() + 24;
        this.bandBottom = laneBottom() - 24;

        const spotCount = g.cols * g.rows;

        for (const f of [FACTION.player, FACTION.enemy] as const) {
            const flip = f === FACTION.enemy;
            const occ = this.occupied[f];

            // Castle keep (bank / drop-off; HP tracked by the scene). Tapping YOUR Castle opens
            // the shared Armour/Melee/Ranged ('general') upgrades — there is no separate
            // upgrades building.
            const kp = this.slotPos(f, g.keepSpot);
            const kimg = this.place(buildingKey(f, CONFIG.keep.art), kp.x, kp.y, CONFIG.keep.scale, flip);
            if (f === FACTION.player) this.makeTappable(kimg, () => this.onSelect?.('general', kp.x, kp.y));
            this.keepPos[f] = { x: kp.x, y: kp.y };
            occ.add(g.keepSpot);

            // Pre-built starting buildings (free, instant).
            for (const s of CONFIG.production.start[f === FACTION.player ? 'player' : 'enemy']) {
                const def = catalogDef(s.key);
                if (def) this.placeBuilding(f, def, s.spot);
            }

            // Remaining empty spots become build plinths (the player's are tappable build slots).
            for (let spot = 1; spot <= spotCount; spot++) {
                if (occ.has(spot)) continue;
                this.addPlinth(f, spot);
            }
        }
    }

    // World centre of a spot (1-based) for a faction; the grid fans toward the lane.
    private slotPos(faction: Faction, spot: number) {
        const g = CONFIG.grid;
        const keepX = faction === FACTION.player ? CONFIG.keep.margin : CONFIG.world.width - CONFIG.keep.margin;
        const dir = faction === FACTION.player ? 1 : -1;
        const col = (spot - 1) % g.cols;
        const row = Math.floor((spot - 1) / g.cols);
        return {
            x: keepX + dir * (col - this.keepCol) * this.pitchX,
            y: this.laneY + (row - this.keepRow) * this.pitchY,
        };
    }

    private addPlinth(faction: Faction, spot: number) {
        const g = CONFIG.grid;
        const p = this.slotPos(faction, spot);
        const plinth = this.scene.add.rectangle(p.x, p.y, g.cellW, g.cellH, 0xffffff, 0.05)
            .setOrigin(0.5, 0.5)
            .setStrokeStyle(2, 0xffffff, 0.16)
            .setDepth(3);
        this.layer.add(plinth);
        this.plinths.set(`${faction}:${spot}`, plinth);
        // Only the player can build; make their empty slots tappable, with a faint "＋" hint.
        if (faction === FACTION.player && this.onSelectSlot) {
            plinth.setInteractive({ useHandCursor: true });
            plinth.on('pointerup', (pointer: Phaser.Input.Pointer) => {
                if (pointer.getDistance() < 14) this.onSelectSlot!(faction, spot, p.x, p.y);
            });
            const hint = this.scene.add.text(p.x, p.y, '＋', {
                fontFamily: 'monospace', fontSize: '40px', color: '#ffffff',
            }).setOrigin(0.5).setAlpha(0.28).setDepth(4);
            this.layer.add(hint);
            this.slotHints.set(`${faction}:${spot}`, hint);
        }
    }

    // Place a finished building on a slot: art + (producer timer | House registration).
    private placeBuilding(faction: Faction, def: BuildingDef, spot: number) {
        const flip = faction === FACTION.enemy;
        const p = this.slotPos(faction, spot);
        const img = this.place(buildingKey(faction, def.art), p.x, p.y, def.scale, flip);
        this.occupied[faction].add(spot);
        // A base-footprint circle so units flow around the building rather than through it.
        this.obstacleList.push({ x: p.x, y: p.y, r: img.displayWidth * 0.32 });

        if (def.produces) {
            // Combat producer: tappable for upgrades (player), and emits on a timer.
            if (faction === FACTION.player) this.makeTappable(img, () => this.onSelect?.(def.produces!, p.x, p.y));
            const typeIndex = CONFIG.unitTypes.findIndex((u) => u.key === def.produces);
            if (typeIndex >= 0) {
                this.producers.push({
                    faction,
                    typeIndex,
                    x: p.x,
                    y: Phaser.Math.Clamp(p.y, this.bandTop, this.bandBottom),
                    // Random initial offset so producers don't all fire on the same beat.
                    acc: Phaser.Math.FloatBetween(0, CONFIG.production.spawnSeconds * 1000),
                    id: this.nextProducerId++,
                    cap: def.maxUnits ?? 0,
                });
            }
        } else {
            // House: a peasant source — register it for the PeasantManager to staff, and make
            // the player's tappable for peasant upgrades.
            this.housePos[faction].push({ x: p.x, y: p.y });
            if (faction === FACTION.player) this.makeTappable(img, () => this.onSelect?.('house', p.x, p.y));
        }
    }

    // ---- Construction (Phase 2) ----

    // Begin building `defKey` on a player/enemy slot. The caller has already paid. Draws a
    // dim scaffold + a progress bar; a peasant advances it via hammerSite().
    startConstruction(faction: Faction, spot: number, defKey: string): ConstructionSite | undefined {
        const def = catalogDef(defKey);
        if (!def || this.occupied[faction].has(spot)) return undefined;

        // Remove the plinth (+ its hint) and reserve the spot.
        const key = `${faction}:${spot}`;
        this.plinths.get(key)?.destroy();
        this.plinths.delete(key);
        this.slotHints.get(key)?.destroy();
        this.slotHints.delete(key);
        this.occupied[faction].add(spot);

        const flip = faction === FACTION.enemy;
        const p = this.slotPos(faction, spot);
        const scaffold = this.place(buildingKey(faction, def.art), p.x, p.y, def.scale, flip);
        scaffold.setTint(0x5a6472).setAlpha(0.55); // "under construction" look

        const barWidth = 64;
        const barY = p.y - 70;
        const barBg = this.scene.add.rectangle(p.x, barY, barWidth, 8, 0x000000, 0.6)
            .setOrigin(0.5, 0.5).setDepth(10_000);
        // Full-width fill, scaled on the X axis as progress climbs (reliable on Shapes).
        const barFill = this.scene.add.rectangle(p.x - barWidth / 2, barY, barWidth, 6, 0x7be08a, 1)
            .setOrigin(0, 0.5).setDepth(10_001);
        barFill.scaleX = 0;
        this.layer.add([barBg, barFill]);

        const site: ConstructionSite = {
            faction, spot, x: p.x, y: p.y, def,
            progress: 0, done: false, claimed: false,
            scaffold, barBg, barFill, barWidth,
        };
        this.sites.push(site);
        return site;
    }

    // Advance a site while a builder hammers it (called by PeasantManager). Updates the bar.
    hammerSite(site: ConstructionSite, delta: number) {
        if (site.done) return;
        site.progress = Math.min(site.def.buildTime, site.progress + delta);
        site.barFill.scaleX = site.progress / site.def.buildTime;
    }

    // Active construction sites for a faction (for the peasant dispatcher).
    sitesFor(faction: Faction): ConstructionSite[] {
        return this.sites.filter((s) => s.faction === faction && !s.done);
    }

    private finishSite(site: ConstructionSite) {
        site.done = true;
        site.scaffold.destroy();
        site.barBg.destroy();
        site.barFill.destroy();
        // The spot was reserved during construction; clear it so placeBuilding re-adds it.
        this.occupied[site.faction].delete(site.spot);
        this.placeBuilding(site.faction, site.def, site.spot);
        const i = this.sites.indexOf(site);
        if (i >= 0) this.sites.splice(i, 1);
    }

    private place(key: string, x: number, y: number, scale: number, flip: boolean): Phaser.GameObjects.Image {
        const s = this.scene.add.image(x, y, key)
            .setOrigin(0.5, 0.92)
            .setScale(scale)
            .setDepth(y)
            .setFlipX(flip);
        this.layer.add(s);
        return s;
    }

    // A tap (not a camera drag) on a building fires `cb`.
    private makeTappable(img: Phaser.GameObjects.Image, cb: () => void) {
        img.setInteractive({ useHandCursor: true });
        img.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (pointer.getDistance() < 14) cb();
        });
    }

    update(delta: number) {
        // One global cadence for every producer: spawn one unit each `spawnSeconds`.
        const intervalMs = Math.max(250, CONFIG.production.spawnSeconds * 1000);
        for (const p of this.producers) {
            p.acc += delta;
            if (p.acc < intervalMs) continue;
            // A capped building pauses while it is already at its live-unit limit, holding the
            // timer full so it spawns a replacement the instant one of its units dies/escapes.
            if (p.cap > 0 && this.units.producerLivingCount(p.id) >= p.cap) {
                p.acc = intervalMs;
                continue;
            }
            p.acc -= intervalMs;
            this.units.spawnAt(p.faction, p.typeIndex, p.x, p.y, p.id);
        }
        // Finish any site a peasant has hammered to completion (progress advanced elsewhere).
        for (let i = this.sites.length - 1; i >= 0; i--) {
            const s = this.sites[i];
            if (!s.done && s.progress >= s.def.buildTime) this.finishSite(s);
        }
    }

    // The Castle (bank / drop-off) position for a side — where peasants deposit.
    keepPosition(faction: Faction): { x: number; y: number } {
        return this.keepPos[faction];
    }

    // The live list of House (worker spawn) positions for a side — grows as Houses are built.
    housePositions(faction: Faction): { x: number; y: number }[] {
        return this.housePos[faction];
    }

    // Building footprints (production + Houses; never keeps) for the unit collision pass.
    obstacles(): { x: number; y: number; r: number }[] {
        return this.obstacleList;
    }

    // Empty, buildable spots for a side (not the keep/general/a building/under construction).
    // Used by the enemy build AI to choose where to construct.
    freeSlots(faction: Faction): number[] {
        const spotCount = CONFIG.grid.cols * CONFIG.grid.rows;
        const free: number[] = [];
        for (let spot = 1; spot <= spotCount; spot++) {
            if (!this.occupied[faction].has(spot)) free.push(spot);
        }
        return free;
    }
}

function catalogDef(key: string): BuildingDef | undefined {
    return CONFIG.production.catalog.find((b) => b.key === key);
}

export { catalogDef };
