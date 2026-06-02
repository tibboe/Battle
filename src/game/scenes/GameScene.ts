import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { CameraController } from '../controls/CameraController';
import { DevPanel } from '../controls/DevPanel';
import { loadProjectiles, loadUnitAtlas, registerUnitAnimations } from '../units/animations';
import { Projectiles } from '../units/Projectiles';
import { Buildings, loadBuildings } from '../structures/buildings';
import { TerrainRenderer } from '../terrain/TerrainRenderer';
import { loadTerrainTileset } from '../terrain/tileset';
import { loadEnvironment, registerEnvironmentAnims } from '../terrain/environment';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';
import { PeasantManager, loadPeasants, registerPeasantAnimations } from '../units/peasants';
import { ResourceStore } from '../economy/ResourceStore';
import { ResourceNodes, loadResourceNodes } from '../economy/ResourceNodes';
import { FloatingText } from '../ui/FloatingText';
import { UnitPanel } from '../ui/UnitPanel';
import { UpgradePanel } from '../ui/UpgradePanel';
import { BuildMenu } from '../ui/BuildMenu';
import { resetUpgrades } from '../upgrades';

// HUD draws above everything (units use world-y as depth, which can exceed 1000).
const HUD_DEPTH = 1_000_000;

// The single scene for Milestone 1. Phases: world + camera + HUD (1), animation
// pipeline (2), pooled horde (3), combat (4), keeps + win/lose + restart (5).
export class GameScene extends Phaser.Scene {
    private cameraController!: CameraController;
    private units!: UnitManager;
    private floatingText!: FloatingText;
    private projectiles!: Projectiles;
    private buildings!: Buildings;
    private unitPanel!: UnitPanel;
    private upgradePanel!: UpgradePanel;
    private buildMenu!: BuildMenu;
    private resources!: ResourceStore;
    private resourceNodes!: ResourceNodes;
    private peasants!: PeasantManager;

    // World objects (backdrop + units) live here and are shown by the main camera.
    private worldLayer!: Phaser.GameObjects.Layer;
    // HUD lives here and is shown by a dedicated UI camera that never zooms/pans.
    private uiLayer!: Phaser.GameObjects.Layer;
    private uiCamera!: Phaser.Cameras.Scene2D.Camera;

    private hudText!: Phaser.GameObjects.Text;
    private fitButton!: Phaser.GameObjects.Text;
    private playerKeepText!: Phaser.GameObjects.Text;
    private enemyKeepText!: Phaser.GameObjects.Text;
    private playerResText!: Phaser.GameObjects.Text;
    private enemyResText!: Phaser.GameObjects.Text;

    private playerKeepHp: number = CONFIG.keep.hp;
    private enemyKeepHp: number = CONFIG.keep.hp;
    private gameOver = false;
    private lastResRev = -1; // last resource revision the HUD/menus rendered

    constructor() {
        super('Game');
    }

    private terrain!: TerrainRenderer;

    preload() {
        loadUnitAtlas(this);
        loadPeasants(this);
        loadProjectiles(this);
        loadBuildings(this);
        loadTerrainTileset(this);
        loadEnvironment(this);
        loadResourceNodes(this);
    }

