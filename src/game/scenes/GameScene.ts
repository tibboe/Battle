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

    // A procedural battlefield: tiled grass field, a dirt lane, scattered scenery in
    // the margins, and a little castle keep at each end. All baked/drawn once and added
    // to the world layer. Real art replaces this in Phase 6.
    private drawBackdrop() {
        const { world, lane, keep, colors } = CONFIG;
        const laneTop = lane.y - lane.thickness / 2;
        const laneBottom = lane.y + lane.thickness / 2;

        // Cheap, GPU-tiled textures for the large areas (grass + dirt).
        this.makeNoiseTexture('tex-grass', 128, colors.grass, [
            { color: colors.grassDark, count: 150, min: 2, max: 6 },
            { color: colors.grassLight, count: 90, min: 1, max: 4 },
        ]);
        this.makeNoiseTexture('tex-dirt', 128, colors.dirt, [
            { color: colors.dirtDark, count: 130, min: 2, max: 7 },
            { color: colors.dirtEdge, count: 60, min: 1, max: 4 },
            { color: colors.rockDark, count: 18, min: 1, max: 3 },
        ]);

        const grass = this.add.tileSprite(0, 0, world.width, world.height, 'tex-grass').setOrigin(0, 0);
        const dirt = this.add.tileSprite(0, laneTop, world.width, lane.thickness, 'tex-dirt').setOrigin(0, 0);
        this.worldLayer.add([grass, dirt]);

        // Everything else is a single static Graphics (modest command count).
        const g = this.add.graphics();
        this.worldLayer.add(g);

        // Soft worn edges along the lane.
        g.fillStyle(colors.dirtEdge, 0.8);
        g.fillRect(0, laneTop - 5, world.width, 5);
        g.fillRect(0, laneBottom, world.width, 5);

        this.scatterDecor(g, laneTop, laneBottom);

        this.drawKeep(g, keep.margin, CONFIG.faction.player.tint);
        this.drawKeep(g, world.width - keep.margin, CONFIG.faction.enemy.tint);

        // Subtle vignette so the world edge is felt, not a hard line.
        g.lineStyle(10, 0x000000, 0.22);
        g.strokeRect(0, 0, world.width, world.height);
    }

    // Bake a small tileable texture: a base fill plus scattered coloured specks.
    private makeNoiseTexture(
        key: string,
        size: number,
        base: number,
        specks: { color: number; count: number; min: number; max: number }[],
    ) {
        if (this.textures.exists(key)) return;
        const g = this.add.graphics();
        g.fillStyle(base, 1).fillRect(0, 0, size, size);
        const rng = new Phaser.Math.RandomDataGenerator([key]);
        for (const s of specks) {
            g.fillStyle(s.color, 1);
            for (let i = 0; i < s.count; i++) {
                const w = rng.between(s.min, s.max);
                const h = rng.between(s.min, s.max);
                g.fillRect(rng.between(0, size - w), rng.between(0, size - h), w, h);
            }
        }
        g.generateTexture(key, size, size);
        g.destroy();
    }

    // Trees, bushes and rocks scattered in the grass margins above and below the lane,
    // kept clear of the keeps. Deterministic (seeded) so it looks the same each run.
    private scatterDecor(g: Phaser.GameObjects.Graphics, laneTop: number, laneBottom: number) {
        const { world, keep } = CONFIG;
        const rng = new Phaser.Math.RandomDataGenerator(['decor']);
        const bands = [
            { lo: 60, hi: laneTop - 60 },
            { lo: laneBottom + 60, hi: world.height - 60 },
        ];
        const keepClear = keep.margin + keep.size;
        for (const band of bands) {
            if (band.hi - band.lo < 40) continue;
            let x = 120;
            while (x < world.width - 120) {
                if (x > keepClear && x < world.width - keepClear) {
                    const y = rng.between(band.lo, band.hi);
                    const roll = rng.frac();
                    if (roll < 0.5) this.drawTree(g, x, y);
                    else if (roll < 0.8) this.drawBush(g, x, y);
                    else this.drawRock(g, x, y);
                }
                x += rng.between(90, 200);
            }
        }
    }

    private drawTree(g: Phaser.GameObjects.Graphics, x: number, y: number) {
        const { colors } = CONFIG;
        g.fillStyle(0x000000, 0.18).fillEllipse(x, y + 3, 38, 14);
        g.fillStyle(colors.trunk, 1).fillRect(x - 4, y - 18, 8, 22);
        g.fillStyle(colors.leafDark, 1).fillCircle(x, y - 30, 21);
        g.fillStyle(colors.leaf, 1).fillCircle(x - 7, y - 35, 14);
    }

    private drawBush(g: Phaser.GameObjects.Graphics, x: number, y: number) {
        const { colors } = CONFIG;
        g.fillStyle(0x000000, 0.15).fillEllipse(x, y + 2, 30, 10);
        g.fillStyle(colors.leafDark, 1).fillCircle(x, y - 6, 12);
        g.fillStyle(colors.leaf, 1).fillCircle(x - 7, y - 8, 8).fillCircle(x + 7, y - 7, 7);
    }

    private drawRock(g: Phaser.GameObjects.Graphics, x: number, y: number) {
        const { colors } = CONFIG;
        g.fillStyle(0x000000, 0.15).fillEllipse(x, y + 2, 28, 9);
        g.fillStyle(colors.rockDark, 1).fillCircle(x, y - 2, 11);
        g.fillStyle(colors.rock, 1).fillCircle(x - 3, y - 5, 7);
    }

    // A small castle keep: walls, crenellations, a gate, and a faction-coloured banner.
    private drawKeep(g: Phaser.GameObjects.Graphics, cx: number, tint: number) {
        const { lane, keep, colors } = CONFIG;
        const w = keep.size;
        const top = lane.y - w * 0.7;
        const bottom = lane.y + w * 0.35;
        const left = cx - w / 2;
        const merlon = w / 7;

        g.fillStyle(0x000000, 0.22).fillEllipse(cx, bottom, w * 1.15, 44);
        g.fillStyle(colors.stone, 1).fillRect(left, top, w, bottom - top);
        g.fillStyle(colors.stoneDark, 1).fillRect(left, bottom - 22, w, 22);
        // Crenellations across the top.
        g.fillStyle(colors.stone, 1);
        for (let i = 0; i < 7; i += 2) g.fillRect(left + i * merlon, top - merlon, merlon, merlon);
        // Gate.
        g.fillStyle(colors.stoneDark, 1).fillRect(cx - merlon * 0.7, bottom - 74, merlon * 1.4, 74);
        // Banner pole + faction flag.
        const poleTop = top - merlon - 64;
        g.fillStyle(colors.trunk, 1).fillRect(cx - 2, poleTop, 4, 66);
        g.fillStyle(tint, 1).fillTriangle(cx + 2, poleTop, cx + 38, poleTop + 10, cx + 2, poleTop + 22);
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
