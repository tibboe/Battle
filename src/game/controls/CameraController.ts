import * as Phaser from 'phaser';
import { CONFIG } from '../config';

// Handles camera navigation on both phone and desktop:
//   - drag (one finger / mouse button held) to pan
//   - pinch (two fingers) or mouse wheel to zoom toward a focal point
//   - fitToMap() frames the whole battlefield
// Movement is pure camera scroll/zoom; nothing here touches game state.
export class CameraController {
    private scene: Phaser.Scene;
    private cam: Phaser.Cameras.Scene2D.Camera;
    private pinchDist = 0;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.cam = scene.cameras.main;
        this.cam.setBounds(0, 0, CONFIG.world.width, CONFIG.world.height);

        // Ensure at least two touch pointers exist so pinch works on the phone.
        scene.input.addPointer(2);

        scene.input.on('pointermove', this.onPointerMove, this);
        scene.input.on('pointerup', this.onPointerUp, this);
        scene.input.on('wheel', this.onWheel, this);

        // Open framed on the lane (not fully zoomed out) so panning is useful at once.
        this.defaultView();
    }

    // Default playing view: frame the lane so it fills the screen and there is map to
    // pan to on either side. Centred on the middle of the lane.
    defaultView() {
        const zoom = this.scene.scale.height / CONFIG.camera.defaultViewHeight;
        this.cam.setZoom(Phaser.Math.Clamp(zoom, CONFIG.camera.zoomMin, CONFIG.camera.zoomMax));
        this.cam.centerOn(CONFIG.world.width / 2, CONFIG.lane.y);
    }

    // Zoom while keeping the world point under (focusX, focusY) fixed on screen.
    private zoomTo(targetZoom: number, focusX: number, focusY: number) {
        const zoom = Phaser.Math.Clamp(targetZoom, CONFIG.camera.zoomMin, CONFIG.camera.zoomMax);
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
            this.cam.scrollX -= dx / this.cam.zoom;
            this.cam.scrollY -= dy / this.cam.zoom;
        }
    }

    private onPointerUp() {
        this.pinchDist = 0;
    }

    private onWheel(pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) {
        const factor = dy > 0 ? 0.9 : 1.1;
        this.zoomTo(this.cam.zoom * factor, pointer.x, pointer.y);
    }

    // Zoom out far enough to show the entire world and centre on it.
    fitToMap() {
        const zoomX = this.scene.scale.width / CONFIG.world.width;
        const zoomY = this.scene.scale.height / CONFIG.world.height;
        const zoom = Phaser.Math.Clamp(Math.min(zoomX, zoomY), CONFIG.camera.zoomMin, CONFIG.camera.zoomMax);
        this.cam.setZoom(zoom);
        this.cam.centerOn(CONFIG.world.width / 2, CONFIG.world.height / 2);
    }
}
