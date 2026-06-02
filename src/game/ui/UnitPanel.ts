import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { animKey } from '../units/animations';
import { FACTION, UnitManager } from '../units/UnitManager';
import { saveSettings } from '../settings';

// A right-edge roster panel (a builder/inspector aid, like the Dev panel). One tile per
// unit type: a small animated icon, the name, and the LIVE count of that type on each side
// (azure = you, crimson = enemy). Tap a tile to open an EDITABLE stats card — step HP,
// damage, range, attack & spawn cadence (in seconds), move speed, and (Monk) heal up/down.
// Edits apply live and are saved to localStorage. Lives on the UI layer (screen-fixed).

const PANEL_DEPTH = 1_000_000;
const CARD_DEPTH = 1_000_002;

const TILE_W = 150;
const TILE_H = 46;
const GAP = 5;
const TOP = 92; // below the HUD's Dev/Fit buttons + enemy Castle health bar (right column)
const ICON = 40;
const MARGIN = 8;

const CARD_W = 234;
const ROWH = 24;
const PAD = 8;

// Open/closed + current selection persist across scene restarts (a restart rebuilds us).
let panelOpen = true;
let selected = -1;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mul = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// The catalog entry whose building makes unit `i` (for editing its spawn interval). Editing
// `every` here affects both this side's producer and the build catalog (one source of truth).
const buildingOf = (i: number) =>
    CONFIG.production.catalog.find((b) => b.produces === CONFIG.unitTypes[i].key);

// One editable stat row. `get`/`set` operate on CONFIG for the selected unit index.
interface StatField {
    label: string;
    step: number;
    min: number;
    max: number;
    monkOnly?: boolean;
    get: (i: number) => number;
    set: (i: number, v: number) => void;
    fmt?: (v: number) => string;
}

const secs = (v: number) => `${v.toFixed(2)}s`;

const FIELDS: StatField[] = [
    { label: 'HP', step: 2, min: 1, max: 300, get: (i) => CONFIG.unitTypes[i].hp, set: (i, v) => (CONFIG.unitTypes[i].hp = v) },
    { label: 'Damage', step: 1, min: 0, max: 100, get: (i) => CONFIG.unitTypes[i].damage, set: (i, v) => (CONFIG.unitTypes[i].damage = v) },
    { label: 'Range', step: 10, min: 10, max: 480, get: (i) => CONFIG.unitTypes[i].range, set: (i, v) => (CONFIG.unitTypes[i].range = v) },
    { label: 'Attack', step: 0.05, min: 0.05, max: 5, fmt: secs, get: (i) => CONFIG.unitTypes[i].attackInterval / 1000, set: (i, v) => (CONFIG.unitTypes[i].attackInterval = Math.round(v * 1000)) },
    { label: 'Speed', step: 5, min: 10, max: 200, get: (i) => CONFIG.unitTypes[i].moveSpeed, set: (i, v) => (CONFIG.unitTypes[i].moveSpeed = v) },
    { label: 'Spawn', step: 0.25, min: 0.25, max: 15, fmt: secs, get: (i) => (buildingOf(i)?.every ?? 0) / 1000, set: (i, v) => { const b = buildingOf(i); if (b) b.every = Math.round(v * 1000); } },
    { label: 'Heal', step: 1, min: 0, max: 50, monkOnly: true, get: (i) => CONFIG.unitTypes[i].heal?.amount ?? 0, set: (i, v) => { const h = CONFIG.unitTypes[i].heal; if (h) h.amount = v; } },
    { label: 'Heal int', step: 0.1, min: 0.2, max: 10, monkOnly: true, fmt: secs, get: (i) => (CONFIG.unitTypes[i].heal?.interval ?? 0) / 1000, set: (i, v) => { const h = CONFIG.unitTypes[i].heal; if (h) h.interval = Math.round(v * 1000); } },
];

interface Tile {
    bg: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Sprite;
    name: Phaser.GameObjects.Text;
    you: Phaser.GameObjects.Text;
    foe: Phaser.GameObjects.Text;
}

interface CardRow {
    label: Phaser.GameObjects.Text;
    value: Phaser.GameObjects.Text;
    minus: Phaser.GameObjects.Text;
    plus: Phaser.GameObjects.Text;
}

