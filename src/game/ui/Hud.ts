import * as Phaser from 'phaser';
import { CONFIG, ResourceType, RESOURCE_TYPES } from '../config';
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
    food: `${ASSET}/Resources/Meat/Meat Resource/Meat Resource.png`,
};
const iconKey = (k: string) => `hud-icon-${k}`;

// Bar geometry.
const BAR_W = 188;
const BAR_H = 18;
const ICON_PX = 20;
const CHIP_W = 64;  // per-resource chip: icon + stockpile count over a worker badge (tap to focus)

const youCol = '#' + CONFIG.faction.player.tint.toString(16).padStart(6, '0');
const foeCol = '#' + CONFIG.faction.enemy.tint.toString(16).padStart(6, '0');

export interface HudData {
    fps: number;
    units: number;
    player: ResourceBag;
    enemy: ResourceBag;
    playerHp: number;
    enemyHp: number;
    playerMaxHp: number;     // your Castle's max (grows with the Fortify perk)
    enemyMaxHp: number;
    playerLevel: number;     // current player level (1+)
    playerXp: number;        // XP banked toward the next level
    playerXpForLevel: number; // XP required to leave the current level
    workers: Record<ResourceType, number>; // player's live worker count per resource
    focus: ResourceType[];                 // the FIFO focus queue (next assignments)
    // Enemy reinforcement countdown: seconds until the next timed arrival + how many have landed.
    reinforcement: { enabled: boolean; seconds: number; wave: number };
}

const xpCol = '#ffd24a'; // experience bar — gold

