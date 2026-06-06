import * as Phaser from 'phaser';
import { loadTerrainVariants } from '../terrain/tileset';
import { loadEnvironment, registerEnvironmentAnims } from '../terrain/environment';
import { cellIndex, createEmptyMap, MapData, MapFeature, TileId } from '../editor/MapData';
import { getTile, makeTileThumb, WATER_KEY } from '../editor/tileCatalog';
import { TilePalette } from '../editor/TilePalette';
import { MapStore } from '../editor/MapStore';

// The map editor. Paint GROUND tiles (grass/water) cell-by-cell and place FEATURES (trees,
// bushes, rocks, …) on top, chosen from a hierarchical palette with thumbnails + a recent
// row. A toggleable grid overlay, ✏️ Paint / ✋ Pan modes, an eraser, pinch/wheel zoom, and
// save round it out. The canvas pans/zooms on the main camera; the toolbars are drawn by a
// separate zoom-1 UI camera so they stay anchored to the screen edges.

const TOP_H = 48;
const BOTTOM_H = 72;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const THUMB = 38;

type Mode = 'paint' | 'pan';
type ThumbGO = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Depth;

export class EditorScene extends Phaser.Scene {
    private map!: MapData;
    private ts = 64;
    private cells: (Phaser.GameObjects.Image | null)[] = [];
    private featureSprites = new Map<number, Phaser.GameObjects.GameObject>();
    private grid!: Phaser.GameObjects.Graphics;
    private border!: Phaser.GameObjects.Graphics;

    private brush: TileId = 'grass';
    private erasing = false;
    private mode: Mode = 'paint';
    private gridOn = true;
    private recent: TileId[] = [];

    // Layer/camera split (see GameScene): world on the main camera, UI on a zoom-1 camera.
    private worldLayer!: Phaser.GameObjects.Layer;
    private uiLayer!: Phaser.GameObjects.Layer;
    private uiCamera!: Phaser.Cameras.Scene2D.Camera;
    private palette!: TilePalette;

    // Toolbar widgets (named, so dynamic recreation never breaks the layout).
    private topBar!: Phaser.GameObjects.Rectangle;
    private botBar!: Phaser.GameObjects.Rectangle;
    private menuBtn!: Phaser.GameObjects.Text;
    private nameText!: Phaser.GameObjects.Text;
    private saveBtn!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private activeBg!: Phaser.GameObjects.Rectangle;
    private activeLabel!: Phaser.GameObjects.Text;
    private activeThumb: ThumbGO | null = null;
    private recentSlots: { bg: Phaser.GameObjects.Rectangle; thumb: ThumbGO; id: TileId }[] = [];
    private eraserBtn!: Phaser.GameObjects.Text;
    private modeBtn!: Phaser.GameObjects.Text;
    private gridBtn!: Phaser.GameObjects.Text;