export class UnitPanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;

    private toggle!: Phaser.GameObjects.Text;
    private readonly tiles: Tile[] = [];
    private cardBg!: Phaser.GameObjects.Rectangle;
    private cardHeader!: Phaser.GameObjects.Text;
    private readonly cardRows: CardRow[] = [];
    private visible = true; // master visibility (the HUD's Dev toggle hides the whole panel)

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, units: UnitManager) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;
        this.build();
        this.layout();
        this.setOpen(panelOpen);
    }

    private build() {
        const youCol = '#' + CONFIG.faction.player.tint.toString(16).padStart(6, '0');
        const foeCol = '#' + CONFIG.faction.enemy.tint.toString(16).padStart(6, '0');

        this.toggle = this.mkButton('Units', 0, 0, () => this.setOpen(!panelOpen));
        this.toggle.setBackgroundColor('#333a44');

        CONFIG.unitTypes.forEach((ut, i) => {
            const bg = this.scene.add.rectangle(0, 0, TILE_W, TILE_H, 0x000000, 0.55)
                .setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH)
                .setInteractive({ useHandCursor: true });
            bg.on('pointerup', () => this.toggleCard(i));

            const key = animKey(ut.art, 'player', 'walk');
            const icon = this.scene.add.sprite(0, 0, key)
                .setDisplaySize(ICON, ICON).setOrigin(0.5, 0.5)
                .setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
            icon.play(key);

            const name = this.scene.add.text(0, 0, cap(ut.key), { fontFamily: 'monospace', fontSize: '14px', color: '#e8f1ff' })
                .setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
            const you = this.scene.add.text(0, 0, '0', { fontFamily: 'monospace', fontSize: '13px', color: youCol })
                .setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
            const foe = this.scene.add.text(0, 0, '0', { fontFamily: 'monospace', fontSize: '13px', color: foeCol })
                .setScrollFactor(0).setDepth(PANEL_DEPTH + 1);

            this.layer.add([bg, icon, name, you, foe]);
            this.tiles.push({ bg, icon, name, you, foe });
        });

        // Editable stats card (built once; shown to the LEFT of the column on selection).
        this.cardBg = this.scene.add.rectangle(0, 0, CARD_W, 10, 0x0b1016, 0.94)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(CARD_DEPTH)
            .setStrokeStyle(1, 0x3a4350).setVisible(false);
        this.cardHeader = this.scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '12px', color: '#dfe9f5', lineSpacing: 3,
            wordWrap: { width: CARD_W - PAD * 2 },
        }).setScrollFactor(0).setDepth(CARD_DEPTH + 1).setVisible(false);
        this.layer.add([this.cardBg, this.cardHeader]);

        FIELDS.forEach((f, fi) => {
            const label = this.scene.add.text(0, 0, f.label, { fontFamily: 'monospace', fontSize: '13px', color: '#cfe6ff' })
                .setScrollFactor(0).setDepth(CARD_DEPTH + 1).setVisible(false);
            const value = this.scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
                .setScrollFactor(0).setDepth(CARD_DEPTH + 1).setVisible(false);
            const minus = this.mkButton('−', 0, 0, () => this.bumpStat(fi, -1)).setDepth(CARD_DEPTH + 1).setVisible(false);
            const plus = this.mkButton('+', 0, 0, () => this.bumpStat(fi, +1)).setDepth(CARD_DEPTH + 1).setVisible(false);
            this.layer.add([label, value]);
            this.cardRows.push({ label, value, minus, plus });
        });
    }

    private mkButton(text: string, x: number, y: number, onTap: () => void) {
        const btn = this.scene.add.text(x, y, text, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff',
            backgroundColor: '#3a4350', padding: { x: 7, y: 4 },
        }).setScrollFactor(0).setDepth(PANEL_DEPTH).setInteractive({ useHandCursor: true });
        btn.on('pointerup', onTap);
        this.layer.add(btn);
        return btn;
    }

    layout() {
        const w = this.scene.scale.width;
        const colLeft = w - TILE_W - MARGIN;
        this.toggle.setPosition(colLeft, TOP);

        const startY = TOP + 28;
        this.tiles.forEach((t, i) => {
            const ty = startY + i * (TILE_H + GAP);
            t.bg.setPosition(colLeft, ty);
            t.icon.setPosition(colLeft + 6 + ICON / 2, ty + TILE_H / 2);
            t.name.setPosition(colLeft + ICON + 14, ty + 6);
            t.you.setPosition(colLeft + ICON + 14, ty + 24);
            t.foe.setPosition(colLeft + ICON + 64, ty + 24);
        });

        if (selected >= 0) this.renderCard(selected);
    }

    private toggleCard(i: number) {
        if (selected === i) {
            selected = -1;
            this.hideCard();
        } else {
            this.renderCard(i);
        }
        this.highlight();
    }

    // Position + populate the card for unit `i` (also sets `selected`).
    private renderCard(i: number) {
        selected = i;
        const ut = CONFIG.unitTypes[i];
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const cx = Math.max(8, w - TILE_W - MARGIN - CARD_W - 8);

        const row = CONFIG.combat.matrix[ut.weapon];
        const vs = row
            ? `vs Un ${mul(row.Unarmored)} Li ${mul(row.Light)} Me ${mul(row.Medium)} He ${mul(row.Heavy)}`
            : 'support — no attack';
        this.cardHeader.setText(`${cap(ut.key)} (${ut.role})  ${ut.weapon}/${ut.armour}\n${vs}`);

        let visibleCount = 0;
        for (const f of FIELDS) if (!f.monkOnly || ut.heal) visibleCount++;
        const headerH = this.cardHeader.height;
        const cardH = PAD + headerH + 6 + visibleCount * ROWH + PAD;
        let cy = TOP + 28 + i * (TILE_H + GAP);
        cy = Math.max(8, Math.min(cy, h - cardH - 8));

        this.cardBg.setPosition(cx, cy).setSize(CARD_W, cardH).setVisible(panelOpen);
        this.cardHeader.setPosition(cx + PAD, cy + PAD).setVisible(panelOpen);

        let ry = cy + PAD + headerH + 6;
        FIELDS.forEach((f, fi) => {
            const r = this.cardRows[fi];
            const show = panelOpen && (!f.monkOnly || !!ut.heal);
            if (!show) {
                r.label.setVisible(false); r.value.setVisible(false);
                r.minus.setVisible(false); r.plus.setVisible(false);
                return;
            }
            const v = f.get(i);
            r.label.setPosition(cx + PAD, ry).setVisible(true);
            r.value.setText(f.fmt ? f.fmt(v) : String(v)).setPosition(cx + PAD + 86, ry).setVisible(true);
            r.minus.setPosition(cx + CARD_W - 58, ry - 3).setVisible(true);
            r.plus.setPosition(cx + CARD_W - 30, ry - 3).setVisible(true);
            ry += ROWH;
        });
    }

    private bumpStat(fi: number, dir: number) {
        if (selected < 0) return;
        const f = FIELDS[fi];
        const cur = f.get(selected);
        const next = Phaser.Math.Clamp(Math.round((cur + dir * f.step) * 100) / 100, f.min, f.max);
        if (next === cur) return;
        f.set(selected, next);
        this.units.refreshFromConfig(); // apply live
        saveSettings();                 // persist
        this.refreshCardValues();
    }

    private refreshCardValues() {
        if (selected < 0) return;
        const ut = CONFIG.unitTypes[selected];
        FIELDS.forEach((f, fi) => {
            if (f.monkOnly && !ut.heal) return;
            const v = f.get(selected);
            this.cardRows[fi].value.setText(f.fmt ? f.fmt(v) : String(v));
        });
    }

    private hideCard() {
        this.cardBg.setVisible(false);
        this.cardHeader.setVisible(false);
        for (const r of this.cardRows) {
            r.label.setVisible(false); r.value.setVisible(false);
            r.minus.setVisible(false); r.plus.setVisible(false);
        }
    }

    private highlight() {
        this.tiles.forEach((t, i) => t.bg.setFillStyle(0x000000, i === selected ? 0.8 : 0.55));
    }

    private setOpen(open: boolean) {
        panelOpen = open;
        this.toggle.setText(open ? 'Units ▾' : 'Units ▸');
        for (const t of this.tiles) {
            t.bg.setVisible(open); t.icon.setVisible(open); t.name.setVisible(open);
            t.you.setVisible(open); t.foe.setVisible(open);
        }
        if (open && selected >= 0) this.renderCard(selected);
        else this.hideCard();
        this.highlight();
    }

    // Master show/hide, driven by the HUD's Dev toggle (keeps its open/closed + selection).
    setVisible(v: boolean) {
        this.visible = v;
        this.toggle.setVisible(v);
        if (v) {
            this.setOpen(panelOpen);
        } else {
            for (const t of this.tiles) {
                t.bg.setVisible(false); t.icon.setVisible(false); t.name.setVisible(false);
                t.you.setVisible(false); t.foe.setVisible(false);
            }
            this.hideCard();
        }
    }

    // Refresh live counts (cheap; called each frame).
    update() {
        if (!this.visible || !panelOpen) return;
        this.tiles.forEach((t, i) => {
            const you = String(this.units.livingTypeCount(i, FACTION.player));
            const foe = String(this.units.livingTypeCount(i, FACTION.enemy));
            if (t.you.text !== you) t.you.setText(you);
            if (t.foe.text !== foe) t.foe.setText(foe);
        });
    }
}
