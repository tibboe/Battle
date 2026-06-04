import * as Phaser from 'phaser';
import { CONFIG, Cost } from '../config';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { Buildings, buildingKey } from '../structures/buildings';
import { costOf, purchaseUpgrade, upgradeActive, upgradesForKind } from '../upgrades';

// The unified selection HUD (replaces the old stacked upgrade/build popups). Tapping a player
// object SELECTS it: a highlight ring marks it in the world, and a single bar along the BOTTOM
// of the screen shows that object's options as tappable cards:
//   • a producer building → that unit's upgrades
//   • your Castle         → the shared Armour/Melee/Ranged upgrades
//   • a House             → peasant upgrades
//   • an empty build slot → the build catalog
// Tap another object to switch, tap the ✕ (or blank ground) to clear. Screen-fixed bar on the
// UI layer; the highlight lives on the world layer so it tracks the object under pan/zoom.

const DEPTH = 1_000_010;
const BAR_H = 82;       // half the old height — takes less of the screen
const PAD = 10;
const CARD_GAP = 8;
const CARD_H = 56;
const CARD_MAX_W = 150;
const IMG = 40;         // card thumbnail size

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The resource columns shown stacked on a card (food isn't a build/upgrade cost). Each: key,
// short letter, and the colour used when affordable.
const COST_RES: { key: 'gold' | 'stone' | 'wood'; letter: string; color: string }[] = [
    { key: 'gold', letter: 'G', color: '#e8c34a' },
    { key: 'stone', letter: 'S', color: '#c2c2cc' },
    { key: 'wood', letter: 'W', color: '#c79a5a' },
];

// One option rendered as a card. `onTap` runs when an enabled card is pressed.
interface Card {
    name: string;
    image?: string;     // texture key (building art) shown at the left
    cost?: Cost;        // resource requirement, stacked on the right (red where short)
    note?: string;      // shown instead of costs (e.g. "Owned", a toggle hint)
    state: 'buy' | 'owned' | 'locked'; // colours the card
    onTap: () => void;
}

type Selection =
    | { type: 'upgrades'; tag: string }            // tag = unit key | 'general' | 'house'
    | { type: 'build'; faction: Faction; spot: number };

export class SelectionHud {
    private readonly scene: Phaser.Scene;
    private readonly layer: Phaser.GameObjects.Layer;
    private readonly units: UnitManager;
    private readonly store: ResourceStore;
    private readonly buildings: Buildings;

    private readonly bg: Phaser.GameObjects.Rectangle;
    private readonly title: Phaser.GameObjects.Text;
    private readonly closeBtn: Phaser.GameObjects.Text;
    private readonly highlight: Phaser.GameObjects.Rectangle;
    private cardObjects: Phaser.GameObjects.GameObject[] = [];

    private selection?: Selection;
    private selX = 0; // world position of the current selection (to target the tapped building)
    private selY = 0;

    constructor(
        scene: Phaser.Scene,
        layer: Phaser.GameObjects.Layer,
        worldLayer: Phaser.GameObjects.Layer,
        units: UnitManager,
        store: ResourceStore,
        buildings: Buildings,
    ) {
        this.scene = scene;
        this.layer = layer;
        this.units = units;
        this.store = store;
        this.buildings = buildings;

        // The bar is interactive (with no handler) so taps on its empty area are consumed
        // rather than falling through to the world's clear-selection catcher.
        this.bg = scene.add.rectangle(0, 0, 100, BAR_H, 0x0b1016, 0.96)
            .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0x3a4350).setDepth(DEPTH)
            .setInteractive().setVisible(false);
        this.title = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '17px', color: '#e8f1ff' })
            .setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
        this.closeBtn = scene.add.text(0, 0, '✕', {
            fontFamily: 'monospace', fontSize: '15px', color: '#ffffff',
            backgroundColor: '#5a3a3a', padding: { x: 9, y: 5 },
        }).setScrollFactor(0).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true }).setVisible(false);
        this.closeBtn.on('pointerup', () => this.clear());
        layer.add([this.bg, this.title, this.closeBtn]);

        // World-space selection ring (azure), pulsing, above the buildings.
        const g = CONFIG.grid;
        this.highlight = scene.add.rectangle(0, 0, g.cellW, g.cellH)
            .setStrokeStyle(3, 0x7fd0ff, 0.95).setDepth(CONFIG.world.height + 2000).setVisible(false);
        worldLayer.add(this.highlight);
        scene.tweens.add({ targets: this.highlight, alpha: { from: 1, to: 0.35 }, duration: 650, yoyo: true, repeat: -1 });
    }

    // ---- selection entry points (called from the Buildings tap callbacks) ----

    selectUpgrades(tag: string, x: number, y: number) {
        this.selection = { type: 'upgrades', tag };
        this.selX = x;
        this.selY = y;
        this.markAt(x, y);
        this.render();
    }

    selectBuild(faction: Faction, spot: number, x: number, y: number) {
        this.selection = { type: 'build', faction, spot };
        this.markAt(x, y);
        this.render();
    }

    clear() {
        this.selection = undefined;
        this.clearCards();
        this.bg.setVisible(false);
        this.title.setVisible(false);
        this.closeBtn.setVisible(false);
        this.highlight.setVisible(false);
    }

    private markAt(x: number, y: number) {
        this.highlight.setPosition(x, y).setVisible(true);
    }

    // ---- card model per selection ----

    private cardsFor(sel: Selection): { title: string; cards: Card[] } {
        if (sel.type === 'build') {
            const cards = CONFIG.production.catalog.map((def): Card => {
                const afford = this.store.canAfford(sel.faction, def.cost);
                return {
                    name: cap(def.key),
                    image: buildingKey(sel.faction, def.art),
                    cost: def.cost,
                    state: afford ? 'buy' : 'locked',
                    onTap: () => {
                        if (!this.store.spend(sel.faction, def.cost)) return;
                        this.buildings.startConstruction(sel.faction, sel.spot, def.key);
                        this.clear();
                    },
                };
            });
            return { title: 'Build', cards };
        }

        // upgrades
        const ups = upgradesForKind(sel.tag);
        const cards = ups.map((u): Card => {
            const owned = upgradeActive(u.key);
            const cost = costOf(u.key);
            const afford = this.store.canAfford(FACTION.player, cost);
            return {
                name: u.label,
                cost: owned ? undefined : cost,
                note: owned ? 'Owned' : undefined,
                state: owned ? 'owned' : (afford ? 'buy' : 'locked'),
                onTap: () => {
                    if (owned || !this.store.spend(FACTION.player, cost)) return;
                    purchaseUpgrade(u.key);
                    this.units.recomputeUpgrades(); // no-op for peasant upgrades; cheap
                    this.render(); // flip this card to Owned, re-check the rest
                },
            };
        });
        // Producer buildings (a unit-key tag, not the Castle or a House) get an enable/disable
        // toggle showing the per-unit food cost, ahead of their upgrades.
        if (sel.tag !== 'general' && sel.tag !== 'house') {
            const enabled = this.buildings.isProducerEnabled(this.selX, this.selY);
            const food = this.buildings.producerFoodCost(this.selX, this.selY);
            cards.unshift({
                name: enabled ? '⏸ Producing' : '▶ Paused',
                note: enabled ? `ON · ${food} food/unit` : 'OFF · tap to resume',
                state: 'buy',
                onTap: () => { this.buildings.toggleProducer(this.selX, this.selY); this.render(); },
            });
        }
        const title = sel.tag === 'general' ? 'Castle upgrades'
            : sel.tag === 'house' ? 'Peasant upgrades'
            : `${cap(sel.tag)} upgrades`;
        return { title, cards };
    }

    private render() {
        if (!this.selection) return;
        this.clearCards();
        const { title, cards } = this.cardsFor(this.selection);

        const W = this.scene.scale.width;
        const H = this.scene.scale.height;
        const barY = H - BAR_H;
        this.bg.setPosition(0, barY).setSize(W, BAR_H).setVisible(true);
        // Keep the (tap-blocking) hit area in sync with the resized bar.
        const hit = this.bg.input?.hitArea as Phaser.Geom.Rectangle | undefined;
        if (hit) hit.setTo(0, 0, W, BAR_H);
        this.title.setPosition(PAD, barY + 5).setText(title).setVisible(true);
        this.closeBtn.setPosition(W - this.closeBtn.width - 8, barY + 4).setVisible(true);

        if (!cards.length) {
            const t = this.scene.add.text(PAD, barY + 34, 'No upgrades yet.',
                { fontFamily: 'monospace', fontSize: '13px', color: '#9fb3c8' })
                .setScrollFactor(0).setDepth(DEPTH + 1);
            this.layer.add(t);
            this.cardObjects.push(t);
            return;
        }

        const n = cards.length;
        const avail = W - PAD * 2 - CARD_GAP * (n - 1);
        const cardW = Math.min(CARD_MAX_W, avail / n);
        const cardsW = cardW * n + CARD_GAP * (n - 1);
        const startX = (W - cardsW) / 2; // centre the row
        const cy = barY + 22;

        cards.forEach((c, i) => {
            const cx = startX + i * (cardW + CARD_GAP);
            this.drawCard(c, cx, cy, cardW);
        });
    }

    private drawCard(c: Card, x: number, y: number, w: number) {
        const stroke = c.state === 'owned' ? 0x2e6b3a : c.state === 'buy' ? 0x2a6cd6 : 0x33373d;
        const lit = c.state !== 'locked';
        const card = this.scene.add.rectangle(x, y, w, CARD_H, 0x121a24, 0.98)
            .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, stroke).setDepth(DEPTH + 1);
        if (c.state === 'buy' || c.state === 'owned') {
            card.setInteractive({ useHandCursor: true });
            card.on('pointerup', c.onTap);
        }
        this.cardObjects.push(card);

        let textX = x + 8;
        if (c.image) {
            const img = this.scene.add.image(x + 6 + IMG / 2, y + CARD_H / 2, c.image)
                .setDisplaySize(IMG, IMG).setScrollFactor(0).setDepth(DEPTH + 2);
            if (!lit) img.setTint(0x6a6a6a);
            this.cardObjects.push(img);
            textX = x + IMG + 14;
        }

        const name = this.scene.add.text(textX, y + 5, c.name,
            { fontFamily: 'monospace', fontSize: '12px', color: lit ? '#e8f1ff' : '#6b7886' })
            .setScrollFactor(0).setDepth(DEPTH + 2);
        this.cardObjects.push(name);

        if (c.note !== undefined) {
            const note = this.scene.add.text(textX, y + 26, c.note,
                { fontFamily: 'monospace', fontSize: '11px',
                  color: c.state === 'owned' ? '#7be08a' : '#9fb3c8' })
                .setScrollFactor(0).setDepth(DEPTH + 2);
            this.cardObjects.push(note);
        } else if (c.cost) {
            // Resource requirement stacked vertically; any resource you're short on shows the
            // shortfall in red.
            const have = this.store.bag(FACTION.player);
            let ry = y + 21;
            for (const r of COST_RES) {
                const need = c.cost[r.key];
                if (!need) continue;
                const lack = Math.max(0, need - have[r.key]);
                const txt = lack > 0 ? `${r.letter} ${need} (-${lack})` : `${r.letter} ${need}`;
                const t = this.scene.add.text(textX, ry, txt,
                    { fontFamily: 'monospace', fontSize: '10px', color: lack > 0 ? '#ff6a6a' : r.color })
                    .setScrollFactor(0).setDepth(DEPTH + 2);
                this.cardObjects.push(t);
                ry += 11;
            }
        }
    }

    private clearCards() {
        for (const o of this.cardObjects) o.destroy();
        this.cardObjects = [];
    }

    // Re-render while open so affordability tracks the stockpile as peasants bank / you spend.
    refresh() {
        if (this.selection) this.render();
    }

    layout() {
        if (this.selection) this.render();
    }
}
