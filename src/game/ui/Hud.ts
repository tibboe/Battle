import * as Phaser from 'phaser';
import { CONFIG, ResourceType } from '../config';
import { ResourceBag } from '../economy/ResourceStore';

// The player-facing HUD (the M4 HUD pass): a clean resource readout with icons, both Castles'
// health bars, a Fit-camera button, and a Dev toggle that hides/shows the builder tools
// (tuning panel, unit inspector, FPS/Units + enemy-economy debug line). Screen-fixed on the UI
// layer. The dev tools default OFF so it reads like a game; the choice is remembered.
//
// Layout is corner-anchored for the landscape phone: resources top-left, the two Castle bars
// top-centre (yours left, enemy right — mirroring the battlefield), Fit + Dev top-right, and
// the debug line bottom-left (dev only).

const DEPTH = 1_000_000;
const DEV_KEY = 'lanebreaker.hud.dev';

const ASSET = 'assets/environment/tiny-swords';
const ICONS = {
    gold: `${ASSET}/Resources/Gold/Gold Resource/Gold_Resource.png`,
    stone: `${ASSET}/Decorations/Rocks/Rock1.png`,
    wood: `${ASSET}/Resources/Wood/Wood Resource/Wood Resource.png`,
};
const iconKey = (k: string) => `hud-icon-${k}`;

// Bar geometry.
const BAR_W = 188;
const BAR_H = 18;
const ICON_PX = 24;
const SLOT_W = 88; // per-resource slot in the readout strip

const youCol = '#' + CONFIG.faction.player.tint.toString(16).padStart(6, '0');
const foeCol = '#' + CONFIG.faction.enemy.tint.toString(16).padStart(6, '0');

export interface HudData {
    fps: number;
    units: number;
    player: ResourceBag;
    enemy: ResourceBag;
    playerHp: number;
    enemyHp: number;
    maxHp: number;
    workers: Record<ResourceType, number>; // player's live worker count per resource
}

const RES_ORDER: ResourceType[] = ['gold', 'stone', 'wood'];

export function loadHud(scene: Phaser.Scene) {
    for (const [k, path] of Object.entries(ICONS)) scene.load.image(iconKey(k), encodeURI(path));
}

interface Bar {
    label: Phaser.GameObjects.Text;
    bg: Phaser.GameObjects.Rectangle;
    fill: Phaser.GameObjects.Rectangle;
    value: Phaser.GameObjects.Text;
}

export class Hud {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly onDev: (on: boolean) => void;
    private readonly onPeasantAdjust: (res: ResourceType, delta: number) => void;

    private resBg!: Phaser.GameObjects.Rectangle;
    private readonly counts: Record<string, Phaser.GameObjects.Text> = {};

    // Top-centre peasant-allocation strip: per-resource worker count with −/+.
    private workBg!: Phaser.GameObjects.Rectangle;
    private workLabel!: Phaser.GameObjects.Text;
    private readonly workCounts: Record<string, Phaser.GameObjects.Text> = {};
    private readonly workIcons: Phaser.GameObjects.Image[] = [];
    private readonly workMinus: Phaser.GameObjects.Text[] = [];
    private readonly workPlus: Phaser.GameObjects.Text[] = [];
    private playerBar!: Bar;
    private enemyBar!: Bar;
    private fitBtn!: Phaser.GameObjects.Text;
    private devBtn!: Phaser.GameObjects.Text;
    private debug!: Phaser.GameObjects.Text;

    private devOnState: boolean;

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        onFit: () => void,
        onDev: (on: boolean) => void,
        onPeasantAdjust: (res: ResourceType, delta: number) => void,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.onDev = onDev;
        this.onPeasantAdjust = onPeasantAdjust;
        this.devOnState = readDev();

        this.buildResourceStrip();
        this.buildPeasantStrip();
        this.playerBar = this.buildBar('YOUR CASTLE', youCol);
        this.enemyBar = this.buildBar('ENEMY CASTLE', foeCol);

        this.fitBtn = this.mkButton('⤢ Fit', onFit);
        this.devBtn = this.mkButton('🛠 Dev', () => this.setDev(!this.devOnState));

