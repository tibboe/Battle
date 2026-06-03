import { CONFIG } from '../config';

// Player unit command model: the order a unit is following, and the formation maths for laying
// out a group of units into a shape at a target point. Kept as plain data + pure functions so
// both the UnitManager (which stores an order per unit) and the command UI can share it.

// What a unit is currently doing. Enemy units (and un-commanded player units) stay `auto`.
export const ORDER = {
    auto: 0,        // march on the enemy keep, engaging anything in aggro range (the default)
    move: 1,        // walk to a point, ignoring enemies; hold on arrival
    attackMove: 2,  // walk to a point, engaging enemies on the way; hold on arrival
    hold: 3,        // stand on an anchor, only striking enemies that come into range
    free: 4,        // hunt enemies within an area around an anchor; return to it when none
} as const;
export type Order = (typeof ORDER)[keyof typeof ORDER];

// Formation footprint. All face the enemy base: width spreads across the lane (y), depth runs
// along the advance axis (x), so a `line` is a wall across the lane.
export const SHAPE = { rectangle: 0, square: 1, line: 2 } as const;
export type Shape = (typeof SHAPE)[keyof typeof SHAPE];

export const SHAPE_LABEL: Record<Shape, string> = {
    [SHAPE.rectangle]: 'Rect',
    [SHAPE.square]: 'Square',
    [SHAPE.line]: 'Line',
};

export interface Slot { x: number; y: number; }

// A "tap the field to place something" interaction (shared by skills and unit commands). The
// scene routes pointer events into it: onMove as the finger drags the preview, onCommit on a
// tap, onCancel if the mode is abandoned (a new mode armed, or the field cleared).
export interface TargetingMode {
    onMove(wx: number, wy: number): void;
    onCommit(wx: number, wy: number): void;
    onCancel(): void;
}

// Number of columns (across the lane) × rows (in depth) for `n` units in a shape.
export function gridDims(n: number, shape: Shape): { cols: number; rows: number } {
    if (n <= 0) return { cols: 0, rows: 0 };
    if (shape === SHAPE.line) return { cols: n, rows: 1 };
    if (shape === SHAPE.square) {
        const cols = Math.ceil(Math.sqrt(n));
        return { cols, rows: Math.ceil(n / cols) };
    }
    // rectangle: roughly √2 wider than deep, so it reads as a broad front facing the enemy.
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 2)));
    return { cols, rows: Math.ceil(n / cols) };
}

// Lay out `n` slots for a shape centred on (cx, cy). Columns spread along y (across the lane),
// rows along x (depth). Slots are returned front-row-first (nearest the enemy = +x*face).
export function formationSlots(n: number, cx: number, cy: number, shape: Shape, spacing: number, face: number): Slot[] {
    const slots: Slot[] = [];
    if (n <= 0) return slots;
    const { cols, rows } = gridDims(n, shape);
    const colMid = (cols - 1) / 2;
    const rowMid = (rows - 1) / 2;
    let placed = 0;
    for (let r = 0; r < rows && placed < n; r++) {
        for (let c = 0; c < cols && placed < n; c++) {
            slots.push({
                // Front row (r = 0) sits furthest toward the enemy; deeper rows fall behind.
                x: cx + (rowMid - r) * spacing * face,
                y: cy + (c - colMid) * spacing,
            });
            placed++;
        }
    }
    return slots;
}

export function spacingFor(tight: boolean): number {
    return tight ? CONFIG.command.spacingTight : CONFIG.command.spacingLoose;
}
