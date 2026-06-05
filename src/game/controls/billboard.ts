import * as Phaser from 'phaser';

// ── Screen-rotation "billboarding" ───────────────────────────────────────────────────
// The rotate HUD turns the whole battlefield by spinning the main camera. We WANT the
// terrain (ground tiles) to turn with it, but every standing asset — trees, buildings,
// units, and the labels/bars that float above them — should stay UPRIGHT facing the
// player, like map markers that don't tilt when you rotate a map.
//
// The camera applies its angle θ during rendering, so to make an object look upright we
// give it rotation −θ (the camera's +θ then cancels it). And because an object's
// "above the head" offset is baked in world space, that offset rotates with the camera
// too; to keep a health bar pointing UP on screen we rotate the offset by −θ as well.
//
// Phaser 4's Camera type omits the `rotation` accessor, but it exists at runtime (it
// backs setRotation and is what the rotate tween animates) — read it through a cast.

export function cameraAngle(scene: Phaser.Scene): number {
    return (scene.cameras.main as unknown as { rotation: number }).rotation;
}

// The rotation (radians) to set on a world object so it renders upright despite the
// camera's angle.
export const uprightAngle = (scene: Phaser.Scene): number => -cameraAngle(scene);

// World-space delta that lands `up` px above (and `right` px to the right of) an anchor
// ON SCREEN at the current camera angle. Used to place bars/labels above their sprite:
//   worldPos = anchor + screenOffset(scene, right, up)
export function screenOffset(
    scene: Phaser.Scene,
    right: number,
    up: number,
    out?: Phaser.Math.Vector2,
): Phaser.Math.Vector2 {
    const t = cameraAngle(scene);
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // world = R(−θ) · (right, −up)
    const sx = right;
    const sy = -up;
    return (out ?? new Phaser.Math.Vector2()).set(sx * cos + sy * sin, -sx * sin + sy * cos);
}

// Mark a world object so the central billboard pass LEAVES IT ALONE — it should rotate
// with the camera (the terrain, ground decals like selection rings, and overlays whose
// owner already compensates for the angle themselves, e.g. health bars / floating text).
export function rotatesWithCamera<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    (obj as unknown as { _rotatesWithCamera?: boolean })._rotatesWithCamera = true;
    return obj;
}

export function isRotatesWithCamera(obj: Phaser.GameObjects.GameObject): boolean {
    return (obj as unknown as { _rotatesWithCamera?: boolean })._rotatesWithCamera === true;
}
