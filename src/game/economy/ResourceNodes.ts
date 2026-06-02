import * as Phaser from 'phaser';
import { CONFIG, ResourceType } from '../config';
import { ROCKS, TREES } from '../terrain/environment';

// The harvestable resource nodes on the island (Milestone 4). Placement, type and the
// finite/infinite flag all come from CONFIG.nodes. Art is reused from the pack to avoid new
// assets: GOLD loads the Gold Resource pile; STONE reuses the scatter rocks; WOOD reuses the
// animated trees (so a "wood node" is just a fat choppable tree). Each node exposes its world
// position; peasants ask for the nearest LIVE node of a type, harvest a load from it, and a
// finite node hides itself once drained.

const GOLD_KEY = 'node-gold';
const GOLD_FILE = 'assets/environment/tiny-swords/Resources/Gold/Gold Resource/Gold_Resource.png';

export interface ResourceNode {
    type: ResourceType;
    x: number;
    y: number;
    finite: boolean;
    remaining: number; // Infinity for inexhaustible nodes
    alive: boolean;
    sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
}

export function loadResourceNodes(scene: Phaser.Scene) {
    // Stone (rocks) and wood (trees) art is already loaded by the environment; only the gold
    // pile is new.
    scene.load.image(GOLD_KEY, encodeURI(GOLD_FILE));
}

export class ResourceNodes {
    private readonly nodes: ResourceNode[] = [];

    constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
        const rnd = Phaser.Math.RND;
        for (const def of CONFIG.nodes.list) {
            const scale = CONFIG.nodes.scale[def.type];
            let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

            if (def.type === 'gold') {
                sprite = scene.add.image(def.x, def.y, GOLD_KEY);
            } else if (def.type === 'stone') {
                // Biggest-looking rock variant reads as a stone deposit.
                const rock = ROCKS[2] ?? ROCKS[0];
                sprite = scene.add.image(def.x, def.y, rock.key);
            } else {
                // Wood: an animated tree (a chunkier instance of the forest art).
                const tree = TREES[rnd.between(0, TREES.length - 1)];
                const s = scene.add.sprite(def.x, def.y, tree.key).play(tree.anim);
                s.anims.setProgress(rnd.frac());
                sprite = s;
            }

            sprite.setOrigin(0.5, 0.9).setScale(scale).setDepth(def.y); // sort with units by base-y
            layer.add(sprite);

            this.nodes.push({
                type: def.type,
                x: def.x,
                y: def.y,
                finite: def.finite,
                remaining: def.finite ? CONFIG.nodes.finiteAmount : Infinity,
                alive: true,
                sprite,
            });
        }
    }

    // Is any node of `type` still alive? (Used by the peasant allocator to avoid sending
    // workers to a fully-drained resource.)
    anyLive(type: ResourceType): boolean {
        for (const n of this.nodes) if (n.alive && n.type === type) return true;
        return false;
    }

    // Nearest live node of `type` to (x, y), or undefined if all of that type are drained.
    nearest(type: ResourceType, x: number, y: number): ResourceNode | undefined {
        let best: ResourceNode | undefined;
        let bestD2 = Infinity;
        for (const n of this.nodes) {
            if (!n.alive || n.type !== type) continue;
            const dx = n.x - x;
            const dy = n.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = n;
            }
        }
        return best;
    }

    // Take up to `amount` from a node; returns how much was actually drawn (a finite node may
    // hold less). A drained finite node dies and its art fades out.
    harvest(node: ResourceNode, amount: number): number {
        if (!node.alive) return 0;
        if (!node.finite) return amount;
        const taken = Math.min(amount, node.remaining);
        node.remaining -= taken;
        if (node.remaining <= 0) this.deplete(node);
        return taken;
    }

    private deplete(node: ResourceNode) {
        node.alive = false;
        // Quick fade so a drained node visibly disappears rather than popping out.
        node.sprite.scene.tweens.add({
            targets: node.sprite,
            alpha: 0,
            duration: 500,
            onComplete: () => node.sprite.destroy(),
        });
    }
}
