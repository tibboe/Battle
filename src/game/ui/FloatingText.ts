import * as Phaser from 'phaser';
import { rotatesWithCamera, screenOffset, uprightAngle } from '../controls/billboard';

// Pooled floating combat numbers — damage in white, heals in green. They live in WORLD
// space (above the units) so they zoom and pan with the battle. A fixed pool is created
// once and recycled round-robin; nothing is allocated mid-battle, and at worst a still-
// rising number is reused early (a momentary pop, never a stall). Toggle from the Dev
// panel; UnitManager only emits when the toggle is on.

const POOL = 120;   // concurrent numbers; comfortably above a full-horde hit rate
const RISE = 40;    // px the number drifts up over its life
const LIFE = 650;   // ms visible
const DEPTH = 2_000_000; // above every unit (units use world-y, up to ~1900, as depth)

export class FloatingText {
    private readonly scene: Phaser.Scene;
    private readonly texts: Phaser.GameObjects.Text[] = [];
    private readonly life = new Float32Array(POOL);
    private readonly startX = new Float32Array(POOL);
    private readonly startY = new Float32Array(POOL);
    private readonly up = new Phaser.Math.Vector2(); // scratch: "up on screen" reused each frame
    private next = 0;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        this.scene = scene;
        for (let i = 0; i < POOL; i++) {
            const t = scene.add.text(0, 0, '', {
                fontFamily: 'monospace',
                fontSize: '24px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4, // keeps light numbers legible over any sprite
            })
                .setOrigin(0.5, 1)
                .setDepth(DEPTH)
                .setActive(false)
                .setVisible(false);
            rotatesWithCamera(t); // we keep it upright ourselves in update()
            layer.add(t);
            this.texts.push(t);
        }
    }

    // Pop a number (or short label) just above (x, y). Round-robin; if every slot is busy
    // the oldest is reused.
    pop(x: number, y: number, value: number | string, color = '#ffffff') {
        const i = this.next;
        this.next = (this.next + 1) % POOL;
        const t = this.texts[i];
        t.setText(String(value))
            .setColor(color)
            .setPosition(x, y - 8)
            .setAlpha(1)
            .setActive(true)
            .setVisible(true);
        this.life[i] = LIFE;
        this.startX[i] = x;
        this.startY[i] = y - 8;
    }

    update(delta: number) {
        // Drift UP on screen and stay upright even when the battlefield is rotated.
        const angle = uprightAngle(this.scene);
        const up = screenOffset(this.scene, 0, 1, this.up); // unit "up on screen" in world space
        for (let i = 0; i < POOL; i++) {
            const t = this.texts[i];
            if (!t.active) continue;
            this.life[i] -= delta;
            if (this.life[i] <= 0) {
                t.setActive(false).setVisible(false);
                continue;
            }
            const f = this.life[i] / LIFE; // 1 -> 0
            const rise = (1 - f) * RISE;
            t.x = this.startX[i] + up.x * rise;
            t.y = this.startY[i] + up.y * rise;
            t.rotation = angle;
            t.alpha = f < 0.4 ? f / 0.4 : 1; // hold, then fade out over the last 40%
        }
    }
}
