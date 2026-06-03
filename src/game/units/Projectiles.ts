import * as Phaser from 'phaser';
import { arrowKey } from './animations';

// Pooled arrow projectiles. Two kinds share the pool:
//   • fire()  — a straight cosmetic arrow (the Archer's normal shot; damage was already
//               applied at the beat, so this is pure feel).
//   • lob()   — an arcing "long shot" arrow that calls back onLand(x, y, faction) when it
//               touches down, so the caller can resolve area damage there (a real hit).
// A fixed pool flies allocation-free; if every slot is busy the oldest is reused.

const POOL = 96;          // larger pool since landed arrows linger before recycling
const SPEED = 900;        // px/sec for normal shots (slow enough that the arc reads)
const MIN_MS = 60;        // floor so point-blank shots still read
const SCALE = 0.7;
const DEPTH = 1_500_000;  // above units (depth = world-y, ≤ ~1900), below floating numbers
const LINGER_MS = 5000;   // a landed arrow sticks in the ground this long before vanishing
const FADE_MS = 1200;     // …fading out over the final stretch of that linger

type LandCb = (x: number, y: number, faction: number) => void;

export class Projectiles {
    private readonly sprites: Phaser.GameObjects.Sprite[] = [];
    private readonly sx = new Float32Array(POOL);
    private readonly sy = new Float32Array(POOL);
    private readonly ex = new Float32Array(POOL);
    private readonly ey = new Float32Array(POOL);
    private readonly elapsed = new Float32Array(POOL);
    private readonly dur = new Float32Array(POOL);
    private readonly arc = new Float32Array(POOL);   // 0 = straight; >0 = lob apex height
    private readonly stuck = new Float32Array(POOL); // >0 = landed, ms of linger remaining
    private readonly pfac = new Int8Array(POOL);
    private readonly landCb: (LandCb | undefined)[] = new Array(POOL);
    private next = 0;
    private readonly keys: string[];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        this.keys = [arrowKey('player'), arrowKey('enemy')];
        for (let i = 0; i < POOL; i++) {
            const s = scene.add.sprite(0, 0, this.keys[0])
                .setScale(SCALE).setDepth(DEPTH).setActive(false).setVisible(false);
            layer.add(s);
            this.sprites.push(s);
        }
    }

    private launch(x0: number, y0: number, x1: number, y1: number, faction: number, dur: number, arc: number, onLand?: LandCb) {
        const i = this.next;
        this.next = (this.next + 1) % POOL;
        this.sx[i] = x0; this.sy[i] = y0;
        this.ex[i] = x1; this.ey[i] = y1;
        this.elapsed[i] = 0;
        this.dur[i] = Math.max(MIN_MS, dur);
        this.arc[i] = arc;
        this.stuck[i] = 0;
        this.pfac[i] = faction;
        this.landCb[i] = onLand;
        this.sprites[i]
            .setTexture(this.keys[faction] ?? this.keys[0])
            .setRotation(Math.atan2(y1 - y0, x1 - x0)) // straight arrows keep this; lobs recompute
            .setPosition(x0, y0)
            .setDepth(DEPTH)
            .setAlpha(1)
            .setActive(true)
            .setVisible(true);
    }

    // The Archer's normal shot: a cosmetic arrow that arcs up and over to the target (damage
    // was already applied at the strike beat, so this is pure feel).
    fire(x0: number, y0: number, x1: number, y1: number, faction: number) {
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const arc = Phaser.Math.Clamp(dist * 0.32, 40, 200); // height of the lob
        this.launch(x0, y0, x1, y1, faction, (dist / SPEED) * 1000, arc);
    }

    // Arcing long shot; onLand fires where it touches down.
    lob(x0: number, y0: number, x1: number, y1: number, faction: number, speed: number, onLand: LandCb) {
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const arc = Phaser.Math.Clamp(dist * 0.3, 90, 380);
        this.launch(x0, y0, x1, y1, faction, (dist / speed) * 1000, arc, onLand);
    }

    update(delta: number) {
        for (let i = 0; i < POOL; i++) {
            const s = this.sprites[i];
            if (!s.active) continue;

            // Landed arrow: hold it where it stuck, fade over the final stretch, then recycle.
            if (this.stuck[i] > 0) {
                this.stuck[i] -= delta;
                if (this.stuck[i] <= 0) {
                    s.setActive(false).setVisible(false).setAlpha(1);
                } else if (this.stuck[i] < FADE_MS) {
                    s.setAlpha(this.stuck[i] / FADE_MS);
                }
                continue;
            }

            this.elapsed[i] += delta;
            const f = Math.min(1, this.elapsed[i] / this.dur[i]);
            const dxTotal = this.ex[i] - this.sx[i];
            s.x = this.sx[i] + dxTotal * f;
            if (this.arc[i] > 0) {
                const dyTotal = this.ey[i] - this.sy[i];
                s.y = this.sy[i] + dyTotal * f - this.arc[i] * Math.sin(Math.PI * f);
                // Point the arrow along its (arcing) velocity: up on the way out, down on the way in.
                const vy = dyTotal - this.arc[i] * Math.PI * Math.cos(Math.PI * f);
                s.setRotation(Math.atan2(vy, dxTotal));
            } else {
                s.y = this.sy[i] + (this.ey[i] - this.sy[i]) * f;
            }
            if (f >= 1) {
                const cb = this.landCb[i];
                this.landCb[i] = undefined;
                if (cb) cb(this.ex[i], this.ey[i], this.pfac[i]);
                // Plant the arrow where it landed and let it linger; sort it near the ground
                // (depth ≈ landing y) so units pass in front of it.
                s.setPosition(this.ex[i], this.ey[i]).setDepth(this.ey[i]);
                this.stuck[i] = LINGER_MS;
            }
        }
    }
}
