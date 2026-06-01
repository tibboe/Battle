import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { animKey } from '../units/animations';
import { FACTION, UnitManager } from '../units/UnitManager';

// A right-edge roster panel (a builder/inspector aid, like the Dev panel). One tile per
// unit type: a small animated icon, the unit's name, and the LIVE count of that type on
// each side (azure = you, crimson = enemy). Tap a tile to open a stats card — hp, damage,
// attack cadence, range, speed, weapon/armour, and that weapon's counter multipliers vs
// each armour. Lives on the UI layer (screen-fixed, ignored by world zoom/pan).

const PANEL_DEPTH = 1_000_000;
const CARD_DEPTH = 1_000_002;

const TILE_W = 150;
const TILE_H = 46;
const GAP = 5;
const TOP = 46;        // below the FPS / Fit row
const ICON = 40;       // icon display square (frames are square, so no distortion)
const MARGIN = 8;      // from the right screen edge

// Open/closed + current selection persist across scene restarts (a restart rebuilds us).
let panelOpen = true;
let selected = -1;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mul = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v)); // 1 -> "1.0"

export class UnitPanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;

    private toggle!: Phaser.GameObjects.Text;
    private readonly tiles: {
        bg: Phaser.GameObjects.Rectangle;
        icon: Phaser.GameObjects.Sprite;
        name: Phaser.GameObjects.Text;
        you: Phaser.GameObjects.Text;
        foe: Phaser.GameObjects.Text;
    }[] = [];
    private cardBg!: Phaser.GameObjects.Rectangle;
    private cardText!: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, units: UnitManager) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;
        this.build();
        this.layout();
        this.setOpen(panelOpen);
        if (selected >= 0) this.showCard(selected);
    }

    private build() {
        const youTint = '#' + CONFIG.faction.player.tint.toString(16).padStart(6, '0');
        const foeTint = '#' + CONFIG.faction.enemy.tint.toString(16).padStart(6, '0');

        this.toggle = this.mkButton('Units', 0, 0, () => this.setOpen(!panelOpen));
        this.toggle.setBackgroundColor('#333a44');

        CONFIG.unitTypes.forEach((ut, i) => {
            const bg = this.scene.add.rectangle(0, 0, TILE_W, TILE_H, 0x000000, 0.55)
                .setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH)
                .setInteractive({ useHandCursor: true });
            bg.on('pointerup', () => this.toggleCard(i));

            // Animated icon: the player's walk strip, forced to a uniform square.
            const key = animKey(ut.art, 'player', 'walk');
            const icon = this.scene.add.sprite(0, 0, key)
                .setDisplaySize(ICON, ICON).setOrigin(0.5, 0.5)
                .setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
            icon.play(key);

            const name = this.scene.add.text(0, 0, cap(ut.key), {
                fontFamily: 'monospace', fontSize: '14px', color: '#e8f1ff',
            }).setScrollFactor(0).setDepth(PANEL_DEPTH + 1);

            const you = this.scene.add.text(0, 0, '0', {
                fontFamily: 'monospace', fontSize: '13px', color: youTint,
            }).setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
            const foe = this.scene.add.text(0, 0, '0', {
                fontFamily: 'monospace', fontSize: '13px', color: foeTint,
            }).setScrollFactor(0).setDepth(PANEL_DEPTH + 1);

            this.layer.add([bg, icon, name, you, foe]);
            this.tiles.push({ bg, icon, name, you, foe });
        });

        // Single reusable stats card, shown to the LEFT of the column on selection.
        this.cardBg = this.scene.add.rectangle(0, 0, 10, 10, 0x0b1016, 0.92)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(CARD_DEPTH)
            .setStrokeStyle(1, 0x3a4350).setVisible(false);
        this.cardText = this.scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '13px', color: '#dfe9f5', lineSpacing: 4,
        }).setScrollFactor(0).setDepth(CARD_DEPTH + 1).setVisible(false);
        this.layer.add([this.cardBg, this.cardText]);
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

    // Anchor the column to the current right edge; lay tiles top-down.
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

        if (selected >= 0) this.positionCard(selected);
    }

    private toggleCard(i: number) {
        if (selected === i) {
            selected = -1;
            this.cardBg.setVisible(false);
            this.cardText.setVisible(false);
        } else {
            this.showCard(i);
        }
        this.highlight();
    }

    private showCard(i: number) {
        selected = i;
        const ut = CONFIG.unitTypes[i];
        const row = CONFIG.combat.matrix[ut.weapon];
        const vs = row
            ? `vs Un ${mul(row.Unarmored)} Li ${mul(row.Light)} Me ${mul(row.Medium)} He ${mul(row.Heavy)}`
            : 'vs —  (no attack)';
        this.cardText.setText([
            `${cap(ut.key)}  (${ut.role})`,
            `HP ${ut.hp}    DMG ${ut.damage}`,
            `Atk ${ut.attackInterval}ms`,
            `Range ${ut.range}   Spd ${ut.moveSpeed}`,
            `Weapon ${ut.weapon}`,
            `Armour ${ut.armour}`,
            vs,
        ].join('\n'));
        this.cardText.setVisible(panelOpen);
        this.cardBg.setVisible(panelOpen);
        this.positionCard(i);
        this.highlight();
    }

    private positionCard(i: number) {
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const colLeft = w - TILE_W - MARGIN;
        const pad = 8;
        this.cardBg.setSize(this.cardText.width + pad * 2, this.cardText.height + pad * 2);
        let cy = TOP + 28 + i * (TILE_H + GAP);
        cy = Math.min(cy, h - this.cardBg.height - 8); // keep on-screen
        const cx = colLeft - this.cardBg.width - 8;
        this.cardBg.setPosition(cx, cy);
        this.cardText.setPosition(cx + pad, cy + pad);
    }

    private highlight() {
        this.tiles.forEach((t, i) => t.bg.setFillStyle(0x000000, i === selected ? 0.8 : 0.55));
    }

    private setOpen(open: boolean) {
        panelOpen = open;
        this.toggle.setText(open ? 'Units ▾' : 'Units ▸');
        for (const t of this.tiles) {
            t.bg.setVisible(open);
            t.icon.setVisible(open);
            t.name.setVisible(open);
            t.you.setVisible(open);
            t.foe.setVisible(open);
        }
        const showCard = open && selected >= 0;
        this.cardBg.setVisible(showCard);
        this.cardText.setVisible(showCard);
    }

    // Refresh live counts (cheap; called each frame).
    update() {
        if (!panelOpen) return;
        this.tiles.forEach((t, i) => {
            const you = this.units.livingTypeCount(i, FACTION.player);
            const foe = this.units.livingTypeCount(i, FACTION.enemy);
            const ys = String(you);
            const fs = String(foe);
            if (t.you.text !== ys) t.you.setText(ys);
            if (t.foe.text !== fs) t.foe.setText(fs);
        });
    }
}
