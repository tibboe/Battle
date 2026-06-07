import * as Phaser from 'phaser';
import { CONFIG } from '../config';
import { cameraAngle, screenOffset, uprightAngle } from '../controls/billboard';
import { loadTerrainVariants } from '../terrain/tileset';
import { loadEnvironment, registerEnvironmentAnims, SHADOW } from '../terrain/environment';
import { cellIndex, createEmptyMap, MapData, MapFeature, MAX_LEVEL, TileId } from '../editor/MapData';
import { getTile, WATER_KEY } from '../editor/tileCatalog';
import { EXPLORER_H, TileExplorer } from '../editor/TileExplorer';
import { MapStore } from '../editor/MapStore';

// The map editor. Paint GROUND tiles (grass hues / water) cell-by-cell, raise/lower ELEVATION
// tiers, and place FEATURES (trees, bushes, rocks) on top, chosen from a persistent bottom
// EXPLORER strip. The canvas pans/zooms AND rotates 90° (like the game) on the main camera;
// each elevation level sits on its own plane, lifted "up on screen" via screenOffset so it
// reads correctly at any rotation. The toolbar + explorer are drawn by a separate zoom-1 UI
// camera so they stay anchored to the screen edges.

const TOP_H = 48;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

// Depth bands: a higher tier always draws above everything on lower tiers (so high ground
// occludes what's behind it). Within a tier, water < ground < grid < shadow < feature, and
// overlapping things (features/shadows) sort by on-screen Y.
const LEVEL_BAND = 100_000;
const BIAS_GROUND = 0;
const BIAS_SHADOW = 998;
const BIAS_FEATURE = 1000;

type Mode = 'paint' | 'pan';
// Elevation tool: 0 = off (normal tile painting), +1 = raise, -1 = lower.
type ElevTool = 0 | 1 | -1;

// Per-object elevation bookkeeping (stored on the GameObject via setData) so a single pass can
// re-lift / re-billboard / re-depth everything when the camera rotates.
interface ElevData {
    bx: number;     // base (unlifted) world x
    by: number;     // base world y
    lvl: number;    // elevation tier
    bb: boolean;    // billboard upright (features) vs rotate with the world (ground/shadows)
    bias: number;   // depth bias within the tier
    sort: boolean;  // add on-screen-Y to depth (overlapping things)
}

export class EditorScene extends Phaser.Scene {
    private map!: MapData;
    private ts = 64;
    private cells: (Phaser.GameObjects.Image | null)[] = [];
    // A raised cell's ground tile lifts up-screen; this static level-0 grass tile fills the
    // space it vacated so the sea backdrop doesn't show through (a stand-in until P2 rock faces).
    private floorCells = new Map<number, Phaser.GameObjects.Image>();
    // A feature cell may hold several sprites (cliffs are a rock body + a grass cap).
    private featureSprites = new Map<number, Phaser.GameObjects.GameObject[]>();
    // Cliff-foot shadows, tracked per cell so they can be re-evaluated when neighbours change.
    private shadowSprites = new Map<number, Phaser.GameObjects.Image>();
    private undoStack: { ground: TileId[]; levels: number[]; features: MapFeature[] }[] = [];
    private grid!: Phaser.GameObjects.Graphics;
    private border!: Phaser.GameObjects.Graphics;

    private brush: TileId = 'grass';
    private erasing = false;
    private elevTool: ElevTool = 0;
    private mode: Mode = 'paint';
    private gridOn = true;

    // Rotation (mirrors the game's CameraController): 0..3 = 0/90/180/270° clockwise.
    private orientation = 0;
    private isRotating = false;
    private readonly s1 = new Phaser.Math.Vector2();
    private readonly s2 = new Phaser.Math.Vector2();

    private worldLayer!: Phaser.GameObjects.Layer;
    private uiLayer!: Phaser.GameObjects.Layer;
    private uiCamera!: Phaser.Cameras.Scene2D.Camera;
    private explorer!: TileExplorer;

    // Top toolbar.
    private topBar!: Phaser.GameObjects.Rectangle;
    private menuBtn!: Phaser.GameObjects.Text;
    private undoBtn!: Phaser.GameObjects.Text;
    private nameText!: Phaser.GameObjects.Text;
    private saveBtn!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private eraserBtn!: Phaser.GameObjects.Text;
    private modeBtn!: Phaser.GameObjects.Text;
    private gridBtn!: Phaser.GameObjects.Text;
    private raiseBtn!: Phaser.GameObjects.Text;
    private lowerBtn!: Phaser.GameObjects.Text;
    private rotBtn!: Phaser.GameObjects.Text;

