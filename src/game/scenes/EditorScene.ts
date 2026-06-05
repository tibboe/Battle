import * as Phaser from 'phaser';
import { loadTerrainTileset } from '../terrain/tileset';
import { cellIndex, createEmptyMap, MapData, TileId } from '../editor/MapData';
import { getTile, TILE_CATALOG, WATER_FILE, WATER_KEY } from '../editor/tileCatalog';
import { MapStore } from '../editor/MapStore';

// The map editor (foundation slice). Renders a MapData grid, lets the director paint ground
// tiles (grass / water) cell-by-cell with a toggleable grid overlay, pan/zoom the canvas, and
// save back to the store. Decorations/features and the hierarchical tile browser come next.
//
// Two interaction modes (mobile-friendly): ✏️ Paint — drag to paint cells; ✋ Pan — drag to
// move the canvas. Pinch / wheel always zoom. Toolbars are screen-fixed; taps inside them
// never paint.

const TOP_H = 48;
const BOTTOM_H = 70;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type Mode = 'paint' | 'pan';

export class EditorScene extends Phaser.Scene {
    private map!: MapData;
    private ts = 64;
    private cells: (Phaser.GameObjects.Image | null)[] = [];
    private grid!: Phaser.GameObjects.Graphics;
    private border!: Phaser.GameObjects.Graphics;

    private brush: TileId = 'grass';
    private mode: Mode = 'paint';
    private gridOn = true;

    // The map canvas (water, cells, grid) lives on `worldLayer`, which the main camera
    // pans/zooms. The toolbars live on `uiLayer`, drawn by a separate `uiCamera` fixed at
    // zoom 1 so the camera zoom never shrinks the HUD toward screen-centre (the bug where
    // the toolbars bunched up in the middle). Mirrors GameScene's main/uiCamera split.
    private worldLayer!: Phaser.GameObjects.Layer;
    private uiLayer!: Phaser.GameObjects.Layer;
    private uiCamera!: Phaser.Cameras.Scene2D.Camera;

    // Fixed UI we reposition on resize.
    private ui: Phaser.GameObjects.GameObject[] = [];
    private statusText!: Phaser.GameObjects.Text;
    private nameText!: Phaser.GameObjects.Text;
    private modeBtn!: Phaser.GameObjects.Text;
    private gridBtn!: Phaser.GameObjects.Text;
    private chips: { id: TileId; bg: Phaser.GameObjects.Rectangle }[] = [];

    // Pinch / pan bookkeeping.
    private pinchDist = 0;

    constructor() {
        super('Editor');
    }

    preload() {
        loadTerrainTileset(this);
        this.load.image(WATER_KEY, encodeURI(WATER_FILE));
    }

    create(data: { map?: MapData }) {
        this.map = data?.map ?? createEmptyMap();
        this.ts = this.map.tileSize;
        this.cells = new Array(this.map.cols * this.map.rows).fill(null);

        this.cameras.main.setBackgroundColor('#0b1119');
        this.input.addPointer(2); // enable pinch on the phone

        this.worldLayer = this.add.layer();
        this.uiLayer = this.add.layer();

        this.drawWaterBackdrop();
        this.renderAllCells();
        this.drawGridAndBorder();
        this.setupCamera();
        this.buildToolbars();
        this.setupUiCamera();
        this.layoutUI();

        this.bindInput();

        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    }

    // The UI camera renders only the toolbars (zoom 1, screen-anchored); the main camera
    // renders only the world. Each ignores the other's layer.
    private setupUiCamera() {
        this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.cameras.main.ignore(this.uiLayer);
        this.uiCamera.ignore(this.worldLayer);
    }

    private onResize = () => {
        this.uiCamera.setSize(this.scale.width, this.scale.height);
        this.layoutUI();
    };

    // ── rendering ────────────────────────────────────────────────────────────
    private get mapW() { return this.map.cols * this.ts; }
    private get mapH() { return this.map.rows * this.ts; }

