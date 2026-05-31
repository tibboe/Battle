import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { CameraController } from '../controls/CameraController';
import { loadUnitAtlas, registerUnitAnimations } from '../units/animations';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';

// HUD draws above everything (units use world-y as depth, which can exceed 1000).
const HUD_DEPTH = 1_000_000;

// The single scene for Milestone 1. Phases: world + camera + HUD (1), animation
// pipeline (2), pooled horde (3), combat (4), keeps + win/lose + restart (5).
export class GameScene extends Phaser.Scene {
    private cameraController!: CameraController;
    private units!: UnitManager;

    // World objects (backdrop + units) live here and are shown by the main camera.
    private worldLayer!: Phaser.GameObjects.Layer;
    // HUD lives here and is shown by a dedicated UI camera that never zooms/pans.
    private uiLayer!: Phaser.GameObjects.Layer;
    private uiCamera!: Phaser.Cameras.Scene2D.Camera;

    private hudText!: Phaser.GameObjects.Text;
    private fitButton!: Phaser.GameObjects.Text;
    private playerKeepText!: Phaser.GameObjects.Text;
    private enemyKeepText!: Phaser.GameObjects.Text;

    private playerKeepHp: number = CONFIG.keep.hp;
    private enemyKeepHp: number = CONFIG.keep.hp;
    private gameOver = false;

    constructor() {
        super('Game');
    }

    preload() {
        loadUnitAtlas(this);
    }

    create() {
        this.playerKeepHp = CONFIG.keep.hp;
        this.enemyKeepHp = CONFIG.keep.hp;
        this.gameOver = false;

        // Subtle colour for anything outside the world bounds.
        this.cameras.main.setBackgroundColor(CONFIG.colors.sky);

        // Two layers: the world (zoomed/panned by the main camera) and the HUD (drawn
        // by a separate UI camera so it never zooms or drifts with the world).
        this.worldLayer = this.add.layer();
        this.uiLayer = this.add.layer();

        this.drawBackdrop();
        registerUnitAnimations(this);
        this.cameraController = new CameraController(this);
        this.buildHud();

        // Both keeps spawn a horde; units that reach the far keep damage it.
        this.units = new UnitManager(this, this.worldLayer, (attacker) => this.onReachKeep(attacker));

        // UI camera renders only the HUD; the main camera renders only the world.
        this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.cameras.main.ignore(this.uiLayer);
        this.uiCamera.ignore(this.worldLayer);

        // One resize handler, cleaned up on shutdown so restarts don't leak listeners.
        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    }

    // A unit reached the opposing keep: damage it and check for a finished battle.
    private onReachKeep(attacker: Faction) {
        if (this.gameOver) return;
        if (attacker === FACTION.player) {
            this.enemyKeepHp = Math.max(0, this.enemyKeepHp - CONFIG.keep.damagePerUnit);
            if (this.enemyKeepHp === 0) this.endGame(true);
        } else {
            this.playerKeepHp = Math.max(0, this.playerKeepHp - CONFIG.keep.damagePerUnit);
            if (this.playerKeepHp === 0) this.endGame(false);
        }
    }

    private endGame(playerWon: boolean) {
        this.gameOver = true;

        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        const dim = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH);

        const title = this.add.text(cx, cy - 50, playerWon ? 'VICTORY' : 'DEFEAT', {
            fontFamily: 'monospace',
            fontSize: '64px',
            color: playerWon ? '#7fd0ff' : '#ff8a8a',
            fontStyle: 'bold',
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH);

        const restart = this.add.text(cx, cy + 40, '↻ Restart', {
            fontFamily: 'monospace',
            fontSize: '28px',
            color: '#ffffff',
            backgroundColor: '#2a6cd6',
            padding: { x: 18, y: 12 },
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH)
            .setInteractive({ useHandCursor: true });

        restart.on('pointerup', () => this.scene.restart());

        // On the UI camera so the overlay is unaffected by world zoom/pan.
        this.uiLayer.add([dim, title, restart]);
    }

    // A static placeholder battlefield: ground, the lane band, faint grid lines, and
    // markers where the two keeps stand.
    private drawBackdrop() {
        const { world, lane, keep, colors } = CONFIG;
        const g = this.add.graphics();
        this.worldLayer.add(g);

        g.fillStyle(colors.ground, 1);
        g.fillRect(0, 0, world.width, world.height);

        g.lineStyle(2, colors.grid, 1);
        for (let x = 0; x <= world.width; x += 250) {
            g.lineBetween(x, 0, x, world.height);
        }

        g.fillStyle(colors.laneBand, 1);
        g.fillRect(0, lane.y - lane.thickness / 2, world.width, lane.thickness);

        const half = keep.size / 2;
        g.fillStyle(CONFIG.faction.player.tint, 0.85);
        g.fillRect(keep.margin - half, lane.y - half, keep.size, keep.size);
        g.fillStyle(CONFIG.faction.enemy.tint, 0.85);
        g.fillRect(world.width - keep.margin - half, lane.y - half, keep.size, keep.size);

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
            .setDepth(HUD_DEPTH);

        // Keep HP readouts (text is enough for Milestone 1).
        this.playerKeepText = this.add.text(0, 10, '', {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#7fd0ff',
            backgroundColor: '#00000080',
            padding: { x: 8, y: 6 },
        })
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH);

        this.enemyKeepText = this.add.text(0, 10, '', {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ff8a8a',
            backgroundColor: '#00000080',
            padding: { x: 8, y: 6 },
        })
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH);

        this.fitButton = this.add.text(0, 0, '⤢ Fit', {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffffff',
            backgroundColor: '#2a6cd6',
            padding: { x: 12, y: 8 },
        })
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH)
            .setInteractive({ useHandCursor: true });

        this.fitButton.on('pointerup', () => this.cameraController.fitToMap());

        this.uiLayer.add([this.hudText, this.playerKeepText, this.enemyKeepText, this.fitButton]);
        this.layoutHud();
    }

    private onResize() {
        this.uiCamera.setSize(this.scale.width, this.scale.height);
        this.layoutHud();
        this.cameraController.handleResize();
    }

    // Anchor HUD pieces to the current viewport.
    private layoutHud() {
        const w = this.scale.width;
        if (this.fitButton) this.fitButton.setPosition(w - this.fitButton.width - 12, 10);
        if (this.playerKeepText) this.playerKeepText.setPosition(w / 2 - this.playerKeepText.width - 8, 10);
        if (this.enemyKeepText) this.enemyKeepText.setPosition(w / 2 + 8, 10);
    }

    update(_time: number, delta: number) {
        if (!this.gameOver) {
            this.units.update(delta);
        }

        const fps = Math.round(this.game.loop.actualFps);
        this.hudText.setText(`FPS: ${fps}    Units: ${this.units.activeCount}`);
        this.playerKeepText.setText(`You ${this.playerKeepHp}`);
        this.enemyKeepText.setText(`Enemy ${this.enemyKeepHp}`);
        this.layoutHud();
    }
}
