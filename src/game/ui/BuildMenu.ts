import * as Phaser from 'phaser';
import { CONFIG, Cost } from '../config';
import { Faction } from '../units/UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { Buildings } from '../structures/buildings';

// The build menu (Milestone 4 Phase 2). Tapping an empty grid slot opens this: a list of the
// catalog buildings with their costs. An affordable one can be bought — it deducts the cost
// and starts construction on that slot (a peasant then hammers it up). Unaffordable rows are
// greyed out. Screen-fixed on the UI layer, like the upgrade popup.

const DEPTH = 1_000_010;
const W = 320;
const ROW_H = 56;
const HEADER_H = 42;
const PAD = 12;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const costLine = (c: Cost) => `Gold ${c.gold}  Stone ${c.stone}  Wood ${c.wood}`;

export class BuildMenu {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly buildings: Buildings;
    private readonly store: ResourceStore;

    private bg!: Phaser.GameObjects.Rectangle;
    private title!: Phaser.GameObjects.Text;
    private closeBtn!: Phaser.GameObjects.Text;
    private rows: Phaser.GameObjects.GameObject[] = [];
    private isOpen = false;
    private faction: Faction = 0 as Faction;
    private spot = -1;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, buildings: Buildings, store: ResourceStore) {
        this.scene = scene;
        this.layer = layer;
        this.buildings = buildings;
        this.store = store;

        this.bg = scene.add.rectangle(0, 0, W, 80, 0x0b1016, 0.96)
            .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0x3a4350).setDepth(DEPTH).setVisible(false);
        this.title = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '18px', color: '#e8f1ff' })
            .setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
        this.closeBtn = this.mkButton('✕', () => this.close());
        this.closeBtn.setBackgroundColor('#5a3a3a').setVisible(false);
        layer.add([this.bg, this.title]);
    }

    private mkButton(text: string, onTap: () => void) {
        const b = this.scene.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
            backgroundColor: '#3a4350', padding: { x: 8, y: 5 },
        }).setScrollFactor(0).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
        b.on('pointerup', onTap);
        this.layer.add(b);
        return b;
    }

    // Tapping the same slot again closes; a different slot re-opens for it.
    open(faction: Faction, spot: number) {
        if (this.isOpen && this.faction === faction && this.spot === spot) { this.close(); return; }
        this.faction = faction;
        this.spot = spot;
        this.show();
    }

    private show() {
        this.clearRows();
        this.isOpen = true;

        const cat = CONFIG.production.catalog;
        const h = HEADER_H + cat.length * ROW_H + PAD;
        const x = (this.scene.scale.width - W) / 2;
        const y = 60;

        this.bg.setPosition(x, y).setSize(W, h).setVisible(true);
        this.title.setText('Build').setPosition(x + PAD, y + 11).setVisible(true);
        this.closeBtn.setPosition(x + W - 34, y + 8).setVisible(true);

        let ry = y + HEADER_H;
        for (const def of cat) {
            const affordable = this.store.canAfford(this.faction, def.cost);
            const name = this.scene.add.text(x + PAD, ry + 6,
                `${cap(def.key)}${def.produces ? '' : ' (peasants)'}`,
                { fontFamily: 'monospace', fontSize: '15px', color: affordable ? '#cfe6ff' : '#6b7886' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            const cost = this.scene.add.text(x + PAD, ry + 26, costLine(def.cost),
                { fontFamily: 'monospace', fontSize: '11px', color: affordable ? '#8aa0b5' : '#5a6572' })
                .setScrollFactor(0).setDepth(DEPTH + 1);

            const btn = this.mkButton(affordable ? 'Build' : 'Need more', () => {
                if (!this.store.spend(this.faction, def.cost)) return; // afford may have changed
                this.buildings.startConstruction(this.faction, this.spot, def.key);
                this.close();
            });
            btn.setPosition(x + W - 108, ry + 12)
                .setBackgroundColor(affordable ? '#2e6b3a' : '#33373d');
            if (!affordable) btn.disableInteractive().setAlpha(0.6);

            this.layer.add([name, cost]);
            this.rows.push(name, cost, btn);
            ry += ROW_H;
        }
    }

    private clearRows() {
        for (const o of this.rows) o.destroy();
        this.rows = [];
    }

    close() {
        this.isOpen = false;
        this.spot = -1;
        this.bg.setVisible(false);
        this.title.setVisible(false);
        this.closeBtn.setVisible(false);
        this.clearRows();
    }

    layout() {
        if (this.isOpen) this.show(); // re-centre on resize
    }

    // Re-render while open so affordability tracks the stockpile as peasants bank.
    refresh() {
        if (this.isOpen) this.show();
    }
}