    private drawWaterBackdrop() {
        // Sea under the whole canvas (plus a margin) — open water shows wherever no grass is.
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
                this.applyCell(col, row, this.map.ground[cellIndex(this.map.cols, col, row)], false);
            }
        }
    }

    /** Set a cell's tile (data + sprite). `commit` marks the map dirty for the status line. */
    private applyCell(col: number, row: number, id: TileId, commit = true) {
        const i = cellIndex(this.map.cols, col, row);
        this.map.ground[i] = id;
        const def = getTile(id);
        const existing = this.cells[i];
        if (existing) { existing.destroy(); this.cells[i] = null; }
        if (def && def.render.kind === 'sprite') {
            const img = this.add
                .image(col * this.ts, row * this.ts, def.render.atlas, def.render.frame)
                .setOrigin(0, 0)
                .setDepth(0);
            this.worldLayer.add(img);
            this.cells[i] = img;
        }
        if (commit) this.markDirty();
    }

    private drawGridAndBorder() {
        this.grid = this.add.graphics().setDepth(100);
        this.grid.lineStyle(1, 0xffffff, 0.18);
        for (let c = 0; c <= this.map.cols; c++) {
            this.grid.lineBetween(c * this.ts, 0, c * this.ts, this.mapH);
        }
        for (let r = 0; r <= this.map.rows; r++) {
            this.grid.lineBetween(0, r * this.ts, this.mapW, r * this.ts);
        }
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
        // Frame the whole map with a little breathing room.
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
        const i = cellIndex(this.map.cols, cell.col, cell.row);
        if (this.map.ground[i] === this.brush) return; // no-op, avoid churn
        this.applyCell(cell.col, cell.row, this.brush);
    }

    private bindInput() {
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            if (this.overToolbar(p.y)) return;
            if (this.mode === 'paint' && !this.twoFingers()) this.paintAt(p.x, p.y);
        });

        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            const p1 = this.input.pointer1;
            const p2 = this.input.pointer2;

            if (p1.isDown && p2.isDown) { // pinch zoom (either mode)
                const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
                if (this.pinchDist > 0 && dist > 0) {
                    this.zoomAt(dist / this.pinchDist, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
                }
                this.pinchDist = dist;
                return;
            }
            this.pinchDist = 0;

            if (!p.isDown || this.overToolbar(p.y)) return;
            if (this.mode === 'paint') {
                this.paintAt(p.x, p.y); // drag-paint
            } else {
                const cam = this.cameras.main;
                cam.scrollX -= (p.position.x - p.prevPosition.x) / cam.zoom;
                cam.scrollY -= (p.position.y - p.prevPosition.y) / cam.zoom;
            }
        });

        this.input.on('pointerup', () => { this.pinchDist = 0; });
        this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
            this.zoomAt(dy > 0 ? 0.9 : 1.1, p.x, p.y);
        });
    }

    private twoFingers() {
        return this.input.pointer1.isDown && this.input.pointer2.isDown;
    }

    // ── toolbars ───────────────────────────────────────────────────────────--
    private buildToolbars() {
        const mk = (x: number, y: number, text: string, bg: string, onTap: () => void) => {
            const t = this.add.text(x, y, text, {
                fontFamily: 'monospace', fontSize: '15px', color: '#ffffff',
                backgroundColor: bg, padding: { x: 12, y: 7 },
            }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1000).setInteractive({ useHandCursor: true });
            t.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) onTap(); });
            this.ui.push(t);
            return t;
        };

        // Top bar background + controls.
        const topBar = this.add.rectangle(0, 0, 10, TOP_H, 0x0e1620, 1).setOrigin(0, 0)
            .setScrollFactor(0).setDepth(999).setStrokeStyle(1, 0x2a3543);
        this.ui.push(topBar);
        mk(0, 0, '← Menu', '#33455a', () => this.scene.start('Menu'));
        this.nameText = this.add.text(0, 0, this.map.name, {
            fontFamily: 'monospace', fontSize: '16px', color: '#e8f1ff', fontStyle: 'bold',
        }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(1000).setInteractive({ useHandCursor: true });
        this.nameText.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.rename(); });
        this.ui.push(this.nameText);
        mk(0, 0, '💾 Save', '#2a8c4a', () => this.save());
        this.statusText = this.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '12px', color: '#8aa0b5',
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(1000);
        this.ui.push(this.statusText);

        // Bottom bar background.
        const botBar = this.add.rectangle(0, 0, 10, BOTTOM_H, 0x0e1620, 1).setOrigin(0, 0)
            .setScrollFactor(0).setDepth(999).setStrokeStyle(1, 0x2a3543);
        this.ui.push(botBar);

        // Brush chips (one per ground tile in the catalog).
        for (const def of TILE_CATALOG) {
            const bg = this.add.rectangle(0, 0, 96, 40, def.swatch, 1).setOrigin(0, 0.5)
                .setScrollFactor(0).setDepth(1000).setStrokeStyle(2, 0x000000, 0.3)
                .setInteractive({ useHandCursor: true });
            const lbl = this.add.text(0, 0, def.label, {
                fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
            }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(1001);
            bg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.selectBrush(def.id); });
            this.chips.push({ id: def.id, bg });
            this.ui.push(bg, lbl);
            // Keep the label paired with its chip for layout.
            (bg as Phaser.GameObjects.Rectangle & { _lbl?: Phaser.GameObjects.Text })._lbl = lbl;
        }

        this.modeBtn = mk(0, 0, '✏️ Paint', '#4a5a33', () => this.toggleMode());
        this.gridBtn = mk(0, 0, '# Grid', '#33455a', () => this.toggleGrid());

        // Hand the whole toolbar to the UI layer so only the uiCamera draws it.
        this.uiLayer.add(this.ui);

        this.refreshBrushHighlight();
    }

    private layoutUI = () => {
        const w = this.scale.width;
        const h = this.scale.height;
        const cy = TOP_H / 2;
        const find = (i: number) => this.ui[i] as Phaser.GameObjects.Text;

        // ui order: [topBar, Menu, nameText, Save, statusText, botBar, chip0,lbl0, chip1,lbl1, ..., modeBtn, gridBtn]
        const topBar = this.ui[0] as Phaser.GameObjects.Rectangle;
        topBar.setPosition(0, 0).setSize(w, TOP_H);
        find(1).setPosition(8, cy);                       // Menu
        this.nameText.setPosition(w / 2, cy);
        const save = find(3); save.setPosition(w - 230, cy);
        this.statusText.setPosition(w - 10, cy);

        const botBar = this.ui[5] as Phaser.GameObjects.Rectangle;
        botBar.setPosition(0, h - BOTTOM_H).setSize(w, BOTTOM_H);
        const by = h - BOTTOM_H / 2;
        let x = 10;
        for (const chip of this.chips) {
            chip.bg.setPosition(x, by);
            const lbl = (chip.bg as Phaser.GameObjects.Rectangle & { _lbl?: Phaser.GameObjects.Text })._lbl;
            lbl?.setPosition(x + 48, by);
            x += 104;
        }
        this.modeBtn.setPosition(w - 200, by).setOrigin(0, 0.5);
        this.gridBtn.setPosition(w - 90, by).setOrigin(0, 0.5);
    };

    // ── actions ────────────────────────────────────────────────────────────--
    private selectBrush(id: TileId) {
        this.brush = id;
        this.refreshBrushHighlight();
    }

    private refreshBrushHighlight() {
        for (const chip of this.chips) {
            const active = chip.id === this.brush;
            chip.bg.setStrokeStyle(active ? 3 : 2, active ? 0xffffff : 0x000000, active ? 1 : 0.3);
            chip.bg.setScale(active ? 1.0 : 0.92);
        }
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
        this.statusText.setText('● unsaved');
        this.statusText.setColor('#ffcf6a');
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
        if (res.server) {
            this.statusText.setText('✓ saved (server)').setColor('#8fe388');
        } else {
            this.statusText.setText('✓ saved (local only)').setColor('#ffcf6a');
        }
    }
}
