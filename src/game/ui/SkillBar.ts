import * as Phaser from 'phaser';

// The player's skills dock — a vertical stack of skill buttons on the LEFT edge of the screen
// (clear of the top resource HUD and the bottom selection bar). Tapping a ready skill puts the
// game into "targeting" mode (the caller then waits for the next field tap to cast); the button
// shows a cooldown sweep + countdown while the skill recharges, and lights up while it is the
// armed/targeting skill. Screen-fixed on the UI layer.

const DEPTH = 1_000_020; // above the selection bar (1_000_010) so it stays tappable over it
const BTN = 64;
const GAP = 12;
const MARGIN = 16;

// One skill the dock can show. (Just the Arrow Volley for now; add rows here as skills grow.)
interface SkillDef {
    key: string;
    icon: string;
    label: string;
}

const SKILLS: SkillDef[] = [
    { key: 'arrowVolley', icon: '🏹', label: 'Volley' },
    { key: 'mercenaries', icon: '💰', label: 'Mercs' },
];

// Per-skill live state the scene feeds in each frame.
export interface SkillState {
    ready: boolean;
    frac: number;     // 0 (just cast) … 1 (ready) — cooldown sweep
    seconds: number;  // whole seconds left on cooldown (shown while recharging)
}

interface Row {
    def: SkillDef;
    box: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Text;
    label: Phaser.GameObjects.Text;
    cdOverlay: Phaser.GameObjects.Rectangle; // dark sweep from the top while cooling down
    cdText: Phaser.GameObjects.Text;
}

export class SkillBar {
    private readonly scene: Phaser.Scene;
    private readonly onSelect: (key: string) => void;
    private readonly rows: Row[] = [];
    private armed?: string; // the skill currently in targeting mode (highlighted)
    // Skills start LOCKED and only appear once unlocked via the level-up draft. The dock shows
    // (and lays out) just the unlocked rows, so it's empty at the start of a match.
    private readonly unlocked = new Set<string>();

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, onSelect: (key: string) => void) {
        this.scene = scene;
        this.onSelect = onSelect;

        for (const def of SKILLS) {
            const box = scene.add.rectangle(0, 0, BTN, BTN, 0x121a24, 0.96)
                .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0x3a4350).setDepth(DEPTH)
                .setInteractive({ useHandCursor: true });
            box.on('pointerup', () => this.onSelect(def.key));
            const icon = scene.add.text(0, 0, def.icon, { fontFamily: 'monospace', fontSize: '26px', color: '#e8f1ff' })
                .setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            const label = scene.add.text(0, 0, def.label, { fontFamily: 'monospace', fontSize: '10px', color: '#9fb3c8' })
                .setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            // Cooldown sweep: a dark panel filling the button from the top, shrinking as it recharges.
            const cdOverlay = scene.add.rectangle(0, 0, BTN, BTN, 0x000000, 0.6)
                .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH + 2).setVisible(false);
            const cdText = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
                .setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 3).setVisible(false);
            layer.add([box, icon, label, cdOverlay, cdText]);
            this.rows.push({ def, box, icon, label, cdOverlay, cdText });
        }

        this.layout();
    }

    // Which skill (if any) is armed/targeting — drives the highlight.
    setArmed(key?: string) {
        this.armed = key;
    }

    // Set which skills are unlocked (drafted via level-up). Locked skills are hidden entirely;
    // unlocked ones are re-laid-out so the dock packs from the top with no gaps.
    setUnlocked(keys: string[]) {
        this.unlocked.clear();
        for (const k of keys) this.unlocked.add(k);
        this.layout();
    }

    // Feed live cooldown state per skill key each frame.
    update(states: Record<string, SkillState>) {
        for (const r of this.rows) {
            if (!this.unlocked.has(r.def.key)) { this.hideRow(r); continue; } // locked → not shown
            const s = states[r.def.key];
            if (!s) continue;
            const armed = this.armed === r.def.key;
            r.box.setStrokeStyle(2, armed ? 0xffe08a : s.ready ? 0x2a6cd6 : 0x3a4350);
            r.icon.setAlpha(s.ready ? 1 : 0.5);
            r.label.setAlpha(s.ready ? 1 : 0.5);

            if (s.ready) {
                r.cdOverlay.setVisible(false);
                r.cdText.setVisible(false);
            } else {
                const h = BTN * (1 - Phaser.Math.Clamp(s.frac, 0, 1));
                r.cdOverlay.setSize(BTN, h).setVisible(true);
                // Keep the (origin-based) hit area unused; the box underneath still handles taps.
                r.cdText.setText(String(s.seconds)).setVisible(true);
            }
        }
    }

    layout() {
        // Only unlocked skills take up space — the dock packs them from the (vertically centred) top.
        const shown = this.rows.filter((r) => this.unlocked.has(r.def.key));
        const H = this.scene.scale.height;
        const total = shown.length * BTN + Math.max(0, shown.length - 1) * GAP;
        let y = Math.max(MARGIN, (H - total) / 2);
        for (const r of this.rows) {
            if (!this.unlocked.has(r.def.key)) { this.hideRow(r); continue; }
            const x = MARGIN;
            r.box.setPosition(x, y).setVisible(true);
            r.icon.setPosition(x + BTN / 2, y + BTN / 2 - 7).setVisible(true);
            r.label.setPosition(x + BTN / 2, y + BTN - 11).setVisible(true);
            r.cdOverlay.setPosition(x, y);
            r.cdText.setPosition(x + BTN / 2, y + BTN / 2);
            y += BTN + GAP;
        }
    }

    // Hide every part of a row (a locked or dev-hidden skill).
    private hideRow(r: Row) {
        r.box.setVisible(false);
        r.icon.setVisible(false);
        r.label.setVisible(false);
        r.cdOverlay.setVisible(false);
        r.cdText.setVisible(false);
    }

    setVisible(v: boolean) {
        if (v) { this.layout(); return; } // re-show only the unlocked rows
        for (const r of this.rows) this.hideRow(r);
    }
}
