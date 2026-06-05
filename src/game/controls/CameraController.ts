import * as Phaser from 'phaser';
import { battlefieldCenterY, CONFIG } from '../config';
import { cameraAngle } from './billboard';

// Handles camera navigation on both phone and desktop:
//   - drag (one finger / mouse button held) to pan
//   - pinch (two fingers) or mouse wheel to zoom toward a focal point
//   - fitToMap() frames the whole battlefield (width), defaultView() frames the lane
// Movement is pure camera scroll/zoom; nothing here touches game state.
export class CameraController {
    private scene: Phaser.Scene;
    private cam: Phaser.Cameras.Scene2D.Camera;
    private pinchDist = 0;
    // Once the player drags/zooms, stop auto-reframing on resize (respect their view).
    private userInteracted = false;
    // Discrete battlefield orientation: 0,1,2,3 -> 0°,90°,180°,270° clockwise. Drives the
    // rotation-aware zoom floor and drag-pan; the camera's raw `rotation` accumulates freely.
    private orientation = 0;
    // True while a 90° rotation tween is mid-flight — blocks new rotations (debounce).
    private isRotating = false;
    // Pan inertia: after a drag is released the camera keeps gliding at the fling velocity
    // (world scroll units/sec) and decays, so panning eases to a stop instead of cutting dead.
    private velX = 0;
    private velY = 0;
    private gliding = false;
    private lastMoveAt = 0; // ms timestamp of the last drag move (to measure fling speed)

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.cam = scene.cameras.main;
        this.cam.setBounds(0, 0, CONFIG.world.width, CONFIG.world.height);

        // Ensure at least two touch pointers exist so pinch works on the phone.
        scene.input.addPointer(2);

        // Pointer/wheel listeners are scene-scoped, so they're cleaned up on shutdown.
        scene.input.on('pointerdown', this.onPointerDown, this);
        scene.input.on('pointermove', this.onPointerMove, this);
        scene.input.on('pointerup', this.onPointerUp, this);
        scene.input.on('wheel', this.onWheel, this);