const RES_ORDER = RESOURCE_TYPES;
const RES_LETTER: Record<ResourceType, string> = { gold: 'G', stone: 'S', wood: 'W', food: 'F' };

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
    private readonly onFocus: (res: ResourceType) => void;
    private readonly onFocusClear: () => void;

    private resBg!: Phaser.GameObjects.Rectangle;
    // One combined top strip: per resource a tappable CHIP showing the stockpile count AND the
    // live worker count, tap to push that resource onto the gather FIFO. A queue line + clear
    // button follow. (Resource readout and peasant focus are now the same control.)
    private readonly counts: Record<string, Phaser.GameObjects.Text> = {};      // stockpile
    private readonly workCounts: Record<string, Phaser.GameObjects.Text> = {};  // worker badge
    private readonly focusBtns: Phaser.GameObjects.Rectangle[] = [];
    private readonly workIcons: Phaser.GameObjects.Image[] = [];
    private queueText!: Phaser.GameObjects.Text;
    private clearBtn!: Phaser.GameObjects.Text;
    private playerBar!: Bar;
    private enemyBar!: Bar;
    private xpBar!: Bar;
    private reinforceText!: Phaser.GameObjects.Text; // enemy reinforcement countdown (under the enemy bar)
    private fitBtn!: Phaser.GameObjects.Text;
    private devBtn!: Phaser.GameObjects.Text;
    private levelsBtn!: Phaser.GameObjects.Text;
    private debug!: Phaser.GameObjects.Text;

    private devOnState: boolean;

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        onFit: () => void,
        onDev: (on: boolean) => void,
        onFocus: (res: ResourceType) => void,
        onFocusClear: () => void,
        onLevels: () => void,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.onDev = onDev;
        this.onFocus = onFocus;
        this.onFocusClear = onFocusClear;
        this.devOnState = readDev();

        this.buildStrip();
        this.playerBar = this.buildBar('YOUR CASTLE', youCol);
        this.enemyBar = this.buildBar('ENEMY CASTLE', foeCol);
        this.xpBar = this.buildBar('LEVEL 1', xpCol);

        // Enemy reinforcement countdown, tucked under the enemy Castle bar (top-right, right-aligned).
        // Black text on a light pill so it stays legible over any terrain colour.
        this.reinforceText = scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '12px', color: '#000000', fontStyle: 'bold',
            backgroundColor: '#e8eef2cc', padding: { x: 6, y: 3 },
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH + 1);
        this.layer.add(this.reinforceText);

        this.fitBtn = this.mkButton('⤢ Fit', onFit);
        this.devBtn = this.mkButton('🛠 Dev', () => this.setDev(!this.devOnState));
        this.levelsBtn = this.mkButton('📜 Perks', onLevels);

        this.debug = scene.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '13px', color: '#9fb3c8',
            backgroundColor: '#00000066', padding: { x: 6, y: 4 },
        }).setScrollFactor(0).setDepth(DEPTH);
        layer.add(this.debug);

        this.styleDevBtn();
        this.layout();
    }

    // One strip: a tappable chip per resource (icon + stockpile count + worker badge) that pushes
    // the resource onto the gather FIFO, then the pending queue + a clear button. Positioned in
    // layout().
    private buildStrip() {
        this.resBg = this.scene.add.rectangle(8, 8, 100, 40, 0x000000, 0.55)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH).setStrokeStyle(1, 0xffffff, 0.12);
        this.layer.add(this.resBg);

        RES_ORDER.forEach((res) => {
            const chip = this.scene.add.rectangle(0, 0, CHIP_W, 34, 0x182434, 0.9)
                .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH).setStrokeStyle(1, 0x2a3543)
                .setInteractive({ useHandCursor: true });
            chip.on('pointerup', () => this.onFocus(res));
            const icon = this.scene.add.image(0, 0, iconKey(res))
                .setOrigin(0, 0.5).setDisplaySize(ICON_PX, ICON_PX).setScrollFactor(0).setDepth(DEPTH + 1);
            const count = this.scene.add.text(0, 0, '0', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' })
                .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            const work = this.scene.add.text(0, 0, '👷0', { fontFamily: 'monospace', fontSize: '10px', color: '#9fd0ff' })
                .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            this.layer.add([chip, icon, count, work]);
            this.focusBtns.push(chip);
            this.workIcons.push(icon);
            this.counts[res] = count;
            this.workCounts[res] = work;
        });

        this.queueText = this.scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#cfe6ff' })
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(DEPTH + 1);
        this.clearBtn = this.scene.add.text(0, 0, '✕', {
            fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: '#5a3a3a', padding: { x: 6, y: 3 },
        }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
        this.clearBtn.on('pointerup', () => this.onFocusClear());
        this.layer.add([this.queueText, this.clearBtn]);
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
        for (const res of RES_ORDER) {
            this.counts[res].setText(String(d.player[res]));
            this.workCounts[res].setText('👷' + d.workers[res]);
        }
        // Pending focus queue as a short letter run, e.g. "→ G G W" (capped).
        const q = d.focus;
        if (!q.length) {
            this.queueText.setText('→ auto');
        } else {
            const shown = q.slice(0, 10).map((r) => RES_LETTER[r]).join(' ');
            this.queueText.setText('→ ' + shown + (q.length > 10 ? ` +${q.length - 10}` : ''));
        }

        this.setBar(this.playerBar, d.playerHp, d.playerMaxHp);
        this.setBar(this.enemyBar, d.enemyHp, d.enemyMaxHp);

        // Reinforcement countdown (hidden when the feature is off). Shows time to the next arrival
        // and how many waves have landed so far.
        const r = d.reinforcement;
        this.reinforceText.setVisible(r.enabled);
        if (r.enabled) {
            const t = Math.ceil(r.seconds);
            const mm = Math.floor(t / 60);
            const ss = String(t % 60).padStart(2, '0');
            this.reinforceText.setText(`⚔ Reinforcements ${mm}:${ss}` + (r.wave > 0 ? `  (wave ${r.wave})` : ''));
        }

        // XP bar: level on the label, XP/next as the value, fill = progress through the level.
        this.xpBar.fill.scaleX = Phaser.Math.Clamp(d.playerXpForLevel > 0 ? d.playerXp / d.playerXpForLevel : 0, 0, 1);
        this.xpBar.label.setText('LEVEL ' + d.playerLevel);
        this.xpBar.value.setText(`${Math.floor(d.playerXp)} / ${d.playerXpForLevel}`);

        if (this.devOnState) {
            const e = d.enemy;
            this.debug.setText(`FPS ${d.fps}  Units ${d.units}    Enemy  G ${e.gold} S ${e.stone} W ${e.wood} F ${e.food}`);
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

        // Combined resource+focus strip, anchored top-left. Each chip: icon, stockpile count
        // (top), worker badge (below); tap to focus. Then the queue line + clear button.
        const cy = 8 + 20;
        const gap = 4;
        const queueW = 88;
        let bx = 12;
        RES_ORDER.forEach((res, i) => {
            this.focusBtns[i].setPosition(bx, cy);
            this.workIcons[i].setPosition(bx + 6, cy);
            this.counts[res].setPosition(bx + 6 + ICON_PX + 4, cy - 7);
            this.workCounts[res].setPosition(bx + 6 + ICON_PX + 4, cy + 8);
            bx += CHIP_W + gap;
        });
        this.queueText.setPosition(bx + 4, cy);
        this.clearBtn.setPosition(bx + 4 + queueW + 4, cy);
        const endX = bx + 4 + queueW + 4 + 14;
        this.resBg.setPosition(8, 8).setSize(endX - 8, 40);

        // Top-right buttons: Fit, then Dev, then Perks to their left.
        this.fitBtn.setPosition(w - this.fitBtn.width - 10, 8);
        this.devBtn.setPosition(this.fitBtn.x - this.devBtn.width - 8, 8);
        this.levelsBtn.setPosition(this.devBtn.x - this.levelsBtn.width - 8, 8);

        // Castle bars on row 2: yours left, enemy right.
        this.placeBar(this.playerBar, 10, 50);
        this.placeBar(this.enemyBar, w - 10 - BAR_W, 50);

        // Reinforcement countdown sits just under the enemy Castle bar, right-aligned to it.
        this.reinforceText.setPosition(w - 10, 50 + 14 + BAR_H + 4);

        // XP/level bar: a full-width strip flush against the very bottom of the screen. The
        // command/selection bars (also bottom-pinned) cover it only while you're commanding.
        this.placeXpBar(w, h);

        // Debug line bottom-left (dev only). Sits just above the XP strip.
        this.debug.setPosition(10, h - BAR_H - this.debug.height - 8).setVisible(this.devOnState);
    }

    // Stretch the XP bar across the full width at the bottom edge: level on the left, xp/next
    // centred. The fill keeps its scaleX (set in update) so it still grows from the left.
    private placeXpBar(w: number, h: number) {
        const top = h - BAR_H;
        this.xpBar.bg.setPosition(0, top).setSize(w, BAR_H);
        this.xpBar.fill.setPosition(2, top + 2).setSize(w - 4, BAR_H - 4);
        this.xpBar.label.setOrigin(0, 0.5).setPosition(10, top + BAR_H / 2);
        this.xpBar.value.setPosition(w / 2, top + BAR_H / 2);
    }

    private placeBar(bar: Bar, x: number, topY: number) {
        bar.label.setPosition(x, topY);
        bar.bg.setPosition(x, topY + 14);
        bar.fill.setPosition(x + 2, topY + 16);
        bar.value.setPosition(x + BAR_W / 2, topY + 14 + BAR_H / 2);
    }
}

function readDev(): boolean {
    try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; }
}
function writeDev(on: boolean) {
    try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
