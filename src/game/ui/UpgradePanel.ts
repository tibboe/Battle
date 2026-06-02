import * as Phaser from 'phaser';
import { UnitManager } from '../units/UnitManager';
import { saveSettings } from '../settings';
import { toggleUpgrade, upgradeActive, upgradesForKind } from '../upgrades';

// The building upgrade popup. Tapping a player building opens this for that building's
// "kind" (a unit key, or 'general'); each upgrade is a free on/off toggle. Toggling applies
// live (UnitManager.recomputeUpgrades) and saves. Screen-fixed on the UI layer.

const DEPTH = 1_000_010;
const W = 300;
const ROW_H = 50;
const HEADER_H = 42;
const PAD = 12;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class UpgradePanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;

    private bg!: Phaser.GameObjects.Rectangle;
    private title!: Phaser.GameObjects.Text;
    private closeBtn!: Phaser.GameObjects.Text;
    private rows: Phaser.GameObjects.GameObject[] = [];
    private isOpen = false;
    private kind = '';

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, units: UnitManager) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;

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
            const label = this.scene.add.text(x + PAD, ry + 6, u.label,
                { fontFamily: 'monospace', fontSize: '15px', color: '#cfe6ff' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            const desc = this.scene.add.text(x + PAD, ry + 26, u.desc,
                { fontFamily: 'monospace', fontSize: '11px', color: '#8aa0b5' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            const btn = this.mkButton(upgradeActive(u.key) ? '✓ On' : 'Activate', () => {
                toggleUpgrade(u.key);
                this.units.recomputeUpgrades();
                saveSettings();
                const on = upgradeActive(u.key);
                btn.setText(on ? '✓ On' : 'Activate').setBackgroundColor(on ? '#2e6b3a' : '#3a4350');
            });
            btn.setPosition(x + W - 100, ry + 10).setBackgroundColor(upgradeActive(u.key) ? '#2e6b3a' : '#3a4350');
            this.layer.add([label, desc]);
            this.rows.push(label, desc, btn);
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
}
