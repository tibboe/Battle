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
import { PlayerLevel } from '../progression/PlayerLevel';
import {
    choosePerk, draftOptions, luBulwark, luKeepHpBonus, resetPerks,
} from '../progression/LevelUpgrades';
import { LevelUpModal, UpgradesPanel } from '../ui/LevelUp';
import { ResourceNodes, loadResourceNodes } from '../economy/ResourceNodes';
import { FloatingText } from '../ui/FloatingText';
import { UnitPanel } from '../ui/UnitPanel';
import { SelectionHud } from '../ui/SelectionHud';
import { SkillBar } from '../ui/SkillBar';
import { CommandBar } from '../ui/CommandBar';
import { TargetingMode } from '../units/commands';
import { Hud, loadHud } from '../ui/Hud';
import { Abilities } from '../abilities/Abilities';
import { EnemyAI } from '../ai/EnemyAI';
import { resetUpgrades } from '../upgrades';
import { matchStats, submitMatch } from '../stats/MatchStats';

// The win/lose overlay sits above the whole HUD (which uses ~1_000_000) and the popups.
const OVERLAY_DEPTH = 1_000_100;

// The single scene for Milestone 1. Phases: world + camera + HUD (1), animation
// pipeline (2), pooled horde (3), combat (4), keeps + win/lose + restart (5).
export class GameScene extends Phaser.Scene {
    private cameraController!: CameraController;
    private units!: UnitManager;
    private floatingText!: FloatingText;
    private projectiles!: Projectiles;
    private buildings!: Buildings;
    private unitPanel!: UnitPanel;
    private selectionHud!: SelectionHud;
    private skillBar!: SkillBar;
    private commandBar!: CommandBar;
    private abilities!: Abilities;
    private devPanel!: DevPanel;
    private hud!: Hud;
    private resources!: ResourceStore;
    private playerLevel!: PlayerLevel; // per-match XP/leveling (fresh each match)
    private levelUpModal!: LevelUpModal;   // the "choose 1 of 3" draft (pauses the battle)
    private upgradesPanel!: UpgradesPanel; // the review screen (list of chosen perks)
    private levelUpQueue = 0;              // pending level-up choices (≥1 means the battle is paused)
    private resourceNodes!: ResourceNodes;
    private peasants!: PeasantManager;
    private enemyAI!: EnemyAI;

    // Field targeting (shared by skills and unit commands): when a mode is active, the next field
    // tap commits it at that point; a full-field overlay captures the tap, a drag still pans.
    private targeting?: TargetingMode;
    private armedSkill?: string;
    private targetCatcher!: Phaser.GameObjects.Rectangle;
    private targetRing!: Phaser.GameObjects.Arc;

    // World objects (backdrop + units) live here and are shown by the main camera.
    private worldLayer!: Phaser.GameObjects.Layer;
    // HUD lives here and is shown by a dedicated UI camera that never zooms/pans.
    private uiLayer!: Phaser.GameObjects.Layer;
    private uiCamera!: Phaser.Cameras.Scene2D.Camera;