    private pinchDist = 0;
    private scrollingExplorer = false;
    private lastExplorerX = 0;
    private painting = false;       // a paint stroke is in progress (an undo snapshot is staged)
    private strokeChanged = false;  // did the current stroke actually change anything?

    constructor() {
        super('Editor');
    }

    preload() {
        loadTerrainVariants(this); // all 5 grass hues (color1 under the 'terrain' key)
        loadEnvironment(this); // water backdrop + tree/bush/rock/… feature art
    }

    create(data: { map?: MapData }) {
        this.map = data?.map ?? createEmptyMap();
        this.ts = this.map.tileSize;
        if (!this.map.levels || this.map.levels.length !== this.map.cols * this.map.rows) {
            this.map.levels = new Array(this.map.cols * this.map.rows).fill(0);
        }
        this.cells = new Array(this.map.cols * this.map.rows).fill(null);
        this.featureSprites.clear();
        registerEnvironmentAnims(this);

        this.cameras.main.setBackgroundColor('#0b1119');
        this.input.addPointer(2);

        this.worldLayer = this.add.layer();
        this.uiLayer = this.add.layer();

        this.drawWaterBackdrop();
        this.renderAllCells();
        this.renderAllFeatures();
        this.drawGridAndBorder();
        this.setupCamera();
        this.buildToolbars();
        this.explorer = new TileExplorer(this, this.uiLayer, (id) => this.selectBrush(id));
        this.explorer.setSelected(this.brush);
        this.setupUiCamera();
        this.layoutUI();

        this.bindInput();
        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    }

    private setupUiCamera() {
        this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.cameras.main.ignore(this.uiLayer);
        this.uiCamera.ignore(this.worldLayer);
    }

    private onResize = () => {
        this.uiCamera.setSize(this.scale.width, this.scale.height);
        this.layoutUI();
    };

    // ── world rendering ────────────────────────────────────────────────────────
    private get mapW() { return this.map.cols * this.ts; }
    private get mapH() { return this.map.rows * this.ts; }
    private cellCentre(col: number, row: number) {
        return { x: col * this.ts + this.ts / 2, y: row * this.ts + this.ts / 2 };
    }

    private get cliffH() { return this.ts; } // on-screen lift per elevation tier (one cell)
    private levelAt(col: number, row: number) { return this.map.levels![cellIndex(this.map.cols, col, row)] | 0; }

    // ── elevation lift / billboard / depth ──────────────────────────────────--
    // Tag a world object with its base position + tier, then place it for the current camera
    // angle. Re-called for everything on each rotation step (relayoutElevation).
    private applyElevation(o: Phaser.GameObjects.GameObject, e: ElevData) {
        o.setData('e', e);
        this.liftObject(o);
    }

    /** On-screen-Y sort key for a base world point at the current camera angle (bigger = nearer
     *  the bottom of the screen = drawn on top). */
    private sortY(bx: number, by: number) {
        const up = screenOffset(this, 0, 1, this.s2); // world vector that points "up on screen"
        return -(bx * up.x + by * up.y);
    }

    private liftObject(o: Phaser.GameObjects.GameObject) {
        const e = o.getData('e') as ElevData | undefined;
        if (!e) return; // grid / border / water — rotate with the camera, fixed depth
        const t = o as unknown as { x: number; y: number; rotation: number; depth: number };
        if (e.lvl > 0) { screenOffset(this, 0, e.lvl * this.cliffH, this.s1); t.x = e.bx + this.s1.x; t.y = e.by + this.s1.y; }
        else { t.x = e.bx; t.y = e.by; }
        t.rotation = e.bb ? uprightAngle(this) : 0;
        t.depth = e.lvl * LEVEL_BAND + e.bias + (e.sort ? this.sortY(e.bx, e.by) : 0);
    }

    /** Re-lift / re-billboard / re-depth every elevation-tagged object (called while rotating). */
    private relayoutElevation() {
        const kids = this.worldLayer.getChildren();
        for (let k = 0; k < kids.length; k++) this.liftObject(kids[k]);
    }

