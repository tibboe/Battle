import * as Phaser from 'phaser';
import { battlefieldCenterY, CONFIG } from '../config';

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

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.cam = scene.cameras.main;
        this.cam.setBounds(0, 0, CONFIG.world.width, CONFIG.world.height);

        // Ensure at least two touch pointers exist so pinch works on the phone.
        scene.input.addPointer(2);

        // Pointer/wheel listeners are scene-scoped, so they're cleaned up on shutdown.
        scene.input.on('pointermove', this.onPointerMove, this);
        scene.input.on('pointerup', this.onPointerUp, this);
        scene.input.on('wheel', this.onWheel, this);

        // Open framed on the lane (not fully zoomed out) so panning is useful at once.
        this.defaultView();
    }

    // Smallest zoom we allow: the world always fills the screen on BOTH axes, so there
    // are never black bars (the bigger ratio wins; the other axis overflows and pans).
    private minZoom(): number {
        const fillX = this.scene.scale.width / CONFIG.world.width;
        const fillY = this.scene.scale.height / CONFIG.world.height;
        return Math.max(CONFIG.camera.zoomMin, fillX, fillY);
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
        // same world distance regardless of zoom level.
        if (pointer.isDown) {
            const dx = pointer.position.x - pointer.prevPosition.x;
            const dy = pointer.position.y - pointer.prevPosition.y;
            if (dx !== 0 || dy !== 0) this.userInteracted = true;
            this.cam.scrollX -= dx / this.cam.zoom;
            this.cam.scrollY -= dy / this.cam.zoom;
        }
    }

    private onPointerUp() {
        this.pinchDist = 0;
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
