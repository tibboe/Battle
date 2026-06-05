import * as Phaser from 'phaser';
import { foldersAt, makeTileThumb, tilesAt, TileDef } from './tileCatalog';
import type { TileId } from './MapData';

// The hierarchical tile browser: a full-screen overlay you drill down through (Ground /
// Features → Trees / Bushes / …), each tile shown as a thumbnail + label + description.
// Picking a tile calls back into the editor (which sets the brush and closes the panel).
// Objects live on the editor's `uiLayer` so the zoom-1 UI camera draws them; depth sits
// above the toolbars so it covers them while open.

const DEPTH = 5000;
const CARD_W = 168;
const CARD_H = 150;
const GAP = 12;
const HEADER_H = 56;
const PAD = 20;
const THUMB = 64;

export class TilePalette {
    private scene: Phaser.Scene;
    private layer: Phaser.GameObjects.Layer;
    private onPick: (id: TileId) => void;
    private items: Phaser.GameObjects.GameObject[] = [];
    private path: string[] = [];
    private open = false;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, onPick: (id: TileId) => void) {
        this.scene = scene;
        this.layer = layer;
        this.onPick = onPick;
    }

    isOpen() { return this.open; }

    toggle() { (this.open ? this.close() : this.show([])); }

    show(path: string[]) {
        this.open = true;
        this.path = path;
        this.render();
    }

    close() {
        this.open = false;
        this.clear();
    }

    /** Re-flow on resize (only if currently open). */
    layout() { if (this.open) this.render(); }

    private clear() {
        for (const o of this.items) o.destroy();
        this.items = [];
    }

    private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
        (o as T & { setDepth?: (d: number) => void }).setDepth?.(DEPTH);
        this.layer.add(o);
        this.items.push(o);
        return o;
    }

    private tapText(x: number, y: number, text: string, bg: string, onTap: () => void) {
        const t = this.scene.add.text(x, y, text, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff',
            backgroundColor: bg, padding: { x: 12, y: 7 },
        }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
        t.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) onTap(); });
        return this.add(t);
    }

    private render() {
        this.clear();
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;

        // Backdrop (also blocks taps reaching the canvas behind it).
        this.add(this.scene.add.rectangle(0, 0, w, h, 0x06101a, 0.94).setOrigin(0, 0)
            .setInteractive());

        // Header: back (if nested), breadcrumb, close.
        const crumb = this.path.length ? `Tiles › ${this.path.join(' › ')}` : 'Tiles';
        if (this.path.length) {
            this.tapText(PAD, HEADER_H / 2, '‹ Back', '#33455a', () => this.show(this.path.slice(0, -1)));
        }
        this.add(this.scene.add.text(this.path.length ? PAD + 90 : PAD, HEADER_H / 2, crumb, {
            fontFamily: 'monospace', fontSize: '18px', color: '#e8f1ff', fontStyle: 'bold',
        }).setOrigin(0, 0.5));
        this.tapText(w - 70, HEADER_H / 2, '✕', '#6a3a3a', () => this.close());

        // Grid of folder cards then tile cards.
        const folders = foldersAt(this.path);
        const tiles = tilesAt(this.path);
        const cols = Math.max(1, Math.floor((w - PAD * 2 + GAP) / (CARD_W + GAP)));
        let n = 0;
        const place = () => {
            const cx = PAD + (n % cols) * (CARD_W + GAP);
            const cy = HEADER_H + PAD + Math.floor(n / cols) * (CARD_H + GAP);
            n++;
            return { cx, cy };
        };

        for (const name of folders) {
            const { cx, cy } = place();
            this.folderCard(cx, cy, name);
        }
        for (const def of tiles) {
            const { cx, cy } = place();
            this.tileCard(cx, cy, def);
        }
    }

    private folderCard(x: number, y: number, name: string) {
        const bg = this.add(this.scene.add.rectangle(x, y, CARD_W, CARD_H, 0x16202c, 1).setOrigin(0, 0)
            .setStrokeStyle(1, 0x2a3543).setInteractive({ useHandCursor: true }));
        this.add(this.scene.add.text(x + CARD_W / 2, y + CARD_H / 2 - 16, '📁', { fontSize: '40px' }).setOrigin(0.5));
        this.add(this.scene.add.text(x + CARD_W / 2, y + CARD_H - 28, name, {
            fontFamily: 'monospace', fontSize: '16px', color: '#cfe6ff', fontStyle: 'bold',
        }).setOrigin(0.5));
        bg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.show([...this.path, name]); });
    }

    private tileCard(x: number, y: number, def: TileDef) {
        const bg = this.add(this.scene.add.rectangle(x, y, CARD_W, CARD_H, 0x121b26, 1).setOrigin(0, 0)
            .setStrokeStyle(1, 0x2a3543).setInteractive({ useHandCursor: true }));
        // Thumbnail in a framed swatch box.
        this.add(this.scene.add.rectangle(x + CARD_W / 2, y + 44, THUMB + 12, THUMB + 12, 0x0b1119, 1)
            .setOrigin(0.5).setStrokeStyle(1, 0x2a3543));
        const thumb = makeTileThumb(this.scene, def, THUMB) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
        thumb.setPosition(x + CARD_W / 2, y + 44);
        this.add(thumb);
        this.add(this.scene.add.text(x + CARD_W / 2, y + 88, def.label, {
            fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5));
        this.add(this.scene.add.text(x + 8, y + 104, def.desc, {
            fontFamily: 'monospace', fontSize: '10px', color: '#8aa0b5',
            wordWrap: { width: CARD_W - 16 },
        }).setOrigin(0, 0));
        bg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) { this.onPick(def.id); this.close(); } });
    }
}
