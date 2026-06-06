import * as Phaser from 'phaser';
import { foldersAt, makeTileThumb, tilesAt, TileDef } from './tileCatalog';
import type { TileId } from './MapData';

// A persistent bottom-of-screen tile explorer: a single horizontal row showing the items at
// the current folder level, scrollable left/right by dragging. A ‹ Back button steps up a
// level; tapping a folder descends into it; tapping a tile selects the brush WITHOUT leaving
// the level — so you keep working with the tiles you care about. Lives on the editor's
// zoom-1 `uiLayer`; the editor routes drags in the strip region to `scrollBy`.

export const EXPLORER_H = 92;
const VPL = 104; // viewport left edge (after the Back / breadcrumb column)
const RPAD = 8; // right padding
const PITCH = 86; // horizontal spacing between chip centres
const CW = 78; // chip width
const DEPTH_BG = 2000;
const DEPTH_CHIP = 2001;
const DEPTH_FIXED = 2003; // Back / breadcrumb / left mask — above chips so they slide under

type GO = Phaser.GameObjects.GameObject;
const T = (o: GO) => o as GO & Phaser.GameObjects.Components.Transform
    & Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.Depth;

interface Chip {
    folder?: string;       // set for a folder chip
    def?: TileDef;         // set for a tile chip
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
    private selectedId: TileId | null = null;
    private chips: Chip[] = [];
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

    /** True if a screen-y falls inside the strip (so the editor routes drags here, not paint). */
    contains(y: number) { return y > this.h - EXPLORER_H; }

    setSelected(id: TileId) {
        this.selectedId = id;
        this.restyle();
    }

    private build() {
        this.bg = this.scene.add.rectangle(0, 0, 10, EXPLORER_H, 0x0e1620, 1).setOrigin(0, 0)
            .setDepth(DEPTH_BG).setStrokeStyle(1, 0x2a3543);
        // Opaque left column so chips scrolled left vanish under the Back/breadcrumb.
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
    }

    /** Navigate to a folder level: rebuild the chip row and reset the scroll. */
    goTo(path: string[]) {
        this.path = path;
        this.scrollX = 0;
        for (const c of this.chips) { c.bg.destroy(); c.thumb.destroy(); c.label.destroy(); }
        this.chips = [];

        for (const name of foldersAt(path)) this.chips.push(this.makeFolderChip(name));
        for (const def of tilesAt(path)) this.chips.push(this.makeTileChip(def));

        this.backBtn.setVisible(path.length > 0);
        this.crumb.setText(path.length ? path.join(' › ') : 'Tiles');
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

    /** Horizontal scroll by a screen-x delta (clamped to content). */
    scrollBy(dx: number) {
        const viewportW = this.w - VPL - RPAD;
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

        const cy = top + (EXPLORER_H - 18) / 2 + 6;
        const right = w - RPAD;
        this.chips.forEach((c, i) => {
            const cx = VPL + i * PITCH + this.scrollX + CW / 2;
            const visible = cx + CW / 2 > VPL && cx - CW / 2 < right;
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
