import * as Phaser from 'phaser';
import { DraftOption, PerkCategory, chosenPerks } from '../progression/LevelUpgrades';

// Two screen-fixed overlays for the level-up perk system, both on the UI layer (uiCamera):
//   • LevelUpModal  — the "choose 1 of 3" draft shown (paused) on every level-up.
//   • UpgradesPanel — the review screen listing the perks the player has taken so far.
// Each is built fresh when opened and torn down on close, so there is no per-frame cost while
// hidden. They sit above the HUD (~1_000_000) and the win/lose overlay (~1_000_100).

const MODAL_DEPTH = 1_000_200;
const PANEL_DEPTH = 1_000_180;

// Per-category accent colour, so the cards/rows read at a glance.
const CAT_COLOR: Record<PerkCategory, number> = {
    Units: 0x2a6cd6,    // blue
    Economy: 0x2e9e4f,  // green
    Skills: 0x8a5cd6,   // purple
    Castle: 0xc79030,   // gold
};
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

// Lucky cards (×2 / ×3) get a gold/orange accent so they read as a jackpot.
const LUCK_COLOR: Record<number, number> = { 2: 0xffd24a, 3: 0xff9b3d };

// ---- The level-up draft modal: dim the field, present 3 perk cards, resume on pick. ----

export class LevelUpModal {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly onPick: (key: string, mult: number) => void;
    private objs: Phaser.GameObjects.GameObject[] = [];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, onPick: (key: string, mult: number) => void) {
        this.scene = scene;
        this.layer = layer;
        this.onPick = onPick;
    }

    get isOpen(): boolean {
        return this.objs.length > 0;
    }

    // Show the draft. `level` is the level just reached; `options` are the 3 (or fewer) choices,
    // each carrying its current level (0 = new) and a luck multiplier (1/2/3 levels granted).
    open(level: number, options: DraftOption[]) {
        this.close();
        const s = this.scene.scale;
        const cx = s.width / 2;
        const cy = s.height / 2;
        const lucky = options.some((o) => o.mult > 1);

        const dim = this.scene.add.rectangle(0, 0, s.width, s.height, 0x000000, 0.7)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(MODAL_DEPTH).setInteractive(); // swallow clicks
        this.add(dim);

        this.txt(cx, cy - 150, `LEVEL ${level}!`, {
            fontFamily: 'monospace', fontSize: '44px', color: '#ffe08a', fontStyle: 'bold',
        }, MODAL_DEPTH + 1).setOrigin(0.5);
        this.txt(cx, cy - 108, lucky ? '✨ Lucky draw! Choose an upgrade' : 'Choose an upgrade', {
            fontFamily: 'monospace', fontSize: '18px', color: lucky ? '#ffd24a' : '#cfe6ff',
        }, MODAL_DEPTH + 1).setOrigin(0.5);

        // Lay the cards out in a centred row, scaling the card width down if the screen is narrow.
        const n = options.length;
        const gap = 18;
        const maxRow = Math.min(s.width - 40, 660);
        const cardW = Math.min(200, Math.floor((maxRow - gap * (n - 1)) / Math.max(1, n)));
        const cardH = 210;
        const totalW = cardW * n + gap * (n - 1);
        let x = cx - totalW / 2;
        const top = cy - 70;

        for (const o of options) {
            this.buildCard(o, x, top, cardW, cardH);
            x += cardW + gap;
        }
    }

    private buildCard(o: DraftOption, x: number, y: number, w: number, h: number) {
        const { def, level: curLevel, mult } = o;
        const lucky = mult > 1;
        // Lucky cards take a gold/orange border (and a thicker one for ×3) to stand out.
        const accent = lucky ? LUCK_COLOR[mult] : CAT_COLOR[def.category];
        const card = this.scene.add.rectangle(x, y, w, h, 0x121a24, 0.98)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(MODAL_DEPTH + 1)
            .setStrokeStyle(lucky ? 3 : 2, accent).setInteractive({ useHandCursor: true });
        card.on('pointerover', () => card.setFillStyle(0x1b2738, 1));
        card.on('pointerout', () => card.setFillStyle(0x121a24, 0.98));
        card.on('pointerup', () => this.onPick(def.key, mult));
        this.add(card);

        const cxc = x + w / 2;
        // Category tag (top-left), big icon, name, level badge, then the resulting-level description.
        this.txt(x + 8, y + 12, def.category.toUpperCase(), {
            fontFamily: 'monospace', fontSize: '11px', color: hex(CAT_COLOR[def.category]), fontStyle: 'bold',
        }).setOrigin(0, 0);
        // Luck ribbon (top-right) — the jackpot multiplier.
        if (lucky) {
            this.txt(x + w - 8, y + 10, `✨ ×${mult}`, {
                fontFamily: 'monospace', fontSize: '15px', color: hex(accent), fontStyle: 'bold',
            }).setOrigin(1, 0);
        }
        this.txt(cxc, y + 50, def.icon, {
            fontFamily: 'monospace', fontSize: '40px', color: '#ffffff',
        }).setOrigin(0.5, 0);
        this.txt(cxc, y + 104, def.name, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', fontStyle: 'bold',
            align: 'center', wordWrap: { width: w - 16 },
        }).setOrigin(0.5, 0);

        const target = curLevel + mult;
        const badge = curLevel === 0
            ? (lucky ? `NEW → Lv ${target}` : 'NEW')
            : `Lv ${curLevel} → ${target}`;
        const badgeCol = lucky ? hex(accent) : (curLevel === 0 ? '#7be08a' : '#ffd24a');
        this.txt(cxc, y + 138, badge, {
            fontFamily: 'monospace', fontSize: '13px', color: badgeCol, fontStyle: 'bold',
        }).setOrigin(0.5, 0);

        this.txt(cxc, y + 162, def.desc(target), {
            fontFamily: 'monospace', fontSize: '12px', color: '#aebfcf',
            align: 'center', wordWrap: { width: w - 16 },
        }).setOrigin(0.5, 0);
    }

    close() {
        for (const o of this.objs) o.destroy();
        this.objs = [];
    }

    // Add a screen-fixed text to the modal layer (default depth above the cards) and track it.
    private txt(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle, depth = MODAL_DEPTH + 2): Phaser.GameObjects.Text {
        const t = this.scene.add.text(x, y, text, style).setScrollFactor(0).setDepth(depth);
        this.add(t);
        return t;
    }

    private add(o: Phaser.GameObjects.GameObject) {
        this.layer.add(o);
        this.objs.push(o);
    }
}