        this.debug = scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '13px', color: '#9fb3c8',
            backgroundColor: '#00000066', padding: { x: 6, y: 4 },
        }).setScrollFactor(0).setDepth(DEPTH);
        layer.add(this.debug);

        this.styleDevBtn();
        this.layout();
    }

    private buildResourceStrip() {
        this.resBg = this.scene.add.rectangle(8, 8, SLOT_W * 3 + 12, 38, 0x000000, 0.55)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH).setStrokeStyle(1, 0xffffff, 0.12);
        this.layer.add(this.resBg);

        const cy = 8 + 19;
        ['gold', 'stone', 'wood'].forEach((k, i) => {
            const x = 16 + i * SLOT_W;
            const icon = this.scene.add.image(x, cy, iconKey(k))
                .setOrigin(0, 0.5).setDisplaySize(ICON_PX, ICON_PX)
                .setScrollFactor(0).setDepth(DEPTH + 1);
            const count = this.scene.add.text(x + ICON_PX + 6, cy, '0', {
                fontFamily: 'monospace', fontSize: '17px', color: '#ffffff',
            }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            this.layer.add([icon, count]);
            this.counts[k] = count;
        });
    }

    private buildPeasantStrip() {
        this.workBg = this.scene.add.rectangle(0, 8, 320, 34, 0x000000, 0.55)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH).setStrokeStyle(1, 0xffffff, 0.12);
        this.layer.add(this.workBg);

        this.workLabel = this.scene.add.text(0, 0, '👷', { fontFamily: 'monospace', fontSize: '16px', color: '#cfe6ff' })
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 1);
        this.layer.add(this.workLabel);

        RES_ORDER.forEach((res) => {
            const icon = this.scene.add.image(0, 0, iconKey(res))
                .setOrigin(0, 0.5).setDisplaySize(18, 18).setScrollFactor(0).setDepth(DEPTH + 1);
            const count = this.scene.add.text(0, 0, '0', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' })
                .setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            const minus = this.mkStepBtn('−', () => this.onPeasantAdjust(res, -1));
            const plus = this.mkStepBtn('+', () => this.onPeasantAdjust(res, +1));
            this.layer.add([icon, count, minus, plus]);
            this.workIcons.push(icon);
            this.workCounts[res] = count;
            this.workMinus.push(minus);
            this.workPlus.push(plus);
        });
    }

    private mkStepBtn(text: string, onTap: () => void) {
        const b = this.scene.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff',
            backgroundColor: '#3a4350', padding: { x: 6, y: 2 },
        }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
        b.on('pointerup', onTap);
        this.layer.add(b);
        return b;
    }

    private buildBar(label: string, color: string): Bar {
        const lbl = this.scene.add.text(0, 0, label, {
            fontFamily: 'monospace', fontSize: '11px', color,
        }).setScrollFactor(0).setDepth(DEPTH + 1);
        const bg = this.scene.add.rectangle(0, 0, BAR_W, BAR_H, 0x000000, 0.6)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH).setStrokeStyle(1, 0xffffff, 0.18);
        const fill = this.scene.add.rectangle(0, 0, BAR_W - 4, BAR_H - 4, Phaser.Display.Color.HexStringToColor(color).color, 1)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH + 1);
        const value = this.scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(DEPTH + 2);
        this.layer.add([bg, fill, lbl, value]);
        return { label: lbl, bg, fill, value };
    }

    private mkButton(text: string, onTap: () => void) {
        const b = this.scene.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '16px', color: '#ffffff',
            backgroundColor: '#2a6cd6', padding: { x: 12, y: 8 },
        }).setScrollFactor(0).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
        b.on('pointerup', onTap);
        this.layer.add(b);
        return b;
    }

    get devOn(): boolean {
        return this.devOnState;
    }

    private setDev(on: boolean) {
        this.devOnState = on;
        writeDev(on);
        this.styleDevBtn();
        this.debug.setVisible(on);
        this.onDev(on);
        this.layout();
    }

    private styleDevBtn() {
        this.devBtn.setBackgroundColor(this.devOnState ? '#c06a2e' : '#333a44');
    }

    update(d: HudData) {
        this.counts.gold.setText(String(d.player.gold));
        this.counts.stone.setText(String(d.player.stone));
        this.counts.wood.setText(String(d.player.wood));

        for (const res of RES_ORDER) this.workCounts[res].setText(String(d.workers[res]));

        this.setBar(this.playerBar, d.playerHp, d.maxHp);
        this.setBar(this.enemyBar, d.enemyHp, d.maxHp);

        if (this.devOnState) {
            const e = d.enemy;
            this.debug.setText(`FPS ${d.fps}  Units ${d.units}    Enemy  G ${e.gold} S ${e.stone} W ${e.wood}`);
        }
    }

    private setBar(bar: Bar, hp: number, max: number) {
        const frac = Phaser.Math.Clamp(max > 0 ? hp / max : 0, 0, 1);
        bar.fill.scaleX = frac;
        bar.value.setText(String(Math.max(0, Math.round(hp))));
    }

    // Corner-anchor everything to the current viewport. Two top rows: row 1 is the resource
    // strip (left) + Dev/Fit buttons (right); row 2 is your Castle bar (left) + the enemy's
    // (right). The builder panels live below row 2 (see DevPanel/UnitPanel TOP), so nothing
    // collides on a narrow landscape phone.
    layout() {
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;

        // Peasant-allocation strip, centred along the top (between resources and the buttons).
        const groupW = 96;
        const labelW = 26;
        const panelW = labelW + groupW * RES_ORDER.length;
        const px = (w - panelW) / 2;
        const cy = 8 + 17;
        this.workBg.setPosition(px - 8, 8).setSize(panelW + 16, 34);
        this.workLabel.setPosition(px, cy);
        RES_ORDER.forEach((res, i) => {
            const gx = px + labelW + i * groupW;
            this.workIcons[i].setPosition(gx, cy);
            this.workCounts[res].setPosition(gx + 30, cy);
            this.workMinus[i].setPosition(gx + 52, cy);
            this.workPlus[i].setPosition(gx + 76, cy);
        });

        // Top-right buttons: Fit, then Dev to its left.
        this.fitBtn.setPosition(w - this.fitBtn.width - 10, 8);
        this.devBtn.setPosition(this.fitBtn.x - this.devBtn.width - 8, 8);

        // Castle bars on row 2: yours left, enemy right.
        this.placeBar(this.playerBar, 10);
        this.placeBar(this.enemyBar, w - 10 - BAR_W);

        // Debug line bottom-left (dev only).
        this.debug.setPosition(10, h - this.debug.height - 10).setVisible(this.devOnState);
    }

    private placeBar(bar: Bar, x: number) {
        bar.label.setPosition(x, 50);
        bar.bg.setPosition(x, 64);
        bar.fill.setPosition(x + 2, 66);
        bar.value.setPosition(x + BAR_W / 2, 64 + BAR_H / 2);
    }
}

function readDev(): boolean {
    try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; }
}
function writeDev(on: boolean) {
    try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