        // Open framed on the lane (not fully zoomed out) so panning is useful at once.
        this.defaultView();
    }

    // Smallest zoom we allow at a given orientation: the world always fills the screen on
    // BOTH axes, so there are never black bars (the bigger ratio wins; the other axis
    // overflows and pans). At 90°/270° the world is turned a quarter, so its width/height
    // map to the OPPOSITE screen axes — swap them.
    private minZoomFor(orientation: number): number {
        const rotated = orientation % 2 === 1;
        const worldW = rotated ? CONFIG.world.height : CONFIG.world.width;
        const worldH = rotated ? CONFIG.world.width : CONFIG.world.height;
        const fillX = this.scene.scale.width / worldW;
        const fillY = this.scene.scale.height / worldH;
        return Math.max(CONFIG.camera.zoomMin, fillX, fillY);
    }

    private minZoom(): number {
        return this.minZoomFor(this.orientation);
    }

    // Spin the whole battlefield one 90° step: dir = +1 (clockwise) or -1 (anticlockwise).
    // Ignored while a previous spin is still running (so rapid taps don't stack up). We
    // tween the camera's raw rotation by a ±90° DELTA (never to a wrapped angle) so it
    // always takes the short path, and re-centre on the pre-spin focal point in onComplete
    // so the world turns around what the player is looking at rather than flying off-screen.
    rotateBy(dir: 1 | -1) {
        if (this.isRotating) return;
        const next = (this.orientation + dir + 4) % 4;
        const pivot = this.cam.getWorldPoint(this.scene.scale.width / 2, this.scene.scale.height / 2);

        // Raise the zoom to the destination's floor up front, so we never flash black bars
        // mid-spin (a no-op on a near-square screen; matters when the aspect favours the
        // other world dimension).
        const floor = this.minZoomFor(next);
        if (this.cam.zoom < floor) this.cam.setZoom(floor);

        this.isRotating = true;
        this.gliding = false; // a turn takes over the view; drop any pan momentum
        this.userInteracted = true; // a deliberate view change — resize should re-clamp, not re-frame
        this.cam.useBounds = false; // let the spin run unclamped; restored for orientation 0 below

        this.scene.tweens.add({
            targets: this.cam,
            rotation: cameraAngle(this.scene) + dir * Math.PI / 2,
            duration: CONFIG.camera.rotateMs,
            ease: CONFIG.camera.rotateEase,
            onComplete: () => {
                this.orientation = next;
                this.cam.useBounds = (next === 0); // bounds clamp is only correct unrotated
                this.cam.centerOn(pivot.x, pivot.y);
                this.cam.setZoom(Phaser.Math.Clamp(this.cam.zoom, floor, CONFIG.camera.zoomMax));
                this.isRotating = false;
            },
        });
    }

    // Default playing view: frame the lane so it fills the screen, with map above/below
    // and to either side to pan into. Centred on the middle of the lane.
    defaultView() {
        const zoom = this.scene.scale.height / CONFIG.camera.defaultViewHeight;
        this.cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom(), CONFIG.camera.zoomMax));
        this.cam.centerOn(CONFIG.world.width / 2, battlefieldCenterY());
    }

    // "Fit": zoom out to show the whole lane length (fills the width), centred on the lane.
    fitToMap() {
        this.cam.setZoom(this.minZoom());
        this.cam.centerOn(CONFIG.world.width / 2, battlefieldCenterY());
    }

    // Zoom in on a world point so detail (e.g. a single unit) is clearly visible.
    focusOn(x: number, y: number, viewHeight = 350) {
        const zoom = Phaser.Math.Clamp(this.scene.scale.height / viewHeight, this.minZoom(), CONFIG.camera.zoomMax);
        this.cam.setZoom(zoom);
        this.cam.centerOn(x, y);
    }

    // Zoom while keeping the world point under (focusX, focusY) fixed on screen.
    private zoomTo(targetZoom: number, focusX: number, focusY: number) {
        const zoom = Phaser.Math.Clamp(targetZoom, this.minZoom(), CONFIG.camera.zoomMax);
        const before = this.cam.getWorldPoint(focusX, focusY);
        this.cam.setZoom(zoom);
        const after = this.cam.getWorldPoint(focusX, focusY);
        this.cam.scrollX += before.x - after.x;
        this.cam.scrollY += before.y - after.y;
    }

    private onPointerMove(pointer: Phaser.Input.Pointer) {
        const p1 = this.scene.input.pointer1;
        const p2 = this.scene.input.pointer2;

        // Two fingers down -> pinch zoom (ignore panning).
        if (p1.isDown && p2.isDown) {
            this.userInteracted = true;
            const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
            if (this.pinchDist > 0 && dist > 0) {
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                this.zoomTo(this.cam.zoom * (dist / this.pinchDist), midX, midY);
            }
            this.pinchDist = dist;
            return;
        }
        this.pinchDist = 0;

        // One pointer down -> drag pan. Divide by zoom so a finger drag moves the
        // same world distance regardless of zoom level. When the camera is rotated, a
        // screen-space delta no longer lines up with the world scroll axes, so rotate it
        // by -rotation first (this collapses to the plain delta at orientation 0).
        if (pointer.isDown) {
            const dx = pointer.position.x - pointer.prevPosition.x;
            const dy = pointer.position.y - pointer.prevPosition.y;
            if (dx !== 0 || dy !== 0) this.userInteracted = true;
            const cos = Math.cos(-cameraAngle(this.scene));
            const sin = Math.sin(-cameraAngle(this.scene));
            const sdx = -(dx * cos - dy * sin) / this.cam.zoom; // change applied to scrollX
            const sdy = -(dx * sin + dy * cos) / this.cam.zoom;
            this.cam.scrollX += sdx;
            this.cam.scrollY += sdy;
            // Track the fling speed (world units/sec) from the most recent motion, lightly
            // smoothed, so releasing the drag can carry it on with momentum.
            const now = this.scene.time.now;
            const dt = now - this.lastMoveAt;
            this.lastMoveAt = now;
            if (dt > 0 && dt < 100) {
                this.velX = this.velX * 0.4 + (sdx / (dt / 1000)) * 0.6;
                this.velY = this.velY * 0.4 + (sdy / (dt / 1000)) * 0.6;
            }
        }
    }

    // A new touch grabs the camera — stop any glide so it doesn't fight the finger.
    private onPointerDown() {
        this.gliding = false;
        this.velX = 0;
        this.velY = 0;
        this.lastMoveAt = this.scene.time.now;
    }

    private onPointerUp() {
        this.pinchDist = 0;
        // Still touching with another finger (e.g. a pinch) — not a release, don't glide yet.
        if (this.scene.input.pointer1.isDown || this.scene.input.pointer2.isDown) return;
        // Glide only if the finger was actually moving at the moment it lifted (a held-still
        // release, or a tap, should stop dead).
        const movingAtRelease = this.scene.time.now - this.lastMoveAt < 80;
        if (movingAtRelease && (this.velX !== 0 || this.velY !== 0)) {
            this.gliding = true;
        } else {
            this.velX = 0;
            this.velY = 0;
        }
    }

    // Per-frame pan inertia: glide on at the released velocity, easing to a stop. Called from
    // the scene's update loop.
    update(delta: number) {
        if (!this.gliding) return;
        if (this.scene.input.pointer1.isDown) { this.gliding = false; return; } // grabbed again
        const dt = delta / 1000;
        this.cam.scrollX += this.velX * dt;
        this.cam.scrollY += this.velY * dt;
        const decay = Math.exp(-CONFIG.camera.panGlideDecay * dt);
        this.velX *= decay;
        this.velY *= decay;
        if (Math.hypot(this.velX, this.velY) * this.cam.zoom < CONFIG.camera.panGlideMinPx) {
            this.gliding = false;
            this.velX = 0;
            this.velY = 0;
        }
    }

    private onWheel(pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) {
        this.userInteracted = true;
        const factor = dy > 0 ? 0.9 : 1.1;
        this.zoomTo(this.cam.zoom * factor, pointer.x, pointer.y);
    }

    // On rotate/resize (incl. the mobile URL bar settling after load): until the player
    // has taken control, re-frame to the default view using the now-correct size;
    // afterwards just re-clamp so we never drop below the new minimum zoom.
    handleResize() {
        if (this.userInteracted) {
            this.cam.setZoom(Phaser.Math.Clamp(this.cam.zoom, this.minZoom(), CONFIG.camera.zoomMax));
        } else {
            this.defaultView();
        }
    }
}