// ---- The review panel: a list of the perks the player has chosen, with their levels. ----

export class UpgradesPanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private objs: Phaser.GameObjects.GameObject[] = [];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        this.scene = scene;
        this.layer = layer;
    }

    get isOpen(): boolean {
        return this.objs.length > 0;
    }

    toggle(level: number) {
        if (this.isOpen) this.close();
        else this.open(level);
    }

    open(level: number) {
        this.close();
        const s = this.scene.scale;
        const cx = s.width / 2;
        const chosen = chosenPerks();

        const rowH = 40;
        const headH = 92;
        const panelW = Math.min(s.width - 40, 460);
        const panelH = Math.min(s.height - 40, headH + Math.max(1, chosen.length) * rowH + 16);
        const top = Math.max(20, (s.height - panelH) / 2);
        const left = cx - panelW / 2;

        // A light dim that closes the panel when tapped outside it.
        const dim = this.scene.add.rectangle(0, 0, s.width, s.height, 0x000000, 0.45)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH).setInteractive();
        dim.on('pointerup', () => this.close());
        this.add(dim);

        const panel = this.scene.add.rectangle(left, top, panelW, panelH, 0x0b1016, 0.98)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH + 1)
            .setStrokeStyle(2, 0x3a4350).setInteractive(); // swallow clicks on the panel itself
        this.add(panel);

        this.txt(left + 16, top + 14, '📜 YOUR UPGRADES', {
            fontFamily: 'monospace', fontSize: '20px', color: '#ffe08a', fontStyle: 'bold',
        });
        this.txt(left + 16, top + 44, `Level ${level}  ·  ${chosen.length} perk${chosen.length === 1 ? '' : 's'} chosen`, {
            fontFamily: 'monospace', fontSize: '13px', color: '#9fb3c8',
        });

        const close = this.txt(left + panelW - 14, top + 14, '✕', {
            fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', backgroundColor: '#5a3a3a', padding: { x: 8, y: 4 },
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        close.on('pointerup', () => this.close());

        if (chosen.length === 0) {
            this.txt(cx, top + headH + 10, 'No upgrades yet — level up to choose one.', {
                fontFamily: 'monospace', fontSize: '13px', color: '#7f93a8',
            }).setOrigin(0.5, 0);
            return;
        }

        let y = top + headH;
        for (const { def, level: lv } of chosen) {
            const accent = CAT_COLOR[def.category];
            this.txt(left + 16, y + rowH / 2, `${def.icon}`, {
                fontFamily: 'monospace', fontSize: '20px', color: '#ffffff',
            }).setOrigin(0, 0.5);
            this.txt(left + 52, y + 6, def.name, {
                fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
            });
            this.txt(left + 52, y + 23, def.desc(lv), {
                fontFamily: 'monospace', fontSize: '11px', color: '#aebfcf',
            });
            this.txt(left + panelW - 14, y + rowH / 2, `Lv ${lv}/${def.max}`, {
                fontFamily: 'monospace', fontSize: '13px', color: hex(accent), fontStyle: 'bold',
            }).setOrigin(1, 0.5);
            y += rowH;
        }
    }

    close() {
        for (const o of this.objs) o.destroy();
        this.objs = [];
    }

    // Add a screen-fixed text to the panel layer and track it for teardown.
    private txt(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle, depth = PANEL_DEPTH + 2): Phaser.GameObjects.Text {
        const t = this.scene.add.text(x, y, text, style).setScrollFactor(0).setDepth(depth);
        this.add(t);
        return t;
    }

    private add(o: Phaser.GameObjects.GameObject) {
        this.layer.add(o);
        this.objs.push(o);
    }
}
