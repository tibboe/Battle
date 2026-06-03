import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { resetSettings, saveSettings } from '../settings';

// A lightweight on-screen DEV tuning panel for finding the feel on the phone without
// rebuilding. It edits the same CONFIG numbers you'd otherwise change in config.ts.
//
//   • "live" settings (spawn rate, skill params) are read by the systems every frame / on the
//     next use, so they take effect instantly.
//   • "structural" settings (army size, map width, water edge, forest, clouds) change how the
//     world is built, so the panel restarts the battle to apply them. CONFIG is the single
//     source of truth, so the new values survive the restart.
//
// Tunables are grouped into collapsible SECTIONS (Combat, Skills, Environment, …) so the panel
// stays compact — tap a section header to expand the controls you care about. Purely a
// builder/test tool, not a game menu. Lives on the UI layer (fixed to the screen).

// Open/closed state persists across scene restarts (a restart rebuilds the panel).
let panelOpen = false;
const sectionOpen: Record<string, boolean> = {}; // collapsed by default; remembers per section

interface Setting {
    section: string;
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

interface Row {
    setting: Setting;
    label: Phaser.GameObjects.Text;
    value: Phaser.GameObjects.Text;
    minus: Phaser.GameObjects.Text;
    plus: Phaser.GameObjects.Text;
}

const PANEL_DEPTH = 1_000_001; // above the rest of the HUD
const X = 12;
const TOP = 92;   // below the HUD's resource strip + Castle health bar (left column)
const ROW_H = 26;
const WIDTH = 250;

export class DevPanel {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly restart: () => void;

    private readonly settings: Setting[];
    private readonly sections: string[] = [];
    private readonly headers = new Map<string, Phaser.GameObjects.Text>();
    private readonly rows: Row[] = [];
    private readonly footer: Phaser.GameObjects.Text[] = [];
    private bg!: Phaser.GameObjects.Rectangle;
    private toggle!: Phaser.GameObjects.Text;
    private visible = true; // master visibility (the HUD's Dev toggle hides the whole panel)

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, restart: () => void) {
        this.scene = scene;
        this.layer = layer;
        this.restart = restart;

        const av = CONFIG.abilities.arrowVolley;
        // The tunables exposed, grouped by section. Structural ones (live:false) rebuild on restart.
        this.settings = [
            { section: 'Production', label: 'Spawn secs', get: () => CONFIG.production.spawnSeconds, set: (v) => (CONFIG.production.spawnSeconds = v), step: 1, min: 1, max: 30, live: true, fmt: (v) => `${v}s` },

            { section: 'Combat', label: 'Atk interval', get: () => CONFIG.combat.attackIntervalScale, set: (v) => (CONFIG.combat.attackIntervalScale = v), step: 0.25, min: 0.5, max: 4, live: true, fmt: (v) => `${v}×` },
            { section: 'Combat', label: 'Unit HP', get: () => CONFIG.combat.hpScale, set: (v) => (CONFIG.combat.hpScale = v), step: 0.5, min: 0.5, max: 5, live: true, fmt: (v) => `${v}×` },

            { section: 'Armies', label: 'Your army', get: () => CONFIG.spawn.unitsTarget.player, set: (v) => (CONFIG.spawn.unitsTarget.player = v), step: 5, min: 5, max: 300, live: false },
            { section: 'Armies', label: 'Enemy army', get: () => CONFIG.spawn.unitsTarget.enemy, set: (v) => (CONFIG.spawn.unitsTarget.enemy = v), step: 5, min: 5, max: 300, live: false },

            { section: 'Skills', label: 'Volley arrows', get: () => av.arrows, set: (v) => (av.arrows = v), step: 5, min: 5, max: 200, live: true },
            { section: 'Skills', label: 'Volley dmg', get: () => av.damage, set: (v) => (av.damage = v), step: 1, min: 1, max: 100, live: true },
            { section: 'Skills', label: 'Volley radius', get: () => av.radius, set: (v) => (av.radius = v), step: 20, min: 40, max: 600, live: true, fmt: (v) => `${v}px` },
            { section: 'Skills', label: 'Volley hit r', get: () => av.hitRadius, set: (v) => (av.hitRadius = v), step: 5, min: 5, max: 120, live: true, fmt: (v) => `${v}px` },
            { section: 'Skills', label: 'Volley rain', get: () => av.duration, set: (v) => (av.duration = v), step: 200, min: 0, max: 5000, live: true, fmt: (v) => `${v}ms` },
            { section: 'Skills', label: 'Volley cd', get: () => av.cooldown, set: (v) => (av.cooldown = v), step: 1000, min: 0, max: 30000, live: true, fmt: (v) => `${v / 1000}s` },

            { section: 'Battlefield', label: 'Lane width', get: () => CONFIG.lanes[0].pathWidth, set: (v) => (CONFIG.lanes[0].pathWidth = v), step: 20, min: 40, max: 600, live: true },
            { section: 'Battlefield', label: 'Map width', get: () => CONFIG.world.width, set: (v) => (CONFIG.world.width = v), step: 500, min: 2000, max: 8000, live: false },
            { section: 'Battlefield', label: 'Water edge', get: () => CONFIG.island.margin, set: (v) => (CONFIG.island.margin = v), step: 32, min: 64, max: 640, live: false },

            { section: 'Environment', label: 'Forest', get: () => CONFIG.decorations.forest, set: (v) => (CONFIG.decorations.forest = v), step: 4, min: 0, max: 120, live: false },
            { section: 'Environment', label: 'Clouds', get: () => CONFIG.clouds.count, set: (v) => (CONFIG.clouds.count = v), step: 2, min: 0, max: 30, live: false },

            { section: 'Debug', label: 'Dmg numbers', get: () => (CONFIG.debug.damageNumbers ? 1 : 0), set: (v) => (CONFIG.debug.damageNumbers = v > 0), step: 1, min: 0, max: 1, live: true, bool: true, fmt: (v) => (v ? 'ON' : 'OFF') },
        ];

        // Unique section list, in first-appearance order.
        for (const s of this.settings) if (!this.sections.includes(s.section)) this.sections.push(s.section);

        this.build();
    }

