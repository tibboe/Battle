import * as Phaser from 'phaser';
import { loadTerrainVariants } from '../terrain/tileset';
import { loadEnvironment, registerEnvironmentAnims, SHADOW } from '../terrain/environment';
import { cellIndex, createEmptyMap, MapData, MapFeature, TileId } from '../editor/MapData';
import { getTile, WATER_KEY } from '../editor/tileCatalog';
import { EXPLORER_H, TileExplorer } from '../editor/TileExplorer';
import { MapStore } from '../editor/MapStore';

// The map editor. Paint GROUND tiles (grass hues / water) cell-by-cell and place FEATURES
// (trees, bushes, rocks, cliffs) on top, chosen from a persistent bottom EXPLORER strip you
// scroll left/right. A grid overlay, ✏️ Paint / ✋ Pan modes, an eraser, pinch/wheel zoom, and
// save round it out. The canvas pans/zooms on the main camera; the toolbar + explorer are
// drawn by a separate zoom-1 UI camera so they stay anchored to the screen edges.

const TOP_H = 48;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type Mode = 'paint' | 'pan';

export class EditorScene extends Phaser.Scene {
    private map!: MapData;
    private ts = 64;
    private cells: (Phaser.GameObjects.Image | null)[] = [];
    // A feature cell may hold several sprites (cliffs are a rock body + a grass cap).
    private featureSprites = new Map<number, Phaser.GameObjects.GameObject[]>();
    // Cliff-foot shadows, tracked per cell so they can be re-evaluated when neighbours change.
    private shadowSprites = new Map<number, Phaser.GameObjects.Image>();
    private undoStack: { ground: TileId[]; features: MapFeature[] }[] = [];
    private grid!: Phaser.GameObjects.Graphics;
    private border!: Phaser.GameObjects.Graphics;

    private brush: TileId = 'grass';
    private erasing = false;
    private mode: Mode = 'paint';
    private gridOn = true;

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
            const img = this.add.image(col * this.ts, row * this.ts, def.render.atlas, def.render.frame)
                .setOrigin(0, 0).setDepth(0);
            this.worldLayer.add(img);
            this.cells[i] = img;
        }
        if (commit) {
            this.strokeChanged = true;
            this.markDirty();
            this.refreshShadow(col, row - 1); // changing this cell's ground may toggle the cliff-foot shadow above
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
        const parts: Phaser.GameObjects.GameObject[] = [];
        if (r.anim) {
            const s = this.add.sprite(x, y, r.texture).play(r.anim);
            s.anims.setProgress(Math.random());
            parts.push(s);
        } else {
            parts.push(this.add.image(x, y, r.texture, r.frame));
            if (r.capFrame !== undefined) parts.push(this.add.image(x, y - this.ts, r.texture, r.capFrame));
        }
        for (const o of parts) {
            (o as Phaser.GameObjects.Image).setOrigin(r.originX ?? 0.5, r.originY).setScale(r.scale).setFlipX(!!f.flipX).setDepth(1000 + y);
            this.worldLayer.add(o);
        }
        const i = cellIndex(this.map.cols, f.col, f.row);
        this.clearFeatureAt(i);
        this.featureSprites.set(i, parts);
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
        const sh = this.add.image(x, y + this.ts * 0.5, SHADOW.key)
            .setOrigin(0.5).setScale(0.95, 0.7).setDepth(1000 + y - 2);
        this.worldLayer.add(sh);
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
        this.undoStack.push({ ground: [...this.map.ground], features: this.map.features.map((f) => ({ ...f })) });
        if (this.undoStack.length > 60) this.undoStack.shift();
        this.refreshUndoStyle();
    }

    private undo() {
        const snap = this.undoStack.pop();
        if (!snap) return;
        this.map.ground = snap.ground;
        this.map.features = snap.features;
        this.fullRerender();
        this.markDirty();
        this.refreshUndoStyle();
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
                const cam = this.cameras.main;
                cam.scrollX -= (p.position.x - p.prevPosition.x) / cam.zoom;
                cam.scrollY -= (p.position.y - p.prevPosition.y) / cam.zoom;
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
        this.topBar = this.add.rectangle(0, 0, 10, TOP_H, 0x0e1620, 1).setOrigin(0, 0).setDepth(999).setStrokeStyle(1, 0x2a3543);
        this.menuBtn = this.btn('← Menu', '#33455a', () => this.scene.start('Menu'));
        this.undoBtn = this.btn('↶ Undo', '#33455a', () => this.undo());
        this.eraserBtn = this.btn('🩹 Erase', '#33455a', () => this.toggleEraser());
        this.modeBtn = this.btn('✏️ Paint', '#4a5a33', () => this.toggleMode());
        this.gridBtn = this.btn('# Grid', '#33455a', () => this.toggleGrid());
        this.nameText = this.add.text(0, 0, this.map.name, { fontFamily: 'monospace', fontSize: '16px', color: '#e8f1ff', fontStyle: 'bold' })
            .setOrigin(0.5, 0.5).setDepth(1000).setInteractive({ useHandCursor: true });
        this.nameText.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.rename(); });
        this.saveBtn = this.btn('💾 Save', '#2a8c4a', () => this.save());
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
        for (const b of [this.menuBtn, this.undoBtn, this.eraserBtn, this.modeBtn, this.gridBtn]) {
            b.setPosition(x, cy);
            x += b.width + 6;
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
        this.explorer.setSelected(id);
    }

    private toggleEraser() {
        this.erasing = !this.erasing;
        this.refreshEraserStyle();
    }

    private refreshEraserStyle() {
        this.eraserBtn.setText(this.erasing ? '🩹 Erasing' : '🩹 Erase');
        this.eraserBtn.setBackgroundColor(this.erasing ? '#6a3a3a' : '#33455a');
        this.layoutUI();
    }

    private toggleMode() {
        this.mode = this.mode === 'paint' ? 'pan' : 'paint';
        this.modeBtn.setText(this.mode === 'paint' ? '✏️ Paint' : '✋ Pan');
        this.modeBtn.setBackgroundColor(this.mode === 'paint' ? '#4a5a33' : '#33455a');
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
