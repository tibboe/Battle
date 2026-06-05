import { MapData, MapSummary, mapSummary, normalizeMap } from './MapData';

// Persistence for editor maps. The director chose the Node/SQLite server as the durable
// home (so maps survive redeploys and sync across devices, like match stats). But the
// primary test loop is `npm run dev` on a phone, where only Vite is running and there is
// no /api — so we ALSO mirror every map to localStorage. That makes the editor fully
// usable offline/in dev; the server is just the cross-device source of truth on top.
//
// Strategy: writes go to BOTH (localStorage instantly, server best-effort). Reads merge
// both, server winning on ties. Nothing here throws — a storage hiccup never breaks editing.

const LS_KEY = 'lanebreaker.maps.v1';
const API = '/api/maps';

type LocalBag = Record<string, MapData>;

function readLocal(): LocalBag {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return {};
        const bag = JSON.parse(raw) as LocalBag;
        return bag && typeof bag === 'object' ? bag : {};
    } catch {
        return {};
    }
}

function writeLocal(bag: LocalBag) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(bag));
    } catch {
        /* quota / disabled storage — ignore, server may still hold it */
    }
}

async function serverList(): Promise<MapSummary[] | null> {
    try {
        const res = await fetch(API, { headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const data = (await res.json()) as { maps?: MapSummary[] };
        return data.maps ?? [];
    } catch {
        return null; // server not running (e.g. plain vite dev) — fall back to local
    }
}

async function serverGet(id: string): Promise<MapData | null> {
    try {
        const res = await fetch(`${API}/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        return normalizeMap(await res.json());
    } catch {
        return null;
    }
}

async function serverSave(map: MapData): Promise<boolean> {
    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(map),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function serverDelete(id: string): Promise<boolean> {
    try {
        const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return res.ok;
    } catch {
        return false;
    }
}

export const MapStore = {
    /** List saved maps, newest first. Merges server + local (server wins on id collision). */
    async list(): Promise<MapSummary[]> {
        const local = Object.values(readLocal()).map(mapSummary);
        const remote = await serverList();
        const byId = new Map<string, MapSummary>();
        for (const m of local) byId.set(m.id, m);
        if (remote) for (const m of remote) byId.set(m.id, m); // server overrides local
        return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    /** Load one full map. Prefers the server copy, falls back to the local mirror. */
    async load(id: string): Promise<MapData | null> {
        const remote = await serverGet(id);
        if (remote) return remote;
        const local = readLocal()[id];
        return local ? normalizeMap(local) : null;
    },

    /** Save (upsert). Writes local immediately; reports whether the server also accepted it. */
    async save(map: MapData): Promise<{ local: boolean; server: boolean }> {
        map.updatedAt = new Date().toISOString();
        const bag = readLocal();
        bag[map.id] = map;
        writeLocal(bag);
        const server = await serverSave(map);
        return { local: true, server };
    },

    /** Delete from both stores. */
    async remove(id: string): Promise<void> {
        const bag = readLocal();
        delete bag[id];
        writeLocal(bag);
        await serverDelete(id);
    },
};
