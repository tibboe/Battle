import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { FACTION, UnitManager } from '../units/UnitManager';
import {
    ORDER, Order, Shape, SHAPE, SHAPE_LABEL, TargetingMode,
    formationRank, formationSlots, spacingFor,
} from '../units/commands';

// The player's unit command system: selection (which unit TYPES are selected — driven by the
// right-side roster) + the bottom command bar (stance + formation buttons) + the world-space
// selection rings and the targeting preview. Issuing a Move/Attack-move/Free order hands the
// scene a TargetingMode so the next field tap places the order; Hold is immediate.
//
// Selection is by unit TYPE (e.g. "all your archers"), which is robust to units spawning and
// dying — orders themselves are stored per-unit in the UnitManager, so they persist regardless.

const BAR_DEPTH = 1_000_010;  // same band as the building selection HUD (mutually exclusive)
const BAR_H = 96;
const PAD = 12;

// Formation choice is remembered across orders (and scene restarts) — defaults to a tight
// rectangle, per the design.
let curShape: Shape = SHAPE.rectangle;
let curTight = true;

const FACE = 1; // the player's enemy keep is to the right (+x), so formations face that way

export class CommandBar {
    private readonly scene: Phaser.Scene;
    private readonly units: UnitManager;
    private readonly beginTargeting: (mode: TargetingMode) => void;
    private readonly clearBuildings: () => void;

    private readonly selected = new Set<number>(); // selected unit-type indices
    private readonly rings: Phaser.GameObjects.Graphics;
    private readonly preview: Phaser.GameObjects.Graphics;

    private readonly bg: Phaser.GameObjects.Rectangle;
    private readonly title: Phaser.GameObjects.Text;
    private readonly stanceBtns: { order: Order; btn: Phaser.GameObjects.Text }[] = [];
    private readonly shapeBtns: { shape: Shape; btn: Phaser.GameObjects.Text }[] = [];
    private readonly densityBtns: { tight: boolean; btn: Phaser.GameObjects.Text }[] = [];
    private clearBtn!: Phaser.GameObjects.Text;
    private readonly allButtons: Phaser.GameObjects.Text[] = [];

