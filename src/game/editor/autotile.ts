// Coastline / plateau autotiling. The Tiny Swords flat-ground block (cols 0–3) and the elevated
// plateau-grass block (cols 5–8) are the SAME 16-piece autotile, indexed by which of a cell's
// four edges show a boundary (N/E/S/W). The plateau block sits 5 columns to the right, so
// plateauFrame = flatFrame + 5. The table below was derived by scanning the tileset's per-tile
// edge boundaries.

export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;

// bitmask (N=1,E=2,S=4,W=8) → plateau-grass frame index.
const PLATEAU: readonly number[] = [
    15, // 0  none (interior)
    6,  // 1  N
    16, // 2  E
    7,  // 3  NE
    24, // 4  S
    33, // 5  NS
    25, // 6  ES
    34, // 7  NES
    14, // 8  W
    5,  // 9  NW
    17, // 10 EW
    8,  // 11 NEW
    23, // 12 SW
    32, // 13 NSW
    26, // 14 ESW
    35, // 15 NESW (fully bounded)
];

/** Elevated plateau-grass frame for a set of exposed (lower-neighbour) edges. */
export const plateauFrame = (bits: number): number => PLATEAU[bits & 15];

/** Flat-ground coastline frame for a set of exposed (water) edges (same layout − 5 columns). */
export const flatFrame = (bits: number): number => PLATEAU[bits & 15] - 5;