    /** Re-place just one cell's sprites after its tier changes. */
    private reliftCell(col: number, row: number) {
        const i = cellIndex(this.map.cols, col, row);
        const lvl = this.map.levels![i] | 0;
        const setLvl = (o: Phaser.GameObjects.GameObject | undefined) => {
            if (!o) return;
            const e = o.getData('e') as ElevData | undefined;
            if (e) { e.lvl = lvl; this.liftObject(o); }
        };
        setLvl(this.cells[i] ?? undefined);
        for (const o of this.featureSprites.get(i) ?? []) setLvl(o);
        setLvl(this.shadowSprites.get(i));
    }

    // ── rotation (mirrors CameraController.rotateBy) ─────────────────────────--
    private rotateBy(dir: 1 | -1) {
        if (this.isRotating) return;
        const cam = this.cameras.main;
        const pivot = cam.getWorldPoint(this.scale.width / 2, this.scale.height / 2);
        const next = (this.orientation + dir + 4) % 4;
        this.isRotating = true;
        cam.useBounds = false;
        this.tweens.add({
            targets: cam,
            rotation: cameraAngle(this) + dir * Math.PI / 2,
            duration: CONFIG.camera.rotateMs,
            ease: CONFIG.camera.rotateEase,
            onUpdate: () => this.relayoutElevation(),
            onComplete: () => {
                this.orientation = next;
                cam.centerOn(pivot.x, pivot.y);
                cam.useBounds = (next === 0); // bounds clamp is only correct unrotated
                this.isRotating = false;
                this.relayoutElevation();
            },
        });
    }

    private drawWaterBackdrop() {
        const pad = this.ts * 2;
        const sea = this.add
            .tileSprite(-pad, -pad, this.mapW + pad * 2, this.mapH + pad * 2, WATER_KEY)
            .setOrigin(0, 0)
            .setDepth(-100);
        this.worldLayer.add(sea);
    }

    private renderAllCells() {
        for (let row = 0; row < this.map.rows; row++) {
            for (let col = 0; col < this.map.cols; col++) {
                this.setGround(col, row, this.map.ground[cellIndex(this.map.cols, col, row)], false);
            }
        }
    }

    /** Paint one cell's ground tile (data + sprite). */
    private setGround(col: number, row: number, id: TileId, commit = true) {
        const i = cellIndex(this.map.cols, col, row);
        this.map.ground[i] = id;
        const def = getTile(id);
        this.cells[i]?.destroy();
        this.cells[i] = null;
        if (def && def.render.kind === 'ground') {
            const img = this.add.image(col * this.ts, row * this.ts, def.render.atlas, def.render.frame).setOrigin(0, 0);
            this.worldLayer.add(img);
            this.applyElevation(img, { bx: col * this.ts, by: row * this.ts, lvl: this.levelAt(col, row), bb: false, bias: BIAS_GROUND, sort: false });
            this.cells[i] = img;
        }
        this.syncFloor(col, row);
        if (commit) {
            this.strokeChanged = true;
            this.markDirty();
            this.refreshShadow(col, row - 1); // changing this cell's ground may toggle the cliff-foot shadow above
        }
    }

    /** Ensure a raised, grass cell keeps a level-0 grass floor under its lifted top tile. */
    private syncFloor(col: number, row: number) {
        const i = cellIndex(this.map.cols, col, row);
        const def = getTile(this.map.ground[i]);
        const want = (this.map.levels![i] | 0) > 0 && def?.render.kind === 'ground';
        const existing = this.floorCells.get(i);
        if (want && def?.render.kind === 'ground') {
            if (existing) { existing.setTexture(def.render.atlas, def.render.frame); return; }
            const img = this.add.image(col * this.ts, row * this.ts, def.render.atlas, def.render.frame).setOrigin(0, 0);
            this.worldLayer.add(img);
            this.applyElevation(img, { bx: col * this.ts, by: row * this.ts, lvl: 0, bb: false, bias: BIAS_GROUND, sort: false });
            this.floorCells.set(i, img);
        } else if (existing) {
            existing.destroy();
            this.floorCells.delete(i);
        }
    }

    private renderAllFeatures() {
        for (const f of this.map.features) this.spawnFeature(f);
        for (const f of this.map.features) this.refreshShadow(f.col, f.row); // after all are known
    }

