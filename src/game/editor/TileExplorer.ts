import * as Phaser from 'phaser';
import { TERRAIN_VARIANTS } from '../terrain/tileset';
import { foldersAt, getTile, makeTileThumb, siblingInColor, tilesAt, TileDef } from './tileCatalog';
import type { TileId } from './MapData';

// A persistent bottom-of-screen tile explorer: a single horizontal row showing the items at the
// current folder level, scrollable left/right by dragging. A ‹ Back button steps up a level;
// tapping a folder descends; tapping a tile selects the brush WITHOUT leaving the level. A column
// of five grass-colour swatches on the far right filters the row to one hue (and recolours the
// current brush). Lives on the editor's zoom-1 `uiLayer`; the editor routes strip drags here.

export const EXPLORER_H = 92;
const VPL = 104;     // viewport left edge (after the Back / breadcrumb column)
const SWATCH = 24;   // colour-filter swatch size
const SWGAP = 6;
const RSW = TERRAIN_VARIANTS.length * SWATCH + (TERRAIN_VARIANTS.length - 1) * SWGAP + 20; // right reserved width
const PITCH = 86;
const CW = 78;
const DEPTH_BG = 2000;
const DEPTH_CHIP = 2001;
const DEPTH_FIXED = 2003;

type GO = Phaser.GameObjects.GameObject;
const T = (o: GO) => o as GO & Phaser.GameObjects.Components.Transform
    & Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.Depth;

interface Chip {
    folder?: string;
    def?: TileDef;
    bg: Phaser.GameObjects.Rectangle;
    thumb: GO;
    label: Phaser.GameObjects.Text;
}

export class TileExplorer {
    private scene: Phaser.Scene;
    private layer: Phaser.GameObjects.Layer;
    private onPick: (id: TileId) => void;

    private path: string[] = [];
    private scrollX = 0;
    private activeColor = 0;
    private selectedId: TileId | null = null;
    private chips: Chip[] = [];
    private swatches: Phaser.GameObjects.Rectangle[] = [];
    private w = 0;
    private h = 0;

