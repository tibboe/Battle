import { TILES, TILESET } from '../terrain/tileset';
import { WATER } from '../terrain/environment';
import type { TileId } from './MapData';

// The catalog is the single source of truth for everything paintable: it drives the palette
// (label + description + thumbnail), and tells the renderer how to draw each cell. The
// `category` path is what the future hierarchical browser groups by (Ground → Grass, etc.) —
// the foundation slice only ships the two ground tiles, but the shape is ready for trees,
// bushes and cliffs to be appended without touching the editor.

export interface TileDef {
    id: TileId;
    /** Hierarchy path for the browser, broad → narrow. */
    category: string[];
    label: string;
    desc: string;
    /** How to draw one cell of this tile. `transparent` means "draw nothing" — the water
     *  backdrop shows through (that's how we represent open sea on the grid). */
    render:
        | { kind: 'sprite'; atlas: string; frame: number }
        | { kind: 'transparent' };
    /** Swatch colour for simple palette chips before real thumbnails exist. */
    swatch: number;
}

export const TILE_CATALOG: TileDef[] = [
    {
        id: 'grass',
        category: ['Ground', 'Grass'],
        label: 'Grass',
        desc: 'Plain grass field. The default ground armies fight on.',
        render: { kind: 'sprite', atlas: TILESET.key, frame: TILES.flatFill },
        swatch: 0x5fa84e,
    },
    {
        id: 'water',
        category: ['Ground', 'Water'],
        label: 'Water',
        desc: 'Open sea. Carves the coastline — units cannot stand here.',
        render: { kind: 'transparent' },
        swatch: 0x2e6f9e,
    },
];

const BY_ID = new Map<TileId, TileDef>(TILE_CATALOG.map((t) => [t.id, t]));

export const getTile = (id: TileId): TileDef | undefined => BY_ID.get(id);

/** The water backdrop asset, surfaced so the EditorScene preloads it without re-importing. */
export const WATER_KEY = WATER.key;
export const WATER_FILE = WATER.file;