    /** Create the sprite(s) for a stored feature (no data change). Cliffs are two cells tall:
     *  a rock body in the cell plus a grass cap one cell above. */
    private spawnFeature(f: MapFeature) {
        const def = getTile(f.tileId);
        if (!def || def.render.kind !== 'feature') return;
        const r = def.render;
        const { x, y } = this.cellCentre(f.col, f.row);
        const lvl = this.levelAt(f.col, f.row);
        // [sprite, baseY] pairs (a cliff cap sits one cell above its body).
        const parts: [Phaser.GameObjects.GameObject, number][] = [];
        if (r.anim) {
            const s = this.add.sprite(x, y, r.texture).play(r.anim);
            s.anims.setProgress(Math.random());
            parts.push([s, y]);
        } else {
            parts.push([this.add.image(x, y, r.texture, r.frame), y]);
            if (r.capFrame !== undefined) parts.push([this.add.image(x, y - this.ts, r.texture, r.capFrame), y - this.ts]);
        }
        for (const [o, by] of parts) {
            (o as Phaser.GameObjects.Image).setOrigin(r.originX ?? 0.5, r.originY).setScale(r.scale).setFlipX(!!f.flipX);
            this.worldLayer.add(o);
            this.applyElevation(o, { bx: x, by, lvl, bb: true, bias: BIAS_FEATURE, sort: true });
        }
        const i = cellIndex(this.map.cols, f.col, f.row);
        this.clearFeatureAt(i);
        this.featureSprites.set(i, parts.map((p) => p[0]));
    }

    private featureAt(col: number, row: number) {
        return this.map.features.find((f) => f.col === col && f.row === row);
    }

    /** A cliff foot casts a shadow only when it's the BOTTOM rock (no cliff continuing below)
     *  and the cell below is land (not open water). */
    private shouldShadow(col: number, row: number): boolean {
        if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return false;
        const f = this.featureAt(col, row);
        if (!f) return false;
        const def = getTile(f.tileId);
        if (!def || def.render.kind !== 'feature' || !def.render.shadow) return false;
        const br = row + 1;
        if (br < this.map.rows) {
            if (this.map.ground[cellIndex(this.map.cols, col, br)] === 'water') return false; // foot in water
            const below = this.featureAt(col, br);
            if (below && below.tileId.startsWith('cliff-')) return false; // wall continues — not the foot
        }
        return true;
    }

    /** Re-evaluate (add/remove) the shadow for one cell. */
    private refreshShadow(col: number, row: number) {
        if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return;
        const i = cellIndex(this.map.cols, col, row);
        this.shadowSprites.get(i)?.destroy();
        this.shadowSprites.delete(i);
        if (!this.shouldShadow(col, row)) return;
        const { x, y } = this.cellCentre(col, row);
        const sh = this.add.image(x, y + this.ts * 0.5, SHADOW.key).setOrigin(0.5).setScale(0.95, 0.7);
        this.worldLayer.add(sh);
        this.applyElevation(sh, { bx: x, by: y + this.ts * 0.5, lvl: this.levelAt(col, row), bb: false, bias: BIAS_SHADOW, sort: true });
        this.shadowSprites.set(i, sh);
    }

    private clearFeatureAt(i: number) {
        const arr = this.featureSprites.get(i);
        if (arr) { for (const o of arr) o.destroy(); this.featureSprites.delete(i); }
    }

    private placeFeature(col: number, row: number, id: TileId) {
        const existing = this.map.features.find((f) => f.col === col && f.row === row);
        if (existing && existing.tileId === id) return; // already there — avoid drag churn
        this.map.features = this.map.features.filter((f) => !(f.col === col && f.row === row));
        // Mirror organic props (trees/bushes) for variety, but never directional cliff frames.
        const def = getTile(id);
        const directional = def?.render.kind === 'feature' && def.render.frame !== undefined;
        const f: MapFeature = { tileId: id, col, row, flipX: !directional && Math.random() < 0.5 };
        this.map.features.push(f);
        this.spawnFeature(f);
        this.refreshShadow(col, row);
        this.refreshShadow(col, row - 1); // the piece above is no longer the foot
        this.strokeChanged = true;
        this.markDirty();
    }

    private eraseFeature(col: number, row: number) {
        const i = cellIndex(this.map.cols, col, row);
        const before = this.map.features.length;
        this.map.features = this.map.features.filter((f) => !(f.col === col && f.row === row));
        this.clearFeatureAt(i);
        this.refreshShadow(col, row);     // remove this cell's shadow (no feature now)
        this.refreshShadow(col, row - 1); // the piece above may now be the foot
        if (this.map.features.length !== before) { this.strokeChanged = true; this.markDirty(); }
    }