    private pinchDist = 0;

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
        this.palette = new TilePalette(this, this.uiLayer, (id) => this.selectBrush(id));
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
        this.palette.layout();
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
        if (commit) this.markDirty();
    }

    private renderAllFeatures() {
        for (const f of this.map.features) this.spawnFeature(f);
    }

    /** Create the sprite for a stored feature (no data change). */
    private spawnFeature(f: MapFeature) {
        const def = getTile(f.tileId);
        if (!def || def.render.kind !== 'feature') return;
        const r = def.render;
        const { x, y } = this.cellCentre(f.col, f.row);
        const go = r.anim
            ? this.add.sprite(x, y, r.texture).play(r.anim)
            : this.add.image(x, y, r.texture, r.frame);
        if (go instanceof Phaser.GameObjects.Sprite) go.anims.setProgress(Math.random());
        go.setOrigin(r.originX ?? 0.5, r.originY).setScale(r.scale).setFlipX(!!f.flipX).setDepth(1000 + y);
        this.worldLayer.add(go);
        const i = cellIndex(this.map.cols, f.col, f.row);
        this.featureSprites.get(i)?.destroy();
        this.featureSprites.set(i, go);
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
        this.markDirty();
    }

    private eraseFeature(col: number, row: number) {
        const i = cellIndex(this.map.cols, col, row);
        const before = this.map.features.length;
        this.map.features = this.map.features.filter((f) => !(f.col === col && f.row === row));
        this.featureSprites.get(i)?.destroy();
        this.featureSprites.delete(i);
        if (this.map.features.length !== before) this.markDirty();
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
            (this.scale.height - TOP_H - BOTTOM_H) / (this.mapH + this.ts * 2),
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
        return y < TOP_H || y > this.scale.height - BOTTOM_H;
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
            if (this.palette.isOpen() || this.overToolbar(p.y)) return;
            if (this.mode === 'paint' && !this.twoFingers()) this.paintAt(p.x, p.y);
        });

        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (this.palette.isOpen()) return;
            const p1 = this.input.pointer1;
            const p2 = this.input.pointer2;
            if (p1.isDown && p2.isDown) {
                const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
                if (this.pinchDist > 0 && dist > 0) this.zoomAt(dist / this.pinchDist, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
                this.pinchDist = dist;
                return;
            }
            this.pinchDist = 0;
            if (!p.isDown || this.overToolbar(p.y)) return;
            if (this.mode === 'paint') {
                this.paintAt(p.x, p.y);
            } else {
                const cam = this.cameras.main;
                cam.scrollX -= (p.position.x - p.prevPosition.x) / cam.zoom;
                cam.scrollY -= (p.position.y - p.prevPosition.y) / cam.zoom;
            }
        });

        this.input.on('pointerup', () => { this.pinchDist = 0; });
        this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
            if (!this.palette.isOpen()) this.zoomAt(dy > 0 ? 0.9 : 1.1, p.x, p.y);
        });
    }

    private twoFingers() { return this.input.pointer1.isDown && this.input.pointer2.isDown; }

    // ── toolbars ───────────────────────────────────────────────────────────--
    private btn(text: string, bg: string, onTap: () => void) {
        const t = this.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', backgroundColor: bg, padding: { x: 12, y: 7 },
        }).setOrigin(0, 0.5).setDepth(1000).setInteractive({ useHandCursor: true });
        t.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) onTap(); });
        this.uiLayer.add(t);
        return t;
    }

    private buildToolbars() {
        // Top bar.
        this.topBar = this.add.rectangle(0, 0, 10, TOP_H, 0x0e1620, 1).setOrigin(0, 0).setDepth(999).setStrokeStyle(1, 0x2a3543);
        this.menuBtn = this.btn('← Menu', '#33455a', () => this.scene.start('Menu'));
        this.nameText = this.add.text(0, 0, this.map.name, { fontFamily: 'monospace', fontSize: '16px', color: '#e8f1ff', fontStyle: 'bold' })
            .setOrigin(0.5, 0.5).setDepth(1000).setInteractive({ useHandCursor: true });
        this.nameText.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.rename(); });
        this.saveBtn = this.btn('💾 Save', '#2a8c4a', () => this.save());
        this.statusText = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#8aa0b5' }).setOrigin(1, 0.5).setDepth(1000);

        // Bottom bar.
        this.botBar = this.add.rectangle(0, 0, 10, BOTTOM_H, 0x0e1620, 1).setOrigin(0, 0).setDepth(999).setStrokeStyle(1, 0x2a3543);
        // Active-brush card → opens the palette.
        this.activeBg = this.add.rectangle(0, 0, 150, 50, 0x16202c, 1).setOrigin(0, 0.5).setDepth(1000).setStrokeStyle(1, 0x3a4a5a)
            .setInteractive({ useHandCursor: true });
        this.activeBg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.palette.show([]); });
        this.activeLabel = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' }).setOrigin(0, 0.5).setDepth(1001);

        this.eraserBtn = this.btn('🩹 Erase', '#33455a', () => this.toggleEraser());
        this.modeBtn = this.btn('✏️ Paint', '#4a5a33', () => this.toggleMode());
        this.gridBtn = this.btn('# Grid', '#33455a', () => this.toggleGrid());

        this.uiLayer.add([this.topBar, this.nameText, this.statusText, this.botBar, this.activeBg, this.activeLabel]);

        this.refreshActive();
    }

    private layoutUI = () => {
        const w = this.scale.width;
        const h = this.scale.height;
        const tcy = TOP_H / 2;
        this.topBar.setPosition(0, 0).setSize(w, TOP_H);
        this.menuBtn.setPosition(8, tcy);
        this.nameText.setPosition(w / 2, tcy);
        this.saveBtn.setPosition(w - 220, tcy);
        this.statusText.setPosition(w - 10, tcy);

        const by = h - BOTTOM_H / 2;
        this.botBar.setPosition(0, h - BOTTOM_H).setSize(w, BOTTOM_H);
        this.activeBg.setPosition(10, by);
        this.activeThumb?.setPosition(10 + 25, by);
        this.activeLabel.setPosition(10 + 48, by);

        // Recent thumbnails after the active card.
        let rx = 176;
        for (const slot of this.recentSlots) {
            slot.bg.setPosition(rx, by);
            slot.thumb.setPosition(rx + 22, by);
            rx += 52;
        }

        this.gridBtn.setPosition(w - 90, by).setOrigin(0, 0.5);
        this.modeBtn.setPosition(w - 200, by).setOrigin(0, 0.5);
        this.eraserBtn.setPosition(w - 320, by).setOrigin(0, 0.5);
    };

    // ── selection / brush ────────────────────────────────────────────────────
    private selectBrush(id: TileId) {
        this.brush = id;
        this.erasing = false;
        this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 8);
        this.refreshActive();
        this.refreshEraserStyle();
        this.refreshRecent();
    }

    private refreshActive() {
        this.activeThumb?.destroy();
        this.activeThumb = null;
        if (this.erasing) {
            this.activeLabel.setText('Eraser');
            const x = this.add.text(0, 0, '✕', { fontSize: '22px', color: '#ff9a9a' }).setOrigin(0.5).setDepth(1001);
            this.uiLayer.add(x);
            this.activeThumb = x as unknown as ThumbGO;
        } else {
            const def = getTile(this.brush);
            this.activeLabel.setText(def?.label ?? this.brush);
            if (def) {
                const t = makeTileThumb(this, def, THUMB) as ThumbGO;
                t.setDepth(1001);
                this.uiLayer.add(t);
                this.activeThumb = t;
            }
        }
        this.layoutUI();
    }

    private refreshRecent() {
        for (const s of this.recentSlots) { s.bg.destroy(); s.thumb.destroy(); }
        this.recentSlots = [];
        const show = this.recent.filter((id) => id !== this.brush).slice(0, 4);
        for (const id of show) {
            const def = getTile(id);
            if (!def) continue;
            const bg = this.add.rectangle(0, 0, 44, 44, 0x16202c, 1).setOrigin(0.5).setDepth(1000).setStrokeStyle(1, 0x2a3543)
                .setInteractive({ useHandCursor: true });
            bg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.selectBrush(id); });
            const thumb = makeTileThumb(this, def, THUMB) as ThumbGO;
            thumb.setDepth(1001);
            this.uiLayer.add([bg, thumb]);
            this.recentSlots.push({ bg, thumb, id });
        }
        this.layoutUI();
    }

    // ── toggles / actions ────────────────────────────────────────────────────
    private toggleEraser() {
        this.erasing = !this.erasing;
        this.refreshEraserStyle();
        this.refreshActive();
    }

    private refreshEraserStyle() {
        this.eraserBtn.setText(this.erasing ? '🩹 Erasing' : '🩹 Erase');
        this.eraserBtn.setBackgroundColor(this.erasing ? '#6a3a3a' : '#33455a');
    }

    private toggleMode() {
        this.mode = this.mode === 'paint' ? 'pan' : 'paint';
        this.modeBtn.setText(this.mode === 'paint' ? '✏️ Paint' : '✋ Pan');
        this.modeBtn.setBackgroundColor(this.mode === 'paint' ? '#4a5a33' : '#33455a');
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