    private playerKeepHp: number = CONFIG.keep.hp;
    private enemyKeepHp: number = CONFIG.keep.hp;
    private playerKeepMaxHp: number = CONFIG.keep.hp; // grows with the Fortify perk
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
        loadHud(this);
    }

    create() {
        this.playerKeepHp = CONFIG.keep.hp;
        this.enemyKeepHp = CONFIG.keep.hp;
        this.playerKeepMaxHp = CONFIG.keep.hp; // reset Fortify (Phaser reuses the scene instance)
        this.levelUpQueue = 0;
        this.gameOver = false;
        this.lastResRev = -1;
        matchStats.reset(); // begin recording this match's stats

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

        // Player-facing HUD (resources, Castle health bars, Fit + a Dev toggle). The Dev toggle
        // shows/hides the builder tools (tuning panel, unit inspector, debug line).
        this.hud = new Hud(
            this,
            this.uiLayer,
            () => this.cameraController.fitToMap(),
            (on) => this.setDevTools(on),
            (res) => this.peasants.enqueueFocus(FACTION.player, res),
            () => this.peasants.clearFocus(FACTION.player),
            () => this.upgradesPanel.toggle(this.playerLevel.level),
        );

        // Dev tuning panel (test tool) — edits CONFIG live; structural changes restart.
        this.devPanel = new DevPanel(this, this.uiLayer, () => this.scene.restart());

        // World-space effects: floating numbers + arrow projectiles, above the units.
        this.floatingText = new FloatingText(this, this.worldLayer);
        this.projectiles = new Projectiles(this, this.worldLayer);

        // Per-match player progression (XP from kills → levels). Fresh each match.
        this.playerLevel = new PlayerLevel();
        // Level-up perk overlays: the draft modal (pauses on pick) and the review panel.
        this.levelUpModal = new LevelUpModal(this, this.uiLayer, (key, mult) => this.onPickPerk(key, mult));
        this.upgradesPanel = new UpgradesPanel(this, this.uiLayer);

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
            (faction, type, x, y) => this.onUnitKilled(faction, type, x, y),
        );

        // Per-side stockpiles (created before the UI/buildings that read them). Upgrades are
        // per-match, so clear any carried-over ownership at the start of each match.
        this.resources = new ResourceStore();
        resetUpgrades();
        resetPerks(); // level-up perks are per-match, like the building upgrades

        // Buildings: the Castle keeps, each side's starting buildings, and the empty build slots.
        // Tapping a player building/slot selects it; the SelectionHud (below) shows its options.
        this.buildings = new Buildings(
            this,
            this.worldLayer,
            this.units,
            this.resources,
            (tag, x, y) => { this.commandBar.clearSelection(); this.selectionHud.selectUpgrades(tag, x, y); },
            (faction, spot, x, y) => { this.commandBar.clearSelection(); this.selectionHud.selectBuild(faction, spot, x, y); },
        );

        // Units flow around building footprints (keeps excluded, so they can still be sacked).
        this.units.setObstacleProvider(() => this.buildings.obstacles());

        // Unified bottom selection HUD (replaces the old upgrade + build popups).
        this.selectionHud = new SelectionHud(this, this.uiLayer, this.worldLayer, this.units, this.resources, this.buildings);

        // Player-cast skills: the manager (cooldowns + the arrow rain) and the left-edge dock.
        this.abilities = new Abilities(this, this.worldLayer, this.projectiles, this.units, this.resources);
        this.skillBar = new SkillBar(this, this.uiLayer, (key) => this.toggleSkillTargeting(key));

        // Player unit command system (selection + the bottom command bar + selection rings).
        // Selecting units and selecting a building are mutually exclusive, so each clears the other.
        this.commandBar = new CommandBar(
            this, this.uiLayer, this.worldLayer, this.units,
            (mode) => this.beginTargeting(mode),
            () => this.cancelTargeting(),
            () => this.selectionHud.clear(),
        );

        // Tap blank ground to clear any selection (a tap, not a camera-drag).
        const catcher = this.add.rectangle(0, 0, CONFIG.world.width, CONFIG.world.height, 0x000000, 0.001)
            .setOrigin(0, 0).setDepth(-100).setInteractive();
        this.worldLayer.add(catcher);
        catcher.on('pointerup', (p: Phaser.Input.Pointer) => {
            if (p.getDistance() >= 14) return;
            this.selectionHud.clear();
            this.commandBar.clearSelection();
        });

        // Targeting overlay: while a skill or a unit command is being placed, a full-field overlay
        // (above units/buildings) captures the placement tap; a drag still pans the camera. The
        // golden ring is the skill preview; unit-command previews are drawn by the CommandBar.
        this.targetRing = this.add.circle(0, 0, CONFIG.abilities.arrowVolley.radius)
            .setStrokeStyle(3, 0xffe08a, 0.9).setFillStyle(0xffe08a, 0.08)
            .setDepth(CONFIG.world.height + 2500).setVisible(false);
        this.worldLayer.add(this.targetRing);
        this.targetCatcher = this.add.rectangle(0, 0, CONFIG.world.width, CONFIG.world.height, 0x000000, 0.001)
            .setOrigin(0, 0).setDepth(CONFIG.world.height + 2400).setVisible(false);
        this.worldLayer.add(this.targetCatcher);
        this.targetCatcher.disableInteractive();
        this.targetCatcher.on('pointerup', (p: Phaser.Input.Pointer) => {
            if (!this.targeting || p.getDistance() >= 14) return; // a drag is a pan — stay armed
            const wp = this.cameras.main.getWorldPoint(p.x, p.y);
            const mode = this.targeting;
            this.targeting = undefined;
            this.targetCatcher.disableInteractive().setVisible(false);
            mode.onCommit(wp.x, wp.y);
        });
        // While targeting, route pointer drags to the active mode's preview.
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (!this.targeting) return;
            const wp = this.cameras.main.getWorldPoint(p.x, p.y);
            this.targeting.onMove(wp.x, wp.y);
        });

        // Economy: the harvestable nodes and the peasants that Houses maintain to gather them.
        // Peasants bank at each side's Castle and (Phase 2) build new structures on slots.
        this.resourceNodes = new ResourceNodes(this, this.worldLayer);
        this.peasants = new PeasantManager(this, this.worldLayer, this.resources, this.resourceNodes, this.buildings, this.units);

        // The enemy's scripted build economy (spends its gathered income on a build order).
        this.enemyAI = new EnemyAI(this.buildings, this.resources);

        // Right-edge unit roster: live counts, tap a type to select it for commands, "All" to
        // select everything. The ✎ stat-editing card stays behind the Dev toggle.
        this.unitPanel = new UnitPanel(
            this, this.uiLayer, this.units,
            (i) => this.commandBar.toggleType(i),
            () => this.commandBar.selectAll(),
            (i) => this.commandBar.isTypeSelected(i),
        );

        // Apply the remembered Dev-tools visibility now that the panels exist.
        this.setDevTools(this.hud.devOn);

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
            // The Iron Gate perk softens each breach against your Castle (min 1 damage).
            const dmg = Math.max(1, CONFIG.keep.damagePerUnit - luBulwark());
            this.playerKeepHp = Math.max(0, this.playerKeepHp - dmg);
            if (this.playerKeepHp === 0) this.endGame(false);
        }
    }

    // A unit died: if it was an enemy, the player earns its experience. Each level gained
    // queues a perk-draft choice; the queue pauses the battle until it's emptied.
    private onUnitKilled(faction: Faction, type: number, x: number, y: number) {
        if (this.gameOver || faction !== FACTION.enemy) return;
        const xp = CONFIG.unitTypes[type].xp ?? 0;
        const levels = this.playerLevel.gain(xp);
        if (levels > 0) {
            this.floatingText.pop(x, y, 'LEVEL UP!', '#ffe08a');
            this.levelUpQueue += levels;
            if (!this.levelUpModal.isOpen) this.openNextLevelUp();
        }
    }

    // True while a level-up choice is pending — the battle is frozen behind the modal.
    private get isLevelUpPaused(): boolean {
        return this.levelUpQueue > 0;
    }

    // Present the next pending level-up draft (3 random non-maxed perks, each with a luck roll).
    private openNextLevelUp() {
        if (this.levelUpQueue <= 0) return;
        // The level this particular choice corresponds to (handles multi-level kills in order).
        const forLevel = this.playerLevel.level - this.levelUpQueue + 1;
        const options = draftOptions(3);
        if (options.length === 0) { this.levelUpQueue = 0; return; } // everything maxed — resume
        this.levelUpModal.open(forLevel, options);
    }

    // The player picked a perk: apply it `mult` times (luck multiplier), recompute dependent
    // stats, then advance/close the queue.
    private onPickPerk(key: string, mult: number) {
        for (let k = 0; k < mult; k++) choosePerk(key);
        this.units.recomputeUpgrades(); // fold the new perk level into unit stat bonuses

        // Fortify raises the Castle's max HP and repairs it by the same amount on each pick.
        const newMax = CONFIG.keep.hp + luKeepHpBonus();
        this.playerKeepHp += Math.max(0, newMax - this.playerKeepMaxHp);
        this.playerKeepMaxHp = newMax;

        this.levelUpModal.close();
        this.levelUpQueue = Math.max(0, this.levelUpQueue - 1);
        if (this.levelUpQueue > 0) this.openNextLevelUp(); // more levels banked — keep drafting
    }

    private endGame(playerWon: boolean) {
        this.gameOver = true;

        // Record + ship this match's stats (best-effort; never blocks the end-of-game flow).
        if (matchStats.isActive()) {
            const summary = matchStats.finish(playerWon ? 0 : 1, this.playerKeepHp, this.enemyKeepHp);
            void submitMatch(summary);
        }

        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        const dim = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(OVERLAY_DEPTH);

        const title = this.add.text(cx, cy - 50, playerWon ? 'VICTORY' : 'DEFEAT', {
            fontFamily: 'monospace',
            fontSize: '64px',
            color: playerWon ? '#7fd0ff' : '#ff8a8a',
            fontStyle: 'bold',
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(OVERLAY_DEPTH + 1);

        const restart = this.add.text(cx, cy + 40, '↻ Restart', {
            fontFamily: 'monospace',
            fontSize: '28px',
            color: '#ffffff',
            backgroundColor: '#2a6cd6',
            padding: { x: 18, y: 12 },
        })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(OVERLAY_DEPTH + 1)
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

    // Show/hide the builder tools (tuning panel + unit inspector), driven by the HUD's Dev
    // toggle. The HUD owns its own debug line's visibility.
    private setDevTools(on: boolean) {
        this.devPanel.setVisible(on);
        this.unitPanel.setDevEdit(on); // the roster stays player-visible; only the ✎ editor hides
    }

    // ---- Field targeting (shared by skills + unit commands) ----

    // Arm a targeting mode: show the capture overlay and route the next field tap to it. Arming a
    // new mode cancels any prior one.
    beginTargeting(mode: TargetingMode) {
        if (this.targeting) this.targeting.onCancel();
        this.targeting = mode;
        this.targetCatcher.setVisible(true).setInteractive();
    }

    private cancelTargeting() {
        if (this.targeting) this.targeting.onCancel();
        this.targeting = undefined;
        this.targetCatcher.disableInteractive().setVisible(false);
    }

    // Tapping a skill arms its targeting; tapping the same armed skill again cancels. Won't arm a
    // skill that is still cooling down.
    private toggleSkillTargeting(key: string) {
        if (this.armedSkill === key) {
            this.cancelTargeting();
            return;
        }
        if (!this.skillReady(key)) return;
        this.armedSkill = key;
        this.skillBar.setArmed(key);
        this.targetRing.setRadius(this.skillRadius(key)).setVisible(true);
        this.beginTargeting({
            onMove: (wx, wy) => this.targetRing.setPosition(wx, wy),
            onCommit: (wx, wy) => { this.castSkill(key, wx, wy); this.disarmSkill(); },
            onCancel: () => this.disarmSkill(),
        });
    }

    private skillReady(key: string): boolean {
        if (key === 'arrowVolley') return this.abilities.volleyReady;
        if (key === 'mercenaries') return this.abilities.mercReady;
        return false;
    }

    private skillRadius(key: string): number {
        return key === 'mercenaries' ? CONFIG.abilities.mercenaries.spread : CONFIG.abilities.arrowVolley.radius;
    }

    private castSkill(key: string, x: number, y: number) {
        if (key === 'arrowVolley') this.abilities.castArrowVolley(FACTION.player, x, y);
        else if (key === 'mercenaries') this.abilities.castMercenaries(FACTION.player, x, y);
    }

    private disarmSkill() {
        this.armedSkill = undefined;
        this.skillBar.setArmed(undefined);
        this.targetRing.setVisible(false);
    }

    private onResize() {
        this.uiCamera.setSize(this.scale.width, this.scale.height);
        this.hud.layout();
        this.unitPanel.layout();
        this.selectionHud.layout();
        this.skillBar.layout();
        this.commandBar.layout();
        this.cameraController.handleResize();
    }

    update(_time: number, delta: number) {
        // The battle freezes while a level-up choice is pending (the modal is up).
        const frozen = this.gameOver || this.isLevelUpPaused;
        if (!frozen) {
            this.enemyAI.update(delta);
            this.units.update(delta);
            matchStats.tickPeak(this.units.livingCount(FACTION.player), this.units.livingCount(FACTION.enemy));
            // Peasants advance any build site before the buildings system checks completion.
            this.peasants.update(delta);
            this.buildings.update(delta);
        }
        if (!frozen) this.abilities.update(delta);
        this.floatingText.update(delta);
        this.projectiles.update(delta);
        this.unitPanel.update();
        this.commandBar.update();
        this.skillBar.update({
            arrowVolley: {
                ready: this.abilities.volleyReady,
                frac: this.abilities.volleyCooldownFrac,
                seconds: this.abilities.volleyCooldownSeconds,
            },
            mercenaries: {
                ready: this.abilities.mercReady,
                frac: this.abilities.mercCooldownFrac,
                seconds: this.abilities.mercCooldownSeconds,
            },
        });

        this.hud.update({
            fps: Math.round(this.game.loop.actualFps),
            units: this.units.activeCount,
            player: this.resources.bag(FACTION.player),
            enemy: this.resources.bag(FACTION.enemy),
            playerHp: this.playerKeepHp,
            enemyHp: this.enemyKeepHp,
            playerMaxHp: this.playerKeepMaxHp,
            enemyMaxHp: CONFIG.keep.hp,
            playerLevel: this.playerLevel.level,
            playerXp: this.playerLevel.xpIntoLevel,
            playerXpForLevel: this.playerLevel.xpForLevel(this.playerLevel.level),
            workers: {
                gold: this.peasants.workerCount(FACTION.player, 'gold'),
                wood: this.peasants.workerCount(FACTION.player, 'wood'),
                stone: this.peasants.workerCount(FACTION.player, 'stone'),
                food: this.peasants.workerCount(FACTION.player, 'food'),
            },
            focus: this.peasants.focusList(FACTION.player),
        });

        // When the stockpile changes (a peasant banks, or you spend), refresh any open menu so
        // its affordability / greyed-out states stay live.
        if (this.resources.rev !== this.lastResRev) {
            this.lastResRev = this.resources.rev;
            this.selectionHud.refresh();
        }
    }
}
