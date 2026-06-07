import * as Phaser from 'phaser';
import { screenOffset } from '../controls/billboard';

// Cliff-face derivation for the editor's elevation system. Cliffs are NOT stored — they are
// derived from the per-cell `levels[]` and the current camera orientation, so the same physical
// edge reads as a rock face / side / open-grass depending on the view angle.
//
// A rock FACE shows on the edge currently facing the viewer (screen-down); side edges
// (screen-left / -right) show the matching left/right rock pieces; the back edge stays open
// grass (the higher plateau just overhangs it). On a 90° turn the "front" world-direction
// changes, so faces move to the new viewer-facing edge.

// Tileset frames (same layout in every grass-colour variant): a 3-wide rock wall (left / mid /
// right end) over a matching base/foot row.
export const FACE_L = 41;
export const FACE_M = 42;
export const FACE_R = 43;
export const BASE_L = 50;
export const BASE_M = 51;
export const BASE_R = 52;
// The pack has no front-facing stair art; reuse the "left up" column as a placeholder for now.
export const STAIR_PLACEHOLDER_FRAME = 45;

const CARDINALS = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: 1, dr: 0 }, { dc: -1, dr: 0 }];

/** The world direction (col/row delta) that currently points DOWN on screen (toward the viewer)
 *  — the edge that should show a rock cliff face. Snaps to N/E/S/W at each 90° orientation. */
export function frontDir(scene: Phaser.Scene): { dc: number; dr: number } {
    const up = screenOffset(scene, 0, 1);
    let best = CARDINALS[1];
    let bestDot = Infinity;
    for (const d of CARDINALS) {
        const dot = d.dc * up.x + d.dr * up.y; // most negative = most "down on screen"
        if (dot < bestDot) { bestDot = dot; best = d; }
    }
    return best;
}

/** The world direction that currently points RIGHT on screen (the edge cliffs run along). */
export function screenRightDir(scene: Phaser.Scene): { dc: number; dr: number } {
    const r = screenOffset(scene, 1, 0);
    let best = CARDINALS[2];
    let bestDot = -Infinity;
    for (const d of CARDINALS) {
        const dot = d.dc * r.x + d.dr * r.y;
        if (dot > bestDot) { bestDot = dot; best = d; }
    }
    return best;
}
