import * as Phaser from 'phaser';
import { saveSettings, resetSettings } from '../settings';
import { Setting, buildTunables, bumpSetting } from '../controls/tunables';

// The pre-game Setup screen: a scrollable list of the same tunables the in-game Dev panel
// exposes (grouped by section), with −/+ steppers, so the director can dial in the defaults
// BEFORE a match starts rather than fiddling mid-battle. Every change is saved to localStorage
// immediately, so the screen always reopens on your last choices. "Start Battle" launches the
// GameScene; "Reset" wipes the saved tweaks back to config.ts defaults.

const ROW_H = 34;
const HEADER_H = 32;
const PAD = 16;
const LIST_TOP = 86;
const FOOTER_H = 64;

interface RowUI {
    setting: Setting;
    value: Phaser.GameObjects.Text;
}

export class SetupScene extends Phaser.Scene {
    private settings: Setting[] = [];
    private rows: RowUI[] = [];
    private list!: Phaser.GameObjects.Container;
    private contentH = 0;
    private dragging = false;
    private lastPointerY = 0;

    constructor() {
        super('Setup');
    }

    create() {
        this.settings = buildTunables();
        this.rows = [];

        const w = this.scale.width;
        this.cameras.main.setBackgroundColor('#0b1119');

        this.add.text(PAD, 20, 'LANEBREAKER', { fontFamily: 'monospace', fontSize: '30px', color: '#e8f1ff', fontStyle: 'bold' })
            .setScrollFactor(0).setDepth(10);
        this.add.text(PAD, 54, 'Set your defaults, then start. Changes are remembered.',
            { fontFamily: 'monospace', fontSize: '13px', color: '#8aa0b5' }).setScrollFactor(0).setDepth(10);

        // Scrollable list of section headers + setting rows.
        this.list = this.add.container(0, LIST_TOP);
        let y = 0;
        let lastSection = '';
        for (const s of this.settings) {
            if (s.section !== lastSection) {
                lastSection = s.section;
                const hdr = this.add.text(PAD, y + 8, s.section.toUpperCase(),
                    { fontFamily: 'monospace', fontSize: '13px', color: '#7fd0ff', fontStyle: 'bold' });
                const line = this.add.rectangle(PAD, y + HEADER_H - 4, w - PAD * 2, 1, 0x2a3543).setOrigin(0, 0.5);
                this.list.add([hdr, line]);
                y += HEADER_H;
            }
            this.buildRow(s, y, w);
            y += ROW_H;
        }
        this.contentH = y;

        this.buildFooter();
        this.refreshValues();

        // Drag / wheel to scroll the list.
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            if (p.y < LIST_TOP || p.y > this.scale.height - FOOTER_H) return; // not over the list
            this.dragging = true;
            this.lastPointerY = p.y;
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (!this.dragging || !p.isDown) return;
            this.scrollBy(p.y - this.lastPointerY);
            this.lastPointerY = p.y;
        });
        this.input.on('pointerup', () => { this.dragging = false; });
        this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.scrollBy(-dy));

        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    }

    private buildRow(s: Setting, y: number, w: number) {
        const label = this.add.text(PAD + 6, y + ROW_H / 2, s.label, { fontFamily: 'monospace', fontSize: '15px', color: '#cfe6ff' }).setOrigin(0, 0.5);
        const value = this.add.text(w - 150, y + ROW_H / 2, '', { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff' }).setOrigin(0, 0.5);
        const minus = this.stepBtn('−', w - 96, y + ROW_H / 2, () => this.bump(s, -1));
        const plus = this.stepBtn('+', w - 54, y + ROW_H / 2, () => this.bump(s, +1));
        this.list.add([label, value, minus, plus]);
        this.rows.push({ setting: s, value });
    }

    private stepBtn(text: string, x: number, y: number, onTap: () => void) {
        const b = this.add.text(x, y, text, {
            fontFamily: 'monospace', fontSize: '17px', color: '#ffffff',
            backgroundColor: '#3a4350', padding: { x: 10, y: 4 },
        }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
        b.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 12) onTap(); });
        return b;
    }

    private bump(s: Setting, dir: number) {
        if (!bumpSetting(s, dir)) return;
        saveSettings();
        this.refreshValues();
    }

    private refreshValues() {
        for (const r of this.rows) {
            const v = r.setting.get();
            r.value.setText(r.setting.fmt ? r.setting.fmt(v) : String(v));
        }
    }

    private scrollBy(dy: number) {
        const minY = Math.min(LIST_TOP, this.scale.height - FOOTER_H - this.contentH);
        this.list.y = Phaser.Math.Clamp(this.list.y + dy, minY, LIST_TOP);
    }

    private footer: Phaser.GameObjects.GameObject[] = [];

    private buildFooter() {
        const w = this.scale.width;
        const h = this.scale.height;
        const bar = this.add.rectangle(0, h - FOOTER_H, w, FOOTER_H, 0x0e1620, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(20)
            .setStrokeStyle(1, 0x2a3543);
        const reset = this.add.text(PAD, h - FOOTER_H / 2, '⊘ Reset', {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', backgroundColor: '#6a3a3a', padding: { x: 12, y: 8 },
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(21).setInteractive({ useHandCursor: true });
        reset.on('pointerup', () => { resetSettings(); window.location.reload(); });
        const start = this.add.text(w - PAD, h - FOOTER_H / 2, '▶  Start Battle', {
            fontFamily: 'monospace', fontSize: '20px', color: '#ffffff', backgroundColor: '#2a8c4a', padding: { x: 20, y: 10 }, fontStyle: 'bold',
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(21).setInteractive({ useHandCursor: true });
        start.on('pointerup', () => this.scene.start('Game'));
        this.footer = [bar, reset, start];
    }

    private onResize() {
        // Reposition the screen-fixed footer and re-clamp the scroll to the new viewport.
        const w = this.scale.width;
        const h = this.scale.height;
        const [bar, reset, start] = this.footer as [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text, Phaser.GameObjects.Text];
        bar.setPosition(0, h - FOOTER_H).setSize(w, FOOTER_H);
        reset.setPosition(PAD, h - FOOTER_H / 2);
        start.setPosition(w - PAD, h - FOOTER_H / 2);
        this.scrollBy(0);
    }
}
