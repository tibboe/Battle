import * as Phaser from 'phaser';

// The launch menu: choose Play (→ the pre-game Setup screen → battle) or Map Editor
// (→ the map browser). Kept deliberately tiny; it's the first thing shown on load.
export class MenuScene extends Phaser.Scene {
    constructor() {
        super('Menu');
    }

    create() {
        this.cameras.main.setBackgroundColor('#0b1119');
        this.layout();
        this.scale.on('resize', this.layout, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    }

    private items: Phaser.GameObjects.GameObject[] = [];

    private layout = () => {
        for (const it of this.items) it.destroy();
        this.items = [];

        const w = this.scale.width;
        const h = this.scale.height;
        const cx = w / 2;

        const title = this.add.text(cx, h * 0.28, 'LANEBREAKER', {
            fontFamily: 'monospace', fontSize: '44px', color: '#e8f1ff', fontStyle: 'bold',
        }).setOrigin(0.5);
        const sub = this.add.text(cx, h * 0.28 + 40, 'auto-battler · map editor', {
            fontFamily: 'monospace', fontSize: '14px', color: '#7fd0ff',
        }).setOrigin(0.5);
        this.items.push(title, sub);

        const btn = (y: number, text: string, bg: string, onTap: () => void) => {
            const b = this.add.text(cx, y, text, {
                fontFamily: 'monospace', fontSize: '22px', color: '#ffffff',
                backgroundColor: bg, padding: { x: 28, y: 14 }, fontStyle: 'bold',
            }).setOrigin(0.5).setInteractive({ useHandCursor: true });
            b.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 14) onTap(); });
            this.items.push(b);
        };

        btn(h * 0.5, '▶  Play', '#2a8c4a', () => this.scene.start('Setup'));
        btn(h * 0.5 + 70, '✏️  Map Editor', '#33455a', () => this.scene.start('MapBrowser'));
    };
}
