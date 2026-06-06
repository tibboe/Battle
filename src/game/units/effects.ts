import * as Phaser from 'phaser';
import { rotatesWithCamera } from '../controls/billboard';

// A quick smoke "puff" at a world point — a handful of soft circles that pop, expand, drift up a
// little and fade out, then self-destroy. Used to announce a reinforcement arrival below the enemy
// base (the Tiny Swords pack ships no puff sprite, so it's synthesised from plain circles). If a
// real puff spritesheet is dropped in later, swap this implementation and the callers stay the same.
export function spawnPuff(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    x: number,
    y: number,
    scale = 1,
) {
    const PUFFS = 5;
    for (let k = 0; k < PUFFS; k++) {
        const ox = Phaser.Math.Between(-18, 18) * scale;
        const oy = Phaser.Math.Between(-8, 8) * scale;
        const r = Phaser.Math.Between(14, 22) * scale;
        const c = scene.add.circle(x + ox, y + oy, r, 0xeaf2f6, 0.85).setDepth(y + 40);
        // Symmetric + ground-anchored, so leave it out of the per-frame billboard pass.
        rotatesWithCamera(c);
        layer.add(c);
        scene.tweens.add({
            targets: c,
            scale: { from: 0.4, to: 1.6 },
            alpha: { from: 0.85, to: 0 },
            y: c.y - 30 * scale,
            duration: Phaser.Math.Between(350, 550),
            delay: k * 30,
            ease: 'Sine.easeOut',
            onComplete: () => c.destroy(),
        });
    }
}
