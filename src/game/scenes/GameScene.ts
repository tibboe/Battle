import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { CameraController } from '../controls/CameraController';
import { ANIM, MELEE_KEY, loadUnitAtlas, registerUnitAnimations } from '../units/animations';

// The single scene for Milestone 1. Phase 1 sets up the world, the navigable
// camera, and the dev HUD. Phase 2 adds the animation pipeline + one demo unit.
// Pooled hundreds, combat and keeps arrive in later phases.
export class GameScene extends Phaser.Scene {
    private cameraController!: CameraController;
    private hudText!: Phaser.GameObjects.Text;

    // Live count of active units, driven by the unit manager in Phase 3.
    private unitCount = 0;

    // --- Phase 2 demo only (replaced by the pooled unit manager in Phase 3) ---
    private demo!: Phaser.GameObjects.Sprite;
    private demoState = 0;
    private demoTimer = 0;
    private demoStartX = 0;
    // Cycle through every state so each animation can be eyeballed.
    private readonly demoPhases = [
        { anim: ANIM.idle, ms: 1500, move: false },
        { anim: ANIM.walk, ms: 3000, move: true },
        { anim: ANIM.attack, ms: 1400, move: false },
        { anim: ANIM.death, ms: 1600, move: false },
    ];

    constructor() {
        super('Game');
    }

    preload() {
        loadUnitAtlas(this);
    }

    create() {
        // Subtle colour for anything outside the world bounds, so margins read as
        // intentional rather than a harsh black "cut off".
        this.cameras.main.setBackgroundColor(CONFIG.colors.sky);

        this.drawBackdrop();
        registerUnitAnimations(this);
        this.cameraController = new CameraController(this);
        this.buildHud();
        this.createDemoUnit();

        // Keep the HUD anchored when the phone rotates or the window resizes.
        this.scale.on('resize', this.layoutHud, this);
    }

    // A single soldier that walks and cycles through idle/walk/attack/death so the
    // animation pipeline can be verified. Tinted azure to preview the player faction.
    private createDemoUnit() {
        this.demoStartX = CONFIG.world.width / 2 - 150;
        this.demo = this.add.sprite(this.demoStartX, CONFIG.lane.y, MELEE_KEY)
            .setOrigin(0.5, 1) // feet on the lane line (ASSET_SPEC §4)
            .setScale(CONFIG.unit.renderScale)
            .setTint(CONFIG.faction.player.tint);
        this.enterDemoState(0);
        this.unitCount = 1;

        // Start zoomed in on the demo so the animation is clearly visible; the player
        // can pinch out or tap Fit to see the whole battlefield.
        this.cameraController.focusOn(this.demo.x, CONFIG.lane.y);
    }

    private enterDemoState(index: number) {
        this.demoState = index;
        this.demoTimer = 0;
        const phase = this.demoPhases[index];
        if (phase.anim === ANIM.idle) {
            // Restart the loop from the spawn point.
            this.demo.setPosition(this.demoStartX, CONFIG.lane.y);
        }
        this.demo.play(phase.anim);
    }

    private updateDemo(delta: number) {
        const phase = this.demoPhases[this.demoState];
        if (phase.move) {
            this.demo.x += CONFIG.unit.moveSpeed * (delta / 1000);
        }
        this.demoTimer += delta;
        if (this.demoTimer >= phase.ms) {
            this.enterDemoState((this.demoState + 1) % this.demoPhases.length);
        }
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

    update(_time: number, delta: number) {
        this.updateDemo(delta);
        const fps = Math.round(this.game.loop.actualFps);
        this.hudText.setText(`FPS: ${fps}    Units: ${this.unitCount}`);
    }
}