    private build() {
        // Panel background (sized/positioned in relayout once everything exists).
        this.bg = this.scene.add.rectangle(X, TOP + 24, WIDTH, 10, 0x000000, 0.55)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(PANEL_DEPTH);
        this.layer.add(this.bg);

        // Master toggle header.
        this.toggle = this.mkButton('⚙ Dev', X, TOP, () => this.setOpen(!panelOpen));
        this.toggle.setBackgroundColor('#333a44');

        // One collapsible header per section + the rows beneath it.
        for (const sec of this.sections) {
            const header = this.mkButton(sec, X, 0, () => {
                sectionOpen[sec] = !(sectionOpen[sec] ?? false);
                this.relayout();
            });
            header.setBackgroundColor('#26303c');
            this.headers.set(sec, header);

            for (const setting of this.settings) {
                if (setting.section !== sec) continue;
                const label = this.scene.add.text(0, 0, setting.label, { fontFamily: 'monospace', fontSize: '15px', color: '#cfe6ff' })
                    .setScrollFactor(0).setDepth(PANEL_DEPTH);
                const value = this.scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' })
                    .setScrollFactor(0).setDepth(PANEL_DEPTH);
                const minus = this.mkButton('−', 0, 0, () => this.bump(setting, -1));
                const plus = this.mkButton('+', 0, 0, () => this.bump(setting, +1));
                this.layer.add([label, value]);
                this.rows.push({ setting, label, value, minus, plus });
            }
        }

        // Restart + Reset footer.
        const restartBtn = this.mkButton('↻ Restart', 0, 0, () => this.restart());
        restartBtn.setBackgroundColor('#2a6cd6');
        const resetBtn = this.mkButton('⊘ Reset saved', 0, 0, () => {
            resetSettings();
            window.location.reload(); // back to config.ts defaults
        });
        resetBtn.setBackgroundColor('#6a3a3a');
        this.footer.push(restartBtn, resetBtn);

        this.refresh();
        this.relayout();
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

    private bump(s: Setting, dir: number) {
        if (s.bool) {
            s.set(s.get() > 0 ? 0 : 1); // either −/+ flips an ON/OFF toggle
            saveSettings();
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
        saveSettings();
        if (s.live) {
            this.refresh();
        } else {
            this.restart(); // structural change — rebuild the battle from the new value
        }
    }

    private refresh() {
        for (const r of this.rows) {
            const v = r.setting.get();
            r.value.setText(r.setting.fmt ? r.setting.fmt(v) : String(v));
        }
    }

    // Position headers/rows/footer top-to-bottom, skipping the rows of collapsed sections, and
    // size the background to wrap whatever is showing. Drives all visibility too.
    private relayout() {
        const show = this.visible && panelOpen;
        let y = TOP + 30;

        for (const sec of this.sections) {
            const open = sectionOpen[sec] ?? false;
            const header = this.headers.get(sec)!;
            header.setText(`${open ? '▾' : '▸'} ${sec}`).setPosition(X + 10, y).setVisible(show);
            if (show) y += ROW_H;

            for (const r of this.rows) {
                if (r.setting.section !== sec) continue;
                const vis = show && open;
                r.label.setPosition(X + 20, y).setVisible(vis);
                r.value.setPosition(X + 128, y).setVisible(vis);
                r.minus.setPosition(X + 188, y - 3).setVisible(vis);
                r.plus.setPosition(X + 218, y - 3).setVisible(vis);
                if (vis) y += ROW_H;
            }
        }

        this.footer[0].setPosition(X + 10, y).setVisible(show);
        this.footer[1].setPosition(X + 110, y).setVisible(show);
        if (show) y += ROW_H;

        this.bg.setPosition(X, TOP + 24).setSize(WIDTH, y - (TOP + 24) + 6).setVisible(show);
        this.toggle.setText(panelOpen ? '⚙ Dev ▾' : '⚙ Dev ▸').setVisible(this.visible);
    }

    private setOpen(open: boolean) {
        panelOpen = open;
        this.relayout();
    }

    // Master show/hide, driven by the HUD's Dev toggle (the panel keeps its open/closed state).
    setVisible(v: boolean) {
        this.visible = v;
        this.relayout();
    }
}