    /** Tear down every sprite and rebuild from the map (used by undo). */
    private fullRerender() {
        for (const c of this.cells) c?.destroy();
        this.cells = new Array(this.map.cols * this.map.rows).fill(null);
        for (const f of this.floorCells.values()) f.destroy();
        this.floorCells.clear();
        for (const arr of this.featureSprites.values()) for (const o of arr) o.destroy();
        this.featureSprites.clear();
        for (const s of this.shadowSprites.values()) s.destroy();
        this.shadowSprites.clear();
        this.renderAllCells();
        this.renderAllFeatures();
    }

    // ── undo ───────────────────────────────────────────────────────────────--
    /** Snapshot the map before a mutating stroke (one entry per stroke, capped). */
    private pushUndo() {
        this.undoStack.push({ ground: [...this.map.ground], levels: [...this.map.levels!], features: this.map.features.map((f) => ({ ...f })) });
        if (this.undoStack.length > 60) this.undoStack.shift();
        this.refreshUndoStyle();
    }

    private undo() {
        const snap = this.undoStack.pop();
        if (!snap) return;
        this.map.ground = snap.ground;
        this.map.levels = snap.levels;
        this.map.features = snap.features;
        this.fullRerender();
        this.markDirty();
        this.refreshUndoStyle();
    }

    /** Raise/lower one cell's elevation tier and re-place its sprites. */
    private adjustLevel(col: number, row: number, d: number) {
        const i = cellIndex(this.map.cols, col, row);
        const cur = this.map.levels![i] | 0;
        const next = Phaser.Math.Clamp(cur + d, 0, MAX_LEVEL);
        if (next === cur) return;
        this.map.levels![i] = next;
        this.reliftCell(col, row);
        this.syncFloor(col, row);
        this.strokeChanged = true;
        this.markDirty();
    }

    private refreshUndoStyle() {
        const has = this.undoStack.length > 0;
        this.undoBtn.setColor(has ? '#ffffff' : '#7a8a99').setAlpha(has ? 1 : 0.7);
    }

    private drawGridAndBorder() {
        this.grid = this.add.graphics().setDepth(100);
        this.grid.lineStyle(1, 0xffffff, 0.18);
        for (let c = 0; c <= this.map.cols; c++) this.grid.lineBetween(c * this.ts, 0, c * this.ts, this.mapH);
        for (let r = 0; r <= this.map.rows; r++) this.grid.lineBetween(0, r * this.ts, this.mapW, r * this.ts);
        this.grid.setVisible(this.gridOn);

        this.border = this.add.graphics().setDepth(101);
        this.border.lineStyle(2, 0x7fd0ff, 0.9).strokeRect(0, 0, this.mapW, this.mapH);
        this.worldLayer.add([this.grid, this.border]);
    }

    // ── camera ───────────────────────────────────────────────────────────────
    private setupCamera() {
        const cam = this.cameras.main;
        const pad = this.ts * 3;
        cam.setBounds(-pad, -pad, this.mapW + pad * 2, this.mapH + pad * 2);
        const zoom = Math.min(
            this.scale.width / (this.mapW + this.ts * 2),
            (this.scale.height - TOP_H - EXPLORER_H) / (this.mapH + this.ts * 2),
        );
        cam.setZoom(Phaser.Math.Clamp(zoom, ZOOM_MIN, ZOOM_MAX));
        cam.centerOn(this.mapW / 2, this.mapH / 2);
    }

    private zoomAt(factor: number, sx: number, sy: number) {
        const cam = this.cameras.main;
        const z = Phaser.Math.Clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        const before = cam.getWorldPoint(sx, sy);
        cam.setZoom(z);
        const after = cam.getWorldPoint(sx, sy);
        cam.scrollX += before.x - after.x;
        cam.scrollY += before.y - after.y;
    }

    // ── input ──────────────────────────────────────────────────────────────--
    private overToolbar(y: number) {
        return y < TOP_H || this.explorer.contains(y);
    }

    private cellAt(sx: number, sy: number): { col: number; row: number } | null {
        const w = this.cameras.main.getWorldPoint(sx, sy);
        const col = Math.floor(w.x / this.ts);
        const row = Math.floor(w.y / this.ts);
        if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return null;
        return { col, row };
    }

