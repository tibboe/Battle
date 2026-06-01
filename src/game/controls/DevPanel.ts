import * as Phaser from 'phaser';
import { CONFIG } from '../config';

// A lightweight on-screen DEV tuning panel for finding the feel on the phone without
// rebuilding. It edits the same CONFIG numbers you'd otherwise change in config.ts.
//
//   • "live" settings (spawn rate) are read by the systems every frame, so they take
//     effect instantly.
//   • "structural" settings (army size, map width, water edge, forest, clouds) change how
//     the world is built, so the panel restarts the battle to apply them. CONFIG is the
//     single source of truth, so the new values survive the restart.
//
// Purely a builder/test tool — not a game menu. Lives on the UI layer (fixed to the
// screen, ignored by world zoom/pan), drawn from plain Phaser text + rectangles.

// Open/closed state persists across scene restarts (a restart rebuilds the panel).
let panelOpen = false;

interface Setting {
    label: string;
    get: () => number;
    set: (v: number) => void;
    step: number;
    min: number;
    max: number;
    live: boolean; // true = applies instantly; false = needs a battle restart
    bool?: boolean; // render as an ON/OFF toggle (either −/+ flips it)
    fmt?: (v: number) => string;
}

const PANEL_DEPTH = 1_000_001; // above the rest of the HUD

export class DevPanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly restart: () => void;

    private readonly settings: Setting[];
    private readonly valueTexts: Phaser.GameObjects.Text[] = [];
    private readonly rowObjects: Phaser.GameObjects.Text[] = [];
    private bg!: Phaser.GameObjects.Rectangle;
    private toggle!: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, restart: () => void) {
        this.scene = scene;
        this.layer = layer;
        this.restart = restart;

        // The tunables exposed. Structural ones (live:false) rebuild on restart.
        this.settings = [
            { label: 'Prod rate', get: () => CONFIG.production.rateScale, set: (v) => (CONFIG.production.rateScale = v), step: 0.25, min: 0.25, max: 4, live: true, fmt: (v) => `${v}×` },
            { label: 'Your army', get: () => CONFIG.spawn.unitsTarget.player, set: (v) => (CONFIG.spawn.unitsTarget.player = v), step: 5, min: 5, max: 300, live: false },
            { label: 'Enemy army', get: () => CONFIG.spawn.unitsTarget.enemy, set: (v) => (CONFIG.spawn.unitsTarget.enemy = v), step: 5, min: 5, max: 300, live: false },
            { label: 'Map width', get: () => CONFIG.world.width, set: (v) => (CONFIG.world.width = v), step: 500, min: 2000, max: 8000, live: false },
            { label: 'Water edge', get: () => CONFIG.island.margin, set: (v) => (CONFIG.island.margin = v), step: 32, min: 64, max: 640, live: false },
            { label: 'Forest', get: () => CONFIG.decorations.forest, set: (v) => (CONFIG.decorations.forest = v), step: 4, min: 0, max: 120, live: false },
            { label: 'Clouds', get: () => CONFIG.clouds.count, set: (v) => (CONFIG.clouds.count = v), step: 2, min: 0, max: 30, live: false },
            { label: 'Dmg numbers', get: () => (CONFIG.debug.damageNumbers ? 1 : 0), set: (v) => (CONFIG.debug.damageNumbers = v > 0), step: 1, min: 0, max: 1, live: true, bool: true, fmt: (v) => (v ? 'ON' : 'OFF') },
        ];

        this.build();
    }

    private build() {
        const x = 12;
        const top = 46; // just below the FPS readout
        const rowH = 26;
        const width = 250;

        // Panel background (only visible when open).
        this.bg = this.scene.add
            .rectangle(x, top + 24, width, this.settings.length * rowH + 36, 0x000000, 0.55)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(PANEL_DEPTH);
        this.layer.add(this.bg);

        // Toggle header.
        this.toggle = this.mkButton('⚙ Dev', x, top, () => this.setOpen(!panelOpen));
        this.toggle.setBackgroundColor('#333a44');

        // One row per setting: label+value on the left, − / + on the right.
        this.settings.forEach((s, i) => {
            const ry = top + 30 + i * rowH;
            const label = this.scene.add
                .text(x + 10, ry, s.label, { fontFamily: 'monospace', fontSize: '15px', color: '#cfe6ff' })
                .setScrollFactor(0)
                .setDepth(PANEL_DEPTH);
            const value = this.scene.add
                .text(x + 118, ry, '', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' })
                .setScrollFactor(0)
                .setDepth(PANEL_DEPTH);
            const minus = this.mkButton('−', x + 188, ry - 3, () => this.bump(i, -1));
            const plus = this.mkButton('+', x + 218, ry - 3, () => this.bump(i, +1));

            this.valueTexts.push(value);
            this.rowObjects.push(label, value, minus, plus);
            this.layer.add([label, value, minus, plus]);
        });

        // Restart row at the bottom.
        const restartY = top + 30 + this.settings.length * rowH;
        const restartBtn = this.mkButton('↻ Restart battle', x + 10, restartY, () => this.restart());
        restartBtn.setBackgroundColor('#2a6cd6');
        this.rowObjects.push(restartBtn);
        this.layer.add(restartBtn);

        this.refresh();
        this.setOpen(panelOpen);
    }

    private mkButton(text: string, x: number, y: number, onTap: () => void) {
        const btn = this.scene.add
            .text(x, y, text, {
                fontFamily: 'monospace',
                fontSize: '15px',
                color: '#ffffff',
                backgroundColor: '#3a4350',
                padding: { x: 7, y: 4 },
            })
            .setScrollFactor(0)
            .setDepth(PANEL_DEPTH)
            .setInteractive({ useHandCursor: true });
        btn.on('pointerup', onTap);
        this.layer.add(btn);
        return btn;
    }

    private bump(i: number, dir: number) {
        const s = this.settings[i];
        if (s.bool) {
            s.set(s.get() > 0 ? 0 : 1); // either −/+ flips an ON/OFF toggle
            this.refresh();
            return;
        }
        const next = Phaser.Math.Clamp(
            Math.round((s.get() + dir * s.step) * 100) / 100,
            s.min,
            s.max,
        );
        if (next === s.get()) return;
        s.set(next);
        if (s.live) {
            this.refresh();
        } else {
            this.restart(); // structural change — rebuild the battle from the new value
        }
    }

    private refresh() {
        this.settings.forEach((s, i) => {
            const v = s.get();
            this.valueTexts[i].setText(s.fmt ? s.fmt(v) : String(v));
        });
    }

    private setOpen(open: boolean) {
        panelOpen = open;
        this.toggle.setText(open ? '⚙ Dev ▾' : '⚙ Dev ▸');
        this.bg.setVisible(open);
        for (const o of this.rowObjects) o.setVisible(open);
    }
}