    constructor(
        scene: Phaser.Scene,
        uiLayer: Phaser.GameObjects.Layer,
        worldLayer: Phaser.GameObjects.Layer,
        units: UnitManager,
        beginTargeting: (mode: TargetingMode) => void,
        clearBuildings: () => void,
    ) {
        this.scene = scene;
        this.units = units;
        this.beginTargeting = beginTargeting;
        this.clearBuildings = clearBuildings;

        this.rings = scene.add.graphics().setDepth(CONFIG.world.height + 1500);
        this.preview = scene.add.graphics().setDepth(CONFIG.world.height + 2600);
        worldLayer.add([this.rings, this.preview]);

        this.bg = scene.add.rectangle(0, 0, 100, BAR_H, 0x0b1016, 0.96)
            .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0x3a4350).setDepth(BAR_DEPTH)
            .setInteractive().setVisible(false);
        this.title = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '15px', color: '#e8f1ff' })
            .setScrollFactor(0).setDepth(BAR_DEPTH + 1).setVisible(false);
        uiLayer.add([this.bg, this.title]);

        // Stance row. "Auto" resumes the default auto-advance and clears the standing order.
        this.stanceBtns = [
            { order: ORDER.move, btn: this.mkBtn(uiLayer, 'Move', () => this.startPlacing(ORDER.move)) },
            { order: ORDER.attackMove, btn: this.mkBtn(uiLayer, 'Atk-Move', () => this.startPlacing(ORDER.attackMove)) },
            { order: ORDER.hold, btn: this.mkBtn(uiLayer, 'Hold', () => this.issueHold()) },
            { order: ORDER.free, btn: this.mkBtn(uiLayer, 'Free', () => this.startPlacing(ORDER.free)) },
            { order: ORDER.auto, btn: this.mkBtn(uiLayer, 'Auto', () => this.issueAuto()) },
        ];
        // Formation row.
        this.shapeBtns = ([SHAPE.rectangle, SHAPE.square, SHAPE.line] as Shape[]).map((s) => ({
            shape: s, btn: this.mkBtn(uiLayer, SHAPE_LABEL[s], () => { curShape = s; this.render(); }),
        }));
        this.densityBtns = [
            { tight: true, btn: this.mkBtn(uiLayer, 'Tight', () => { curTight = true; this.render(); }) },
            { tight: false, btn: this.mkBtn(uiLayer, 'Loose', () => { curTight = false; this.render(); }) },
        ];
        this.clearBtn = this.mkBtn(uiLayer, '✕ Clear', () => this.clearSelection());

        this.layout();
    }

    private mkBtn(layer: Phaser.GameObjects.Layer, text: string, onTap: () => void) {
        const b = this.scene.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
            backgroundColor: '#3a4350', padding: { x: 8, y: 5 },
        }).setScrollFactor(0).setDepth(BAR_DEPTH + 1).setInteractive({ useHandCursor: true }).setVisible(false);
        b.on('pointerup', onTap);
        layer.add(b);
        this.allButtons.push(b);
        return b;
    }

    // ---- selection (driven by the right-side roster) ----

    toggleType(typeIndex: number) {
        if (this.selected.has(typeIndex)) this.selected.delete(typeIndex);
        else this.selected.add(typeIndex);
        this.onSelectionChanged();
    }

    selectAll() {
        for (let t = 0; t < CONFIG.unitTypes.length; t++) this.selected.add(t);
        this.onSelectionChanged();
    }

    clearSelection() {
        this.selected.clear();
        this.onSelectionChanged();
    }

    isTypeSelected(typeIndex: number): boolean {
        return this.selected.has(typeIndex);
    }

    private onSelectionChanged() {
        if (this.selected.size > 0) this.clearBuildings(); // one context at a time
        this.render();
    }

    // ---- issuing orders ----

    // Hold is immediate: every selected unit digs in where it currently stands. The standing
    // order rallies later reinforcements of each type to that type's current hold-line centre.
    private issueHold() {
        const sum = new Map<number, { x: number; y: number; n: number }>();
        this.units.forEachPlayerUnit((i, type, x, y) => {
            if (!this.selected.has(type)) return;
            this.units.setOrder(i, ORDER.hold, x, y);
            const s = sum.get(type) ?? { x: 0, y: 0, n: 0 };
            s.x += x; s.y += y; s.n++;
            sum.set(type, s);
        });
        for (const t of this.selected) {
            const s = sum.get(t);
            if (s) this.units.setStandingOrder(t, ORDER.hold, s.x / s.n, s.y / s.n);
        }
    }

    // Auto is immediate: drop the standing order and let the selected units resume advancing.
    private issueAuto() {
        this.units.forEachPlayerUnit((i, type) => {
            if (this.selected.has(type)) this.units.setOrder(i, ORDER.auto, 0, 0);
        });
        for (const t of this.selected) this.units.setStandingOrder(t, ORDER.auto, 0, 0);
    }

    // Move / Attack-move / Free need a target point — arm a targeting mode for the next tap.
    private startPlacing(order: Order) {
        if (this.selected.size === 0) return;
        this.beginTargeting({
            onMove: (wx, wy) => this.drawPreview(order, wx, wy),
            onCommit: (wx, wy) => { this.issuePlaced(order, wx, wy); this.preview.clear(); },
            onCancel: () => this.preview.clear(),
        });
    }

    private issuePlaced(order: Order, wx: number, wy: number) {
        if (order === ORDER.free) {
            this.units.forEachPlayerUnit((i, type) => {
                if (this.selected.has(type)) this.units.setOrder(i, ORDER.free, wx, wy);
            });
            this.setStandingForSelected(order, wx, wy);
            return;
        }
        // Move / Attack-move: arrange the selected units into the current formation. Slots come
        // out front-row-first (nearest the enemy), so ordering the units front-to-back by type
        // — knight, lancer, archer, monk — puts melee up front and support at the back.
        const group = this.gatherSelected();
        const slots = formationSlots(group.length, wx, wy, curShape, spacingFor(curTight), FACE);
        group.sort((a, b) => formationRank(a.type) - formationRank(b.type) || a.y - b.y);
        for (let k = 0; k < group.length; k++) {
            this.units.setOrder(group[k].i, order, slots[k].x, slots[k].y);
        }
        // Reinforcements rally to the formation's centre (the tap point).
        this.setStandingForSelected(order, wx, wy);
    }

    // Persist the issued order per selected type, so units that spawn later inherit it.
    private setStandingForSelected(order: Order, x: number, y: number) {
        for (const t of this.selected) this.units.setStandingOrder(t, order, x, y);
    }

    private gatherSelected(): { i: number; type: number; x: number; y: number }[] {
        const out: { i: number; type: number; x: number; y: number }[] = [];
        this.units.forEachPlayerUnit((i, type, x, y) => {
            if (this.selected.has(type)) out.push({ i, type, x, y });
        });
        return out;
    }

    // ---- preview while targeting ----

    private drawPreview(order: Order, wx: number, wy: number) {
        const g = this.preview;
        g.clear();
        if (order === ORDER.free) {
            const r = CONFIG.command.freeRadius;
            g.fillStyle(0xffd24a, 0.07).fillCircle(wx, wy, r);
            g.lineStyle(3, 0xffd24a, 0.85).strokeCircle(wx, wy, r);
            return;
        }
        const group = this.gatherSelected();
        const slots = formationSlots(group.length, wx, wy, curShape, spacingFor(curTight), FACE);
        g.fillStyle(0x7fd0ff, 0.55);
        g.lineStyle(2, 0x7fd0ff, 0.5);
        for (const s of slots) {
            const cy = this.units.clampLaneY(s.y);
            g.fillCircle(s.x, cy, 6);
        }
    }

    // ---- per-frame: draw a ring under each selected unit, keep the bar in sync ----

    update() {
        const g = this.rings;
        g.clear();
        if (this.selected.size === 0) return;
        g.lineStyle(2, 0x7fd0ff, 0.9);
        this.units.forEachPlayerUnit((_i, type, x, y) => {
            if (this.selected.has(type)) g.strokeEllipse(x, y, 34, 16);
        });
    }

    // ---- layout + styling ----

    private render() {
        const open = this.selected.size > 0;
        this.bg.setVisible(open);
        this.title.setVisible(open);
        for (const b of this.allButtons) b.setVisible(open);
        if (!open) return;

        // Count how many living units the selection covers, for the title.
        let n = 0;
        for (const t of this.selected) n += this.units.livingTypeCount(t, FACTION.player);
        this.title.setText(`${n} unit${n === 1 ? '' : 's'} selected`);

        // Highlight the active formation choices.
        for (const s of this.shapeBtns) s.btn.setBackgroundColor(s.shape === curShape ? '#2a6cd6' : '#3a4350');
        for (const d of this.densityBtns) d.btn.setBackgroundColor(d.tight === curTight ? '#2a6cd6' : '#3a4350');

        this.layout();
    }

    layout() {
        const W = this.scene.scale.width;
        const H = this.scene.scale.height;
        const barY = H - BAR_H;
        this.bg.setPosition(0, barY).setSize(W, BAR_H);
        const hit = this.bg.input?.hitArea as Phaser.Geom.Rectangle | undefined;
        if (hit) hit.setTo(0, 0, W, BAR_H);
        this.title.setPosition(PAD, barY + 8);

        // Row 1: stance buttons. Row 2: formation shape + density, with Clear at the far right.
        let x = PAD;
        const row1 = barY + 30;
        for (const s of this.stanceBtns) { s.btn.setPosition(x, row1); x += s.btn.width + 8; }

        x = PAD;
        const row2 = barY + 62;
        for (const s of this.shapeBtns) { s.btn.setPosition(x, row2); x += s.btn.width + 6; }
        x += 10;
        for (const d of this.densityBtns) { d.btn.setPosition(x, row2); x += d.btn.width + 6; }
        this.clearBtn.setPosition(W - this.clearBtn.width - PAD, row2);
    }
}