    private paintAt(sx: number, sy: number) {
        const cell = this.cellAt(sx, sy);
        if (!cell) return;
        if (this.elevTool !== 0) { this.adjustLevel(cell.col, cell.row, this.elevTool); return; }
        if (this.erasing) { this.eraseFeature(cell.col, cell.row); return; }
        const def = getTile(this.brush);
        if (!def) return;
        if (def.render.kind === 'feature') {
            this.placeFeature(cell.col, cell.row, this.brush);
        } else {
            const i = cellIndex(this.map.cols, cell.col, cell.row);
            if (this.map.ground[i] !== this.brush) this.setGround(cell.col, cell.row, this.brush);
        }
    }

    private bindInput() {
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            if (p.y < TOP_H) return; // top toolbar buttons handle themselves
            if (this.explorer.contains(p.y)) { this.scrollingExplorer = true; this.lastExplorerX = p.x; return; }
            if (this.mode === 'paint' && !this.twoFingers()) {
                this.painting = true;
                this.strokeChanged = false;
                this.pushUndo();
                this.paintAt(p.x, p.y);
            }
        });

        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            const p1 = this.input.pointer1;
            const p2 = this.input.pointer2;
            if (p1.isDown && p2.isDown) {
                const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
                if (this.pinchDist > 0 && dist > 0) this.zoomAt(dist / this.pinchDist, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
                this.pinchDist = dist;
                return;
            }
            this.pinchDist = 0;
            if (this.scrollingExplorer && p.isDown) {
                this.explorer.scrollBy(p.x - this.lastExplorerX);
                this.lastExplorerX = p.x;
                return;
            }
            if (!p.isDown || this.overToolbar(p.y)) return;
            if (this.mode === 'paint') {
                this.paintAt(p.x, p.y);
            } else {
                // Drag-pan: rotate the screen delta back into world axes so it tracks the finger
                // at any camera orientation (collapses to the plain delta at orientation 0).
                const cam = this.cameras.main;
                const dx = p.position.x - p.prevPosition.x;
                const dy = p.position.y - p.prevPosition.y;
                const cos = Math.cos(-cameraAngle(this));
                const sin = Math.sin(-cameraAngle(this));
                cam.scrollX -= (dx * cos - dy * sin) / cam.zoom;
                cam.scrollY -= (dx * sin + dy * cos) / cam.zoom;
            }
        });

        this.input.on('pointerup', () => {
            this.pinchDist = 0;
            this.scrollingExplorer = false;
            // Discard the staged undo snapshot if the stroke changed nothing (no-op tap/drag).
            if (this.painting) {
                this.painting = false;
                if (!this.strokeChanged) { this.undoStack.pop(); this.refreshUndoStyle(); }
            }
        });
        this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
            if (this.explorer.contains(p.y)) this.explorer.scrollBy(dy > 0 ? -PITCH_WHEEL : PITCH_WHEEL);
            else this.zoomAt(dy > 0 ? 0.9 : 1.1, p.x, p.y);
        });
    }

    private twoFingers() { return this.input.pointer1.isDown && this.input.pointer2.isDown; }

    // ── top toolbar ────────────────────────────────────────────────────────--
    private btn(text: string, bg: string, onTap: () => void) {
        const t = this.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', backgroundColor: bg, padding: { x: 10, y: 6 },
        }).setOrigin(0, 0.5).setDepth(1000).setInteractive({ useHandCursor: true });
        t.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) onTap(); });
        this.uiLayer.add(t);
        return t;
    }

    private buildToolbars() {
        // Compact icon buttons (active state shown by colour) so the whole toolbar fits.
        this.topBar = this.add.rectangle(0, 0, 10, TOP_H, 0x0e1620, 1).setOrigin(0, 0).setDepth(999).setStrokeStyle(1, 0x2a3543);
        this.menuBtn = this.btn('←', '#33455a', () => this.scene.start('Menu'));
        this.undoBtn = this.btn('↶', '#33455a', () => this.undo());
        this.modeBtn = this.btn('✏️', '#4a5a33', () => this.toggleMode());
        this.eraserBtn = this.btn('🩹', '#33455a', () => this.toggleEraser());
        this.raiseBtn = this.btn('▲', '#33455a', () => this.toggleElev(1));
        this.lowerBtn = this.btn('▼', '#33455a', () => this.toggleElev(-1));
        this.gridBtn = this.btn('#', '#33455a', () => this.toggleGrid());
        this.rotBtn = this.btn('⟳', '#33455a', () => this.rotateBy(1));
        this.nameText = this.add.text(0, 0, this.map.name, { fontFamily: 'monospace', fontSize: '15px', color: '#e8f1ff', fontStyle: 'bold' })
            .setOrigin(0.5, 0.5).setDepth(1000).setInteractive({ useHandCursor: true });
        this.nameText.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.rename(); });
        this.saveBtn = this.btn('💾', '#2a8c4a', () => this.save());
        this.statusText = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#8aa0b5' }).setOrigin(1, 0.5).setDepth(1000);
        this.uiLayer.add([this.topBar, this.nameText, this.statusText]);
        this.refreshUndoStyle();
    }

    private layoutUI = () => {
        const w = this.scale.width;
        const h = this.scale.height;
        const cy = TOP_H / 2;
        this.topBar.setPosition(0, 0).setSize(w, TOP_H);

        let x = 8;
        // nav | edit tools | view, with a small gap between groups.
        const groups: Phaser.GameObjects.Text[][] = [
            [this.menuBtn, this.undoBtn],
            [this.modeBtn, this.eraserBtn, this.raiseBtn, this.lowerBtn],
            [this.gridBtn, this.rotBtn],
        ];
        for (const g of groups) {
            for (const b of g) { b.setPosition(x, cy); x += b.width + 5; }
            x += 10;
        }
        this.saveBtn.setPosition(w - this.saveBtn.width - 10, cy);
        this.statusText.setPosition(this.saveBtn.x - 10, cy);
        this.nameText.setPosition((x + this.saveBtn.x) / 2, cy);

        this.explorer?.layout(w, h);
    };

    // ── selection / toggles ────────────────────────────────────────────────────
    private selectBrush(id: TileId) {
        this.brush = id;
        if (this.erasing) { this.erasing = false; this.refreshEraserStyle(); }
        if (this.elevTool !== 0) { this.elevTool = 0; this.refreshElevStyle(); }
        this.explorer.setSelected(id);
    }

    private toggleEraser() {
        this.erasing = !this.erasing;
        if (this.erasing && this.elevTool !== 0) { this.elevTool = 0; this.refreshElevStyle(); }
        this.refreshEraserStyle();
    }

    /** Raise/lower elevation tool: tapping the active one turns it off (back to tile painting). */
    private toggleElev(d: 1 | -1) {
        this.elevTool = this.elevTool === d ? 0 : d;
        if (this.elevTool !== 0) {
            if (this.erasing) { this.erasing = false; this.refreshEraserStyle(); }
            if (this.mode !== 'paint') this.toggleMode(); // elevation needs paint (drag-to-edit)
        }
        this.refreshElevStyle();
    }

    private refreshElevStyle() {
        this.raiseBtn.setBackgroundColor(this.elevTool === 1 ? '#2a6c8c' : '#33455a');
        this.lowerBtn.setBackgroundColor(this.elevTool === -1 ? '#2a6c8c' : '#33455a');
        this.layoutUI();
    }

    private refreshEraserStyle() {
        this.eraserBtn.setBackgroundColor(this.erasing ? '#6a3a3a' : '#33455a');
    }

    private toggleMode() {
        this.mode = this.mode === 'paint' ? 'pan' : 'paint';
        this.modeBtn.setText(this.mode === 'paint' ? '✏️' : '✋');
        this.modeBtn.setBackgroundColor(this.mode === 'paint' ? '#4a5a33' : '#5a4a33');
        this.layoutUI();
    }

    private toggleGrid() {
        this.gridOn = !this.gridOn;
        this.grid.setVisible(this.gridOn);
        this.gridBtn.setColor(this.gridOn ? '#ffffff' : '#7a8a99');
    }

    private markDirty() {
        this.statusText.setText('● unsaved').setColor('#ffcf6a');
    }

    private rename() {
        const name = window.prompt('Map name:', this.map.name);
        if (name && name.trim()) {
            this.map.name = name.trim();
            this.nameText.setText(this.map.name);
            this.markDirty();
        }
    }

    private async save() {
        this.statusText.setText('saving…').setColor('#8aa0b5');
        const res = await MapStore.save(this.map);
        this.statusText.setText(res.server ? '✓ saved (server)' : '✓ saved (local only)')
            .setColor(res.server ? '#8fe388' : '#ffcf6a');
    }
}

// Wheel scroll step for the explorer strip (one chip pitch-ish).
const PITCH_WHEEL = 60;
