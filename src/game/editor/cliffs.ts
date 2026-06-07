import * as Phaser from 'phaser';
import { screenOffset } from '../controls/billboard';

// Cliff-face derivation for the editor's elevation system. Cliffs are NOT stored — they are
// derived from the per-cell `levels[]` and the current camera orientation, so the same physical
// edge reads as a rock face / side / open-grass depending on the view angle (P2).
//
// We render a rock FACE only on the edge that currently faces the viewer (screen-down). On a
// 90° rotation the "front" world-direction changes, so the faces move to the new viewer-facing
// edge — exactly the director's "a cliff top at one angle is a cliff face at another".

// Mid rock-wall body / foot, chosen from the cell's own grass-colour tileset variant.
export const FACE_BODY = 42;
export const FACE_BASE = 51;
// The pack has no front-facing stair art; reuse the "left up" column as a placeholder for now.
export const STAIR_PLACEHOLDER_FRAME = 45;

/** The world direction (col/row delta) that currently points DOWN on screen (toward the viewer)
 *  — the edge that should show a rock cliff face. Snaps to N/E/S/W at each 90° orientation. */
export function frontDir(scene: Phaser.Scene): { dc: number; dr: number } {
    const up = screenOffset(scene, 0, 1); // world vector pointing up on screen
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: 1, dr: 0 }, { dc: -1, dr: 0 }];
    let best = dirs[1];
    let bestDot = Infinity;
    for (const d of dirs) {
        const dot = d.dc * up.x + d.dr * up.y; // most negative = most "down on screen"
        if (dot < bestDot) { bestDot = dot; best = d; }
    }
    return best;
}