    private bg!: Phaser.GameObjects.Rectangle;
    private leftMask!: Phaser.GameObjects.Rectangle;
    private backBtn!: Phaser.GameObjects.Text;
    private crumb!: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, onPick: (id: TileId) => void) {
        this.scene = scene;
        this.layer = layer;
        this.onPick = onPick;
        this.build();
        this.goTo([]);
    }

    contains(y: number) { return y > this.h - EXPLORER_H; }

    setSelected(id: TileId) {
        this.selectedId = id;
        // Keep the colour filter in step with the selected tile's hue.
        const def = getTile(id);
        if (def?.colorIndex !== undefined) this.activeColor = def.colorIndex;
        this.restyle();
    }

    private build() {
        this.bg = this.scene.add.rectangle(0, 0, 10, EXPLORER_H, 0x0e1620, 1).setOrigin(0, 0)
            .setDepth(DEPTH_BG).setStrokeStyle(1, 0x2a3543);
        this.leftMask = this.scene.add.rectangle(0, 0, VPL - 6, EXPLORER_H, 0x0e1620, 1).setOrigin(0, 0)
            .setDepth(DEPTH_FIXED - 1);
        this.backBtn = this.scene.add.text(0, 0, '‹ Back', {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', backgroundColor: '#33455a', padding: { x: 10, y: 6 },
        }).setOrigin(0, 0.5).setDepth(DEPTH_FIXED).setInteractive({ useHandCursor: true });
        this.backBtn.on('pointerup', (p: Phaser.Input.Pointer) => {
            if (p.getDistance() < 14 && this.path.length) this.goTo(this.path.slice(0, -1));
        });
        this.crumb = this.scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#7fd0ff' })
            .setOrigin(0, 0.5).setDepth(DEPTH_FIXED);
        this.layer.add([this.bg, this.leftMask, this.backBtn, this.crumb]);

        // Right-edge colour filter (opaque backing so chips slide under it).
        const rmask = this.scene.add.rectangle(0, 0, RSW + 6, EXPLORER_H, 0x0e1620, 1).setOrigin(0, 0).setDepth(DEPTH_FIXED - 1);
        this.layer.add(rmask);
        this.rightMask = rmask;
        TERRAIN_VARIANTS.forEach((v, i) => {
            const sw = this.scene.add.rectangle(0, 0, SWATCH, SWATCH, v.hue, 1).setOrigin(0.5).setDepth(DEPTH_FIXED)
                .setStrokeStyle(2, 0x000000, 0.4).setInteractive({ useHandCursor: true });
            sw.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.setActiveColor(i); });
            this.swatches.push(sw);
            this.layer.add(sw);
        });
    }
    private rightMask!: Phaser.GameObjects.Rectangle;

    goTo(path: string[]) {
        this.path = path;
        this.scrollX = 0;
        this.rebuild();
    }

    private setActiveColor(c: number) {
        if (c === this.activeColor) return;
        this.activeColor = c;
        // Recolour the current brush to the same piece in the new hue, if it has colours.
        const def = this.selectedId ? getTile(this.selectedId) : undefined;
        const sib = def && siblingInColor(def, c);
        if (sib) { this.selectedId = sib.id; this.onPick(sib.id); }
        this.rebuild();
    }

    /** Rebuild the chip row for the current path, filtered to the active colour. */
    private rebuild() {
        for (const c of this.chips) { c.bg.destroy(); c.thumb.destroy(); c.label.destroy(); }
        this.chips = [];
        for (const name of foldersAt(this.path)) this.chips.push(this.makeFolderChip(name));
        for (const def of tilesAt(this.path)) {
            if (def.colorIndex === undefined || def.colorIndex === this.activeColor) this.chips.push(this.makeTileChip(def));
        }
        this.backBtn.setVisible(this.path.length > 0);
        this.crumb.setText(this.path.length ? this.path.join(' › ') : 'Tiles');
        this.layout(this.w, this.h);
    }

    private chipBg() {
        return this.scene.add.rectangle(0, 0, CW, EXPLORER_H - 18, 0x16202c, 1).setOrigin(0.5)
            .setDepth(DEPTH_CHIP).setStrokeStyle(1, 0x2a3543).setInteractive({ useHandCursor: true });
    }
    private chipLabel(text: string, color: string) {
        return this.scene.add.text(0, 0, text, {
            fontFamily: 'monospace', fontSize: '9px', color, align: 'center', wordWrap: { width: CW - 8 },
        }).setOrigin(0.5).setDepth(DEPTH_CHIP + 1);
    }

    private makeFolderChip(name: string): Chip {
        const bg = this.chipBg();
        const thumb = this.scene.add.text(0, 0, '📁', { fontSize: '30px' }).setOrigin(0.5).setDepth(DEPTH_CHIP + 1);
        const label = this.chipLabel(name, '#cfe6ff');
        bg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) this.goTo([...this.path, name]); });
        this.layer.add([bg, thumb, label]);
        return { folder: name, bg, thumb, label };
    }

    private makeTileChip(def: TileDef): Chip {
        const bg = this.chipBg();
        const thumb = makeTileThumb(this.scene, def, 40);
        T(thumb).setDepth(DEPTH_CHIP + 1);
        const label = this.chipLabel(def.label, '#ffffff');
        bg.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) { this.onPick(def.id); this.setSelected(def.id); } });
        this.layer.add([bg, thumb, label]);
        return { def, bg, thumb, label };
    }

    scrollBy(dx: number) {
        const viewportW = (this.w - RSW) - VPL;
        const contentW = this.chips.length * PITCH;
        const maxScroll = Math.min(0, viewportW - contentW);
        this.scrollX = Phaser.Math.Clamp(this.scrollX + dx, maxScroll, 0);
        this.layout(this.w, this.h);
    }

    layout(w: number, h: number) {
        this.w = w;
        this.h = h;
        const top = h - EXPLORER_H;
        this.bg.setPosition(0, top).setSize(w, EXPLORER_H);
        this.leftMask.setPosition(0, top).setSize(VPL - 6, EXPLORER_H);
        this.backBtn.setPosition(10, top + 22);
        this.crumb.setPosition(10, h - 14);

        // Colour swatches on the far right.
        this.rightMask.setPosition(w - RSW - 6, top).setSize(RSW + 6, EXPLORER_H);
        const sx0 = w - RSW + 10;
        this.swatches.forEach((sw, i) => {
            sw.setPosition(sx0 + i * (SWATCH + SWGAP) + SWATCH / 2, top + EXPLORER_H / 2);
            sw.setStrokeStyle(i === this.activeColor ? 3 : 2, i === this.activeColor ? 0xffffff : 0x000000, i === this.activeColor ? 1 : 0.4);
        });

        const vpr = w - RSW;
        const cy = top + (EXPLORER_H - 18) / 2 + 6;
        this.chips.forEach((c, i) => {
            const cx = VPL + i * PITCH + this.scrollX + CW / 2;
            const visible = cx + CW / 2 > VPL && cx - CW / 2 < vpr;
            c.bg.setPosition(cx, cy).setVisible(visible);
            T(c.thumb).setPosition(cx, cy - 14).setVisible(visible);
            c.label.setPosition(cx, cy + 22).setVisible(visible);
        });
        this.restyle();
    }

    private restyle() {
        for (const c of this.chips) {
            if (!c.def) continue;
            const on = c.def.id === this.selectedId;
            c.bg.setStrokeStyle(on ? 3 : 1, on ? 0xffffff : 0x2a3543);
        }
    }
}