    create() {
        this.playerKeepHp = CONFIG.keep.hp;
        this.enemyKeepHp = CONFIG.keep.hp;
        this.gameOver = false;
        this.lastResRev = -1;

        // Subtle colour for anything outside the world bounds.
        this.cameras.main.setBackgroundColor(CONFIG.colors.sky);

        // Two layers: the world (zoomed/panned by the main camera) and the HUD (drawn
        // by a separate UI camera so it never zooms or drifts with the world).
        this.worldLayer = this.add.layer();
        this.uiLayer = this.add.layer();

        registerEnvironmentAnims(this);
        this.drawBackdrop();
        registerUnitAnimations(this);
        registerPeasantAnimations(this);
        this.cameraController = new CameraController(this);
        this.buildHud();

        // Dev tuning panel (test tool) — edits CONFIG live; structural changes restart.
        new DevPanel(this, this.uiLayer, () => this.scene.restart());

        // World-space effects: floating numbers + arrow projectiles, above the units.
        this.floatingText = new FloatingText(this, this.worldLayer);
        this.projectiles = new Projectiles(this, this.worldLayer);

        // Both keeps spawn a horde; units that reach the far keep damage it.
        this.units = new UnitManager(
            this,
            this.worldLayer,
            (attacker) => this.onReachKeep(attacker),
            (x, y, amount, color) => this.floatingText.pop(x, y, amount, color),
            (x0, y0, x1, y1, faction) => this.projectiles.fire(x0, y0, x1, y1, faction),
            (x, y, amount) => this.floatingText.pop(x, y, amount, '#7be08a'), // green heals
            (x, y) => this.floatingText.pop(x, y, 'block', '#bcd4e6'), // block indicator
            (x0, y0, x1, y1, faction) =>
                this.projectiles.lob(x0, y0, x1, y1, faction, CONFIG.abilities.longshot.speed,
                    (lx, ly, f) => this.units.resolveLongShotHit(lx, ly, f as Faction)),
        );

        // Per-side stockpiles (created before the UI/buildings that read them). Upgrades are
        // per-match, so clear any carried-over ownership at the start of each match.
        this.resources = new ResourceStore();
        resetUpgrades();

        // Building upgrade popup (opened by tapping a player building) — now charges resources.
        this.upgradePanel = new UpgradePanel(this, this.uiLayer, this.units, this.resources);

        // Buildings: the Castle keeps, the shared-upgrades building, each side's starting
        // buildings, and the empty build slots. Tapping a player producer opens its upgrades;
        // tapping an empty player slot opens the build menu.
        this.buildings = new Buildings(
            this,
            this.worldLayer,
            this.units,
            (kind) => this.upgradePanel.toggle(kind),
            (faction, spot) => this.buildMenu.open(faction, spot),
        );

        // Economy: the harvestable nodes and the peasants that Houses maintain to gather them.
        // Peasants bank at each side's Castle and (Phase 2) build new structures on slots.
        this.resourceNodes = new ResourceNodes(this, this.worldLayer);
        this.peasants = new PeasantManager(this, this.worldLayer, this.resources, this.resourceNodes, this.buildings);

        // The build menu (opened by tapping an empty player slot).
        this.buildMenu = new BuildMenu(this, this.uiLayer, this.buildings, this.resources);

        // Right-edge unit roster/inspector: live counts + tap-for-stats.
        this.unitPanel = new UnitPanel(this, this.uiLayer, this.units);

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

    // The battlefield: a flat grass island on open water (Tiny Swords tileset + decos).
    // The keeps are Castle sprites drawn by the Buildings system (created after the units).
    private drawBackdrop() {
        const { world } = CONFIG;

        this.terrain = new TerrainRenderer(this, this.worldLayer);
        this.terrain.draw();

        // Subtle vignette so the world edge is felt, not a hard line.
        const g = this.add.graphics();
        this.worldLayer.add(g);
        g.lineStyle(10, 0x000000, 0.22);
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

        // Resource stockpiles (Milestone 4): your gathered gold/stone/wood, with the enemy's
        // below it so income is visible on both sides. Top-left, under the FPS line.
        this.playerResText = this.add.text(12, 44, '', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#7fd0ff',
            backgroundColor: '#00000080',
            padding: { x: 8, y: 5 },
        })
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH);

        this.enemyResText = this.add.text(12, 74, '', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#ff8a8a',
            backgroundColor: '#00000080',
            padding: { x: 8, y: 5 },
        })
            .setScrollFactor(0)
            .setDepth(HUD_DEPTH);

        this.uiLayer.add([this.hudText, this.playerKeepText, this.enemyKeepText, this.fitButton,
            this.playerResText, this.enemyResText]);
        this.layoutHud();
    }

    private onResize() {
        this.uiCamera.setSize(this.scale.width, this.scale.height);
        this.layoutHud();
        this.unitPanel.layout();
        this.upgradePanel.layout();
        this.buildMenu.layout();
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
            // Peasants advance any build site before the buildings system checks completion.
            this.peasants.update(delta);
            this.buildings.update(delta);
        }
        this.floatingText.update(delta);
        this.projectiles.update(delta);
        this.unitPanel.update();

        const fps = Math.round(this.game.loop.actualFps);
        this.hudText.setText(`FPS: ${fps}    Units: ${this.units.activeCount}`);
        this.playerKeepText.setText(`You ${this.playerKeepHp}`);
        this.enemyKeepText.setText(`Enemy ${this.enemyKeepHp}`);

        // Stockpiles change only when a peasant banks or you spend — refresh the HUD and any
        // open menu just then (so affordability/greyed-out states stay live).
        if (this.resources.rev !== this.lastResRev) {
            this.lastResRev = this.resources.rev;
            this.playerResText.setText(`You   ${this.resLine(FACTION.player)}`);
            this.enemyResText.setText(`Enemy ${this.resLine(FACTION.enemy)}`);
            this.buildMenu.refresh();
            this.upgradePanel.refresh();
        }
        this.layoutHud();
    }

    private resLine(faction: Faction): string {
        const b = this.resources.bag(faction);
        return `Gold ${b.gold}  Stone ${b.stone}  Wood ${b.wood}`;
    }
}
