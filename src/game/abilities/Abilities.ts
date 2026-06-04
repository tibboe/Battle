import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { Projectiles } from '../units/Projectiles';
import { Faction, UnitManager } from '../units/UnitManager';
import { matchStats } from '../stats/MatchStats';

// Player-cast battlefield skills. Right now there is exactly one — the Arrow Volley — but this
// manager owns the generic plumbing (per-skill cooldown + the staggered raining of arrows) so
// adding more skills later is a matter of another cast method.
//
// A cast schedules N arrows to fall over the skill's `duration` (so they patter down rather
// than landing in one frame). Each pending arrow is launched from high above + off to one side
// (the "from the sky" look) toward a random point inside the target circle; when it lands it
// calls back into UnitManager.resolveVolleyHit, which damages whatever opposing unit it hit.

interface PendingArrow {
    delay: number;       // ms until this arrow launches
    tx: number;          // landing x
    ty: number;          // landing y
    faction: Faction;    // who cast it (so the hit damages the other side)
}

export class Abilities {
    private readonly scene: Phaser.Scene;
    private readonly worldLayer: Phaser.GameObjects.Layer;
    private readonly projectiles: Projectiles;
    private readonly units: UnitManager;

    private volleyCd = 0;                       // ms left on the Arrow Volley cooldown
    private readonly pending: PendingArrow[] = [];

    constructor(
        scene: Phaser.Scene,
        worldLayer: Phaser.GameObjects.Layer,
        projectiles: Projectiles,
        units: UnitManager,
    ) {
        this.scene = scene;
        this.worldLayer = worldLayer;
        this.projectiles = projectiles;
        this.units = units;
    }

    // ---- Arrow Volley ----

    get volleyReady(): boolean {
        return this.volleyCd <= 0;
    }

    // 0 (just cast) … 1 (ready) — drives the skill button's cooldown sweep.
    get volleyCooldownFrac(): number {
        const cd = CONFIG.abilities.arrowVolley.cooldown;
        return cd > 0 ? 1 - this.volleyCd / cd : 1;
    }

    get volleyCooldownSeconds(): number {
        return Math.ceil(this.volleyCd / 1000);
    }

    // Cast a volley centred on (cx, cy). Returns false if still cooling down. Schedules every
    // arrow up front; update() launches them as their stagger timers elapse.
    castArrowVolley(faction: Faction, cx: number, cy: number): boolean {
        if (this.volleyCd > 0) return false;
        const av = CONFIG.abilities.arrowVolley;
        this.volleyCd = av.cooldown;
        matchStats.skillCast(faction);

        for (let k = 0; k < av.arrows; k++) {
            // Uniform random point inside the target circle (sqrt keeps it even, not centre-heavy).
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * av.radius;
            this.pending.push({
                delay: Math.random() * av.duration,
                tx: cx + Math.cos(a) * r,
                ty: cy + Math.sin(a) * r,
                faction,
            });
        }

        this.markTarget(cx, cy, av.radius, av.duration);
        return true;
    }

    update(delta: number) {
        if (this.volleyCd > 0) this.volleyCd = Math.max(0, this.volleyCd - delta);

        if (this.pending.length === 0) return;
        const av = CONFIG.abilities.arrowVolley;
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const p = this.pending[i];
            p.delay -= delta;
            if (p.delay > 0) continue;
            // Launch from above and off to one side so the arrow arcs down into the field.
            const ox = p.tx + Phaser.Math.FloatBetween(-av.skySpread, av.skySpread);
            const oy = p.ty - av.skyHeight;
            this.projectiles.lob(ox, oy, p.tx, p.ty, p.faction, av.fallSpeed, (lx, ly, f) =>
                this.units.resolveVolleyHit(lx, ly, f as Faction));
            this.pending.splice(i, 1);
        }
    }

    // A brief ground ring marking where the volley is landing; it fades over the rain window.
    private markTarget(x: number, y: number, radius: number, duration: number) {
        const ring = this.scene.add.circle(x, y, radius)
            .setStrokeStyle(3, 0xffe08a, 0.9)
            .setFillStyle(0xffe08a, 0.08)
            .setDepth(y);
        this.worldLayer.add(ring);
        this.scene.tweens.add({
            targets: ring,
            alpha: { from: 0.9, to: 0 },
            duration: duration + 400,
            onComplete: () => ring.destroy(),
        });
    }
}
