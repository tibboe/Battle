import * as Phaser from 'phaser';

// Two arrow buttons that turn the whole battlefield 90° per tap — ↺ anticlockwise, ↻
// clockwise. Tapping calls back into the CameraController, which does the smooth spin.
// Sits on the LEFT edge, just below the skill dock (SkillBar), so all the left-side
// controls read as one column. Screen-fixed on the UI layer (like every other HUD bit).

const DEPTH = 1_000_020; // same band as the skill dock (they never overlap spatially)
const BTN = 44;
const GAP = 10;
const MARGIN = 16;

// Mirrors SkillBar's metrics so we can sit directly under its (vertically centred) stack.
const SKILL_BTN = 64;
const SKILL_GAP = 12;
const SKILL_COUNT = 2;
const SKILL_MARGIN = 16;

interface Arrow {
    box: Phaser.GameObjects.Rectangle;
    glyph: Phaser.GameObjects.Text;
}

export class RotationHud {
    private readonly scene: Phaser.Scene;
    private readonly arrows: Arrow[] = [];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, onRotate: (dir: 1 | -1) => void) {
        this.scene = scene;

        // Left arrow rotates anticlockwise (-1), right arrow clockwise (+1).
        for (const [icon, dir] of [['↺', -1], ['↻', 1]] as [string, 1 | -1][]) {
            const box = scene.add.rectangle(0, 0, BTN, BTN, 0x121a24, 0.96)
                .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0x3a4350).setDepth(DEPTH)
                .setInteractive({ useHandCursor: true });
            box.on('pointerup', () => onRotate(dir));
            const glyph = scene.add.text(0, 0, icon, { fontFamily: 'monospace', fontSize: '24px', color: '#e8f1ff' })
                .setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1);
            layer.add([box, glyph]);
            this.arrows.push({ box, glyph });
        }

        this.layout();
    }

    layout() {
        const H = this.scene.scale.height;
        // Find the bottom of the (vertically centred) skill dock and sit just under it.
        const skillStackH = SKILL_COUNT * SKILL_BTN + (SKILL_COUNT - 1) * SKILL_GAP;
        const skillBottom = Math.max(SKILL_MARGIN, (H - skillStackH) / 2) + skillStackH;
        // Two arrows side by side; never let them slide off the bottom of the screen.
        let y = skillBottom + GAP;
        y = Math.min(y, H - MARGIN - BTN);
        let x = MARGIN;
        for (const a of this.arrows) {
            a.box.setPosition(x, y);
            a.glyph.setPosition(x + BTN / 2, y + BTN / 2);
            x += BTN + GAP;
        }
    }

    setVisible(v: boolean) {
        for (const a of this.arrows) {
            a.box.setVisible(v);
            a.glyph.setVisible(v);
        }
    }
}
