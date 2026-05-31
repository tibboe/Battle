import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { CameraController } from '../controls/CameraController';

// The single scene for Milestone 1. Phase 1 sets up the world, the navigable
// camera, and the dev HUD. Units, combat and keeps arrive in later phases.
export class GameScene extends Phaser.Scene {
    private cameraController!: CameraController;
    private hudText!: Phaser.GameObjects.Text;

    // Live count of active units, driven by the unit manager in Phase 3.
    private unitCount = 0;

    constructor() {
        super('Game');
    }

    create() {
        this.drawBackdrop();
        this.cameraController = new CameraController(this);
        this.buildHud();

        // Keep the HUD anchored when the phone rotates or the window resizes.
        this.scale.on('resize', this.layoutHud, this);
    }

    // A static placeholder battlefield: ground, the lane band, faint grid lines for
    // a sense of scale while panning, and markers where the two keeps will stand.
    private drawBackdrop() {
        const { world, lane, keep, colors } = CONFIG;
        const g = this.add.graphics();

        // Ground.
        g.fillStyle(colors.ground, 1);
        g.fillRect(0, 0, world.width, world.height);

        // Vertical grid lines so panning/zooming is readable.
        g.lineStyle(2, colors.grid, 1);
        for (let x = 0; x <= world.width; x += 250) {
            g.lineBetween(x, 0, x, world.height);
        }

        // The lane band the armies march along.
        g.fillStyle(colors.laneBand, 1);
        g.fillRect(0, lane.y - lane.thickness / 2, world.width, lane.thickness);

        // Keep markers (real keeps with HP arrive in Phase 5).
        const half = keep.size / 2;
        g.fillStyle(CONFIG.faction.player.tint, 0.85);
        g.fillRect(keep.margin - half, lane.y - half, keep.size, keep.size);
        g.fillStyle(CONFIG.faction.enemy.tint, 0.85);
        g.fillRect(world.width - keep.margin - half, lane.y - half, keep.size, keep.size);

        // World border so the edge of the battlefield is obvious when zoomed out.
        g.lineStyle(6, 0xffffff, 0.25);
        g.strokeRect(0, 0, world.width, world.height);
    }

    private buildHud() {
        this.hudText = this.add.text(12, 10, '', {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffffff',
            backgroundColor: '#00000080',
            padding: { x: 8, y: 6 },
        })
            .setScrollFactor(0)
            .setDepth(1000);

        // "Fit" button to frame the whole battlefield. Fixed to the screen.
        const fitButton = this.add.text(0, 0, '⤢ Fit', {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffffff',
            backgroundColor: '#2a6cd6',
            padding: { x: 12, y: 8 },
        })
            .setScrollFactor(0)
            .setDepth(1000)
            .setInteractive({ useHandCursor: true });

        fitButton.on('pointerup', () => this.cameraController.fitToMap());
        this.fitButton = fitButton;
        this.layoutHud();
    }

    private fitButton!: Phaser.GameObjects.Text;

    // Re-anchor the fit button to the top-right of the current viewport.
    private layoutHud() {
        if (this.fitButton) {
            this.fitButton.setPosition(this.scale.width - this.fitButton.width - 12, 10);
        }
    }

    // Expose the count so the Phase 3 unit manager can update the readout.
    setUnitCount(count: number) {
        this.unitCount = count;
    }

    update() {
        const fps = Math.round(this.game.loop.actualFps);
        this.hudText.setText(`FPS: ${fps}    Units: ${this.unitCount}`);
    }
}
