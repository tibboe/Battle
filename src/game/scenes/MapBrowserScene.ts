import * as Phaser from 'phaser';
import { MapStore } from '../editor/MapStore';
import { createEmptyMap, MapData, MapSummary } from '../editor/MapData';

// Lists saved maps so the director can start a new one or open an existing one to edit.
// (View-only mode is just "open in the editor" for now.) Reached from the main menu.
const ROW_H = 56;
const LIST_TOP = 96;
const PAD = 16;

export class MapBrowserScene extends Phaser.Scene {
    constructor() {
        super('MapBrowser');
    }

    private rows: Phaser.GameObjects.GameObject[] = [];

    create() {
        this.cameras.main.setBackgroundColor('#0b1119');

        this.add.text(PAD, 24, 'MAPS', { fontFamily: 'monospace', fontSize: '30px', color: '#e8f1ff', fontStyle: 'bold' });
        this.button(PAD, 64, '← Menu', '#33455a', () => this.scene.start('Menu'));
        this.button(PAD + 110, 64, '＋ New Map', '#2a8c4a', () => this.newMap());

        this.refresh();
    }

    private async refresh() {
        for (const r of this.rows) r.destroy();
        this.rows = [];

        const loading = this.add.text(PAD, LIST_TOP, 'loading…', { fontFamily: 'monospace', fontSize: '14px', color: '#8aa0b5' });
        this.rows.push(loading);

        let maps: MapSummary[] = [];
        try { maps = await MapStore.list(); } catch { /* show empty */ }
        loading.destroy();
        this.rows = this.rows.filter((r) => r !== loading);

        if (maps.length === 0) {
            this.rows.push(this.add.text(PAD, LIST_TOP, 'No maps yet. Tap "＋ New Map" to start one.',
                { fontFamily: 'monospace', fontSize: '15px', color: '#8aa0b5' }));
            return;
        }

        const w = this.scale.width;
        maps.forEach((m, i) => {
            const y = LIST_TOP + i * ROW_H;
            const bg = this.add.rectangle(PAD, y, w - PAD * 2, ROW_H - 8, 0x121b26, 1).setOrigin(0, 0).setStrokeStyle(1, 0x2a3543);
            const name = this.add.text(PAD + 12, y + 12, m.name, { fontFamily: 'monospace', fontSize: '17px', color: '#cfe6ff' });
            const meta = this.add.text(PAD + 12, y + 32, `${m.cols}×${m.rows} · ${new Date(m.updatedAt).toLocaleString()}`,
                { fontFamily: 'monospace', fontSize: '11px', color: '#7a8a99' });
            const edit = this.button(w - PAD - 168, y + 8, 'Edit', '#33455a', () => this.openMap(m.id));
            const del = this.button(w - PAD - 88, y + 8, 'Delete', '#6a3a3a', () => this.deleteMap(m.id, m.name));
            this.rows.push(bg, name, meta, edit, del);
        });
    }

    private button(x: number, y: number, text: string, bg: string, onTap: () => void) {
        const b = this.add.text(x, y, text, {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', backgroundColor: bg, padding: { x: 12, y: 7 },
        }).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        b.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) onTap(); });
        return b;
    }

    private newMap() {
        const name = window.prompt('New map name:', 'Untitled Map');
        const map = createEmptyMap(name?.trim() || 'Untitled Map');
        this.startEditor(map);
    }

    private async openMap(id: string) {
        const map = await MapStore.load(id);
        if (map) this.startEditor(map);
    }

    private async deleteMap(id: string, name: string) {
        if (!window.confirm(`Delete "${name}"?`)) return;
        await MapStore.remove(id);
        this.refresh();
    }

    private startEditor(map: MapData) {
        this.scene.start('Editor', { map });
    }
}
