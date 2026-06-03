import * as Phaser from 'phaser';
import { CONFIG, Cost } from '../config';
import { FACTION, Faction, UnitManager } from '../units/UnitManager';
import { ResourceStore } from '../economy/ResourceStore';
import { Buildings } from '../structures/buildings';
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
const BAR_H = 150;
const PAD = 12;
const CARD_GAP = 10;
const CARD_H = 92;
const CARD_MAX_W = 196;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const costLine = (c: Cost) => `G ${c.gold}  S ${c.stone}  W ${c.wood}`;

// One option rendered as a card. `onTap` runs when an enabled card is pressed.
interface Card {
    name: string;
    desc: string;
    foot: string;       // cost line, "owned", etc.
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
                    name: cap(def.key) + (def.produces ? '' : ' (peasants)'),
                    desc: def.produces ? `Makes ${def.produces}s` : 'Trains peasants',
                    foot: afford ? costLine(def.cost) : `Need ${costLine(def.cost)}`,
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
                desc: u.desc,
                foot: owned ? 'Owned' : (afford ? costLine(cost) : `Need ${costLine(cost)}`),
                state: owned ? 'owned' : (afford ? 'buy' : 'locked'),
                onTap: () => {
                    if (owned || !this.store.spend(FACTION.player, cost)) return;
                    purchaseUpgrade(u.key);
                    this.units.recomputeUpgrades(); // no-op for peasant upgrades; cheap
                    this.render(); // flip this card to Owned, re-check the rest
                },
            };
        });
        const title = sel.tag === 'general' ? 'Castle upgrades'
            : sel.tag === 'house' ? 'Peasant upgrades'
            : `${cap(sel.tag)} upgrades`;
        return { title, cards: cards.length ? cards : [] };
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
        this.title.setPosition(PAD, barY + 10).setText(title).setVisible(true);
        this.closeBtn.setPosition(W - this.closeBtn.width - 10, barY + 8).setVisible(true);

        if (!cards.length) {
            const t = this.scene.add.text(PAD, barY + 50, 'No upgrades yet.',
                { fontFamily: 'monospace', fontSize: '14px', color: '#9fb3c8' })
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
        const cy = barY + 42;

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
        const name = this.scene.add.text(x + 8, y + 8, c.name,
            { fontFamily: 'monospace', fontSize: '14px', color: lit ? '#e8f1ff' : '#6b7886' })
            .setScrollFactor(0).setDepth(DEPTH + 2);
        const desc = this.scene.add.text(x + 8, y + 30, c.desc,
            { fontFamily: 'monospace', fontSize: '10px', color: lit ? '#8aa0b5' : '#5a6572',
              wordWrap: { width: w - 16 } })
            .setScrollFactor(0).setDepth(DEPTH + 2);
        const foot = this.scene.add.text(x + 8, y + CARD_H - 18, c.foot,
            { fontFamily: 'monospace', fontSize: '10px',
              color: c.state === 'owned' ? '#7be08a' : c.state === 'buy' ? '#c0b46a' : '#5a6572' })
            .setScrollFactor(0).setDepth(DEPTH + 2);
        this.layer.add([card, name, desc, foot]);
        this.cardObjects.push(card, name, desc, foot);
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
