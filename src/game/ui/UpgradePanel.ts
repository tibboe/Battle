import * as Phaser from 'phaser';
import { Cost } from '../config';
import { FACTION, UnitManager } from '../units/UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { costOf, purchaseUpgrade, upgradeActive, upgradesForKind } from '../upgrades';

// The building upgrade popup. Tapping a player building opens this for that building's "kind"
// (a unit key, or 'general'); each upgrade is a one-time PURCHASE (Milestone 4 Phase 3): it
// shows a resource price, is only buyable if affordable, and deducts on purchase. Buying
// applies live (UnitManager.recomputeUpgrades). Upgrades are per-match. Screen-fixed on the
// UI layer.

const DEPTH = 1_000_010;
const W = 320;
const ROW_H = 62;
const HEADER_H = 42;
const PAD = 12;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const costLine = (c: Cost) => `Gold ${c.gold}  Stone ${c.stone}  Wood ${c.wood}`;

export class UpgradePanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;
    private readonly store: ResourceStore;

    private bg!: Phaser.GameObjects.Rectangle;
    private title!: Phaser.GameObjects.Text;
    private closeBtn!: Phaser.GameObjects.Text;
    private rows: Phaser.GameObjects.GameObject[] = [];
    private isOpen = false;
    private kind = '';

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, units: UnitManager, store: ResourceStore) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;
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

    // Tap the same building again to close; a different one re-opens for that kind.
    toggle(kind: string) {
        if (this.isOpen && this.kind === kind) this.close();
        else this.show(kind);
    }

    show(kind: string) {
        this.clearRows();
        this.kind = kind;
        this.isOpen = true;

        const ups = upgradesForKind(kind);
        const bodyH = (ups.length || 1) * ROW_H;
        const h = HEADER_H + bodyH + PAD;
        const x = (this.scene.scale.width - W) / 2;
        const y = 60;

        this.bg.setPosition(x, y).setSize(W, h).setVisible(true);
        this.title.setText(kind === 'general' ? 'General upgrades' : `${cap(kind)} upgrades`)
            .setPosition(x + PAD, y + 11).setVisible(true);
        this.closeBtn.setPosition(x + W - 34, y + 8).setVisible(true);

        let ry = y + HEADER_H;
        if (!ups.length) {
            const t = this.scene.add.text(x + PAD, ry + 4, 'No upgrades yet.',
                { fontFamily: 'monospace', fontSize: '14px', color: '#9fb3c8' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            this.layer.add(t);
            this.rows.push(t);
        }
        for (const u of ups) {
            const owned = upgradeActive(u.key);
            const cost = costOf(u.key);
            const affordable = this.store.canAfford(FACTION.player, cost);
            const lit = owned || affordable; // bright text when ownable/owned

            const label = this.scene.add.text(x + PAD, ry + 5, u.label,
                { fontFamily: 'monospace', fontSize: '15px', color: lit ? '#cfe6ff' : '#6b7886' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            const desc = this.scene.add.text(x + PAD, ry + 24, u.desc,
                { fontFamily: 'monospace', fontSize: '11px', color: lit ? '#8aa0b5' : '#5a6572' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            const price = this.scene.add.text(x + PAD, ry + 40,
                owned ? 'owned' : costLine(cost),
                { fontFamily: 'monospace', fontSize: '11px', color: owned ? '#7be08a' : (affordable ? '#c0b46a' : '#5a6572') })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            this.layer.add([label, desc, price]);
            this.rows.push(label, desc, price);

            const btnText = owned ? '✓ Owned' : (affordable ? 'Buy' : 'Need more');
            const btn = this.mkButton(btnText, () => {
                if (owned || !this.store.spend(FACTION.player, cost)) return;
                purchaseUpgrade(u.key);
                this.units.recomputeUpgrades();
                this.show(this.kind); // refresh: this row flips to Owned, others may grey out
            });
            btn.setPosition(x + W - 104, ry + 16)
                .setBackgroundColor(owned ? '#2e6b3a' : (affordable ? '#2e6b3a' : '#33373d'));
            if (owned || !affordable) btn.disableInteractive().setAlpha(owned ? 1 : 0.6);
            this.rows.push(btn);

            ry += ROW_H;
        }
    }

    private clearRows() {
        for (const o of this.rows) o.destroy();
        this.rows = [];
    }

    close() {
        this.isOpen = false;
        this.kind = '';
        this.bg.setVisible(false);
        this.title.setVisible(false);
        this.closeBtn.setVisible(false);
        this.clearRows();
    }

    layout() {
        if (this.isOpen) this.show(this.kind); // re-centre on resize
    }

    // Re-render while open so affordability tracks the stockpile as peasants bank.
    refresh() {
        if (this.isOpen) this.show(this.kind);
    }
}
