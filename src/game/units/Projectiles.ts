import * as Phaser from 'phaser';
import { arrowKey } from './animations';

// Pooled, cosmetic arrow projectiles. The Archer's damage is applied at the shoot beat
// (in UnitManager), so an arrow here is pure feel: it flies from the archer to where the
// target stood and then recycles. A fixed pool flies allocation-free; if every slot is
// busy the oldest is reused (a momentary blink, never a stall). They live in WORLD space.

const POOL = 48;
const SPEED = 1500;        // px/sec travel
const MIN_MS = 60;         // floor so point-blank shots still read
const SCALE = 0.7;
const DEPTH = 1_500_000;   // above units (depth = world-y, ≤ ~1900), below floating numbers

export class Projectiles {
    private readonly sprites: Phaser.GameObjects.Sprite[] = [];
    private readonly sx = new Float32Array(POOL);
    private readonly sy = new Float32Array(POOL);
    private readonly ex = new Float32Array(POOL);
    private readonly ey = new Float32Array(POOL);
    private readonly elapsed = new Float32Array(POOL);
    private readonly dur = new Float32Array(POOL);
    private next = 0;
    private readonly keys: string[];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        this.keys = [arrowKey('player'), arrowKey('enemy')];
        for (let i = 0; i < POOL; i++) {
            const s = scene.add.sprite(0, 0, this.keys[0])
                .setScale(SCALE)
                .setDepth(DEPTH)
                .setActive(false)
                .setVisible(false);
            layer.add(s);
            this.sprites.push(s);
        }
    }

    // Fly an arrow from (x0,y0) to (x1,y1) for the given faction (0 player, 1 enemy).
    fire(x0: number, y0: number, x1: number, y1: number, faction: number) {
        const i = this.next;
        this.next = (this.next + 1) % POOL;
        const dist = Math.hypot(x1 - x0, y1 - y0);
        this.sx[i] = x0; this.sy[i] = y0;
        this.ex[i] = x1; this.ey[i] = y1;
        this.elapsed[i] = 0;
        this.dur[i] = Math.max(MIN_MS, (dist / SPEED) * 1000);
        this.sprites[i]
            .setTexture(this.keys[faction] ?? this.keys[0])
            .setRotation(Math.atan2(y1 - y0, x1 - x0)) // Arrow.png points right at 0 rad
            .setPosition(x0, y0)
            .setActive(true)
            .setVisible(true);
    }

    update(delta: number) {
        for (let i = 0; i < POOL; i++) {
            const s = this.sprites[i];
            if (!s.active) continue;
            this.elapsed[i] += delta;
            const f = Math.min(1, this.elapsed[i] / this.dur[i]);
            s.x = this.sx[i] + (this.ex[i] - this.sx[i]) * f;
            s.y = this.sy[i] + (this.ey[i] - this.sy[i]) * f;
            if (f >= 1) s.setActive(false).setVisible(false);
        }
    }
}
