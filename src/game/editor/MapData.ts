// The map-editor data model. This is the thing the procedural battlefield never had: a
// concrete per-cell record of what the director painted. The EditorScene reads/writes it,
// the server persists it, and a future world generator will stitch several together.
//
// Foundation slice: a map is a grid of GROUND tiles (grass / water). `features` (trees,
// bushes, cliffs placed on top) is reserved for the next slice — it's already part of the
// shape so saved maps don't need migrating when features land.

export type TileId = string; // catalog id, e.g. 'grass' | 'water'

// A free-placed decoration on top of the ground (trees/bushes/rocks). Snapped to the grid
// but not strictly one-per-cell, since Tiny Swords props are bigger than a 64px tile.
export interface MapFeature {
    tileId: TileId;
    col: number;
    row: number;
    flipX?: boolean;
}

export interface MapData {
    id: string;
    name: string;
    cols: number;
    rows: number;
    tileSize: number; // px per cell (always 64 to match the game's terrain grid)
    /** One tile id per cell, row-major (index = row * cols + col). */
    ground: TileId[];
    /** Per-cell elevation tier, row-major, 0..MAX_LEVEL (0 = ground). Optional for back-compat;
     *  normalizeMap fills it with 0s so older saved maps load as a flat map. */
    levels?: number[];
    /** Decorations placed on top of the ground (empty in the foundation slice). */
    features: MapFeature[];
    createdAt: string;
    updatedAt: string;
}

/** Lightweight row for the map browser (no full ground array). */
export interface MapSummary {
    id: string;
    name: string;
    cols: number;
    rows: number;
    updatedAt: string;
}

export const DEFAULT_TILE_SIZE = 64;
export const DEFAULT_COLS = 16;
export const DEFAULT_ROWS = 16;
export const DEFAULT_GROUND: TileId = 'grass';
/** Highest paintable elevation tier (0 = ground, so 0..2 = three tiers). */
export const MAX_LEVEL = 2;

/** Cell index helper (row-major). */
export const cellIndex = (cols: number, col: number, row: number) => row * cols + col;

/** Make a fresh, all-grass map. New maps "start out as plain grass" per the brief. */
export function createEmptyMap(name = 'Untitled Map', cols = DEFAULT_COLS, rows = DEFAULT_ROWS): MapData {
    const now = new Date().toISOString();
    return {
        id: newId(),
        name,
        cols,
        rows,
        tileSize: DEFAULT_TILE_SIZE,
        ground: new Array(cols * rows).fill(DEFAULT_GROUND),
        levels: new Array(cols * rows).fill(0),
        features: [],
        createdAt: now,
        updatedAt: now,
    };
}

/** Best-effort unique id (crypto.randomUUID where available, else a timestamp-random). */
export function newId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Defensive load: coerce an unknown blob into a valid MapData (fills gaps from defaults). */
export function normalizeMap(raw: unknown): MapData {
    const m = (raw ?? {}) as Partial<MapData>;
    const cols = Math.max(1, Math.floor(m.cols ?? DEFAULT_COLS));
    const rows = Math.max(1, Math.floor(m.rows ?? DEFAULT_ROWS));
    const wanted = cols * rows;
    const ground: TileId[] = Array.isArray(m.ground) ? m.ground.slice(0, wanted) : [];
    while (ground.length < wanted) ground.push(DEFAULT_GROUND);
    // Elevation tiers: pad/truncate to the grid, clamped to valid range (older maps → all 0).
    const levels: number[] = Array.isArray(m.levels) ? m.levels.slice(0, wanted).map((v) => Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(v) || 0)))) : [];
    while (levels.length < wanted) levels.push(0);
    const now = new Date().toISOString();
    return {
        id: m.id || newId(),
        name: m.name || 'Untitled Map',
        cols,
        rows,
        tileSize: m.tileSize || DEFAULT_TILE_SIZE,
        ground,
        levels,
        features: Array.isArray(m.features) ? m.features : [],
        createdAt: m.createdAt || now,
        updatedAt: m.updatedAt || now,
    };
}

export const mapSummary = (m: MapData): MapSummary => ({
    id: m.id,
    name: m.name,
    cols: m.cols,
    rows: m.rows,
    updatedAt: m.updatedAt,
});
