// Lanebreaker runtime server: serves the static Vite build (dist/) AND a tiny stats API backed
// by SQLite. Dependency-free — uses Node's built-in http + node:sqlite (Node 22, run with
// --experimental-sqlite). If the DB can't be opened the server still serves the game and accepts
// stat POSTs as no-ops, so a storage problem never takes the site down.
//
//   POST /api/matches      → store one finished match (JSON body = the client's MatchSummary)
//   GET  /api/matches?limit → recent matches (newest first)
//   GET  /api/stats         → quick aggregate (counts, win rates, averages)
//
// DB_PATH (default ./data/lanebreaker.db) — point at a mounted volume on Railway to persist
// across redeploys. PORT (default 8080) is provided by Railway.

import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';

const PORT = Number(process.env.PORT) || 8080;
const DIST = join(process.cwd(), 'dist');
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'lanebreaker.db');
const MAX_BODY = 512 * 1024;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

// ---- DB (best-effort) -------------------------------------------------------
let db = null;
let insertStmt = null;
try {
    const { DatabaseSync } = await import('node:sqlite');
    await mkdir(dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        started_at TEXT, ended_at TEXT, duration_ms INTEGER,
        winner TEXT, player_keep_hp INTEGER, enemy_keep_hp INTEGER,
        player_produced INTEGER, enemy_produced INTEGER,
        player_kills INTEGER, enemy_kills INTEGER,
        summary TEXT NOT NULL
    )`);
    insertStmt = db.prepare(`INSERT INTO matches
        (created_at, started_at, ended_at, duration_ms, winner, player_keep_hp, enemy_keep_hp,
         player_produced, enemy_produced, player_kills, enemy_kills, summary)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    console.log(`[stats] SQLite ready at ${DB_PATH}`);
} catch (err) {
    console.error('[stats] SQLite unavailable — stats will not persist:', err?.message ?? err);
}

function saveMatch(s) {
    if (!insertStmt) return false;
    const pf = s?.factions?.player ?? {};
    const ef = s?.factions?.enemy ?? {};
    insertStmt.run(
        new Date().toISOString(), s?.startedAt ?? null, s?.endedAt ?? null,
        s?.durationMs ?? null, s?.winner ?? null, s?.playerKeepHp ?? null, s?.enemyKeepHp ?? null,
        pf.unitsProduced ?? null, ef.unitsProduced ?? null, pf.kills ?? null, ef.kills ?? null,
        JSON.stringify(s),
    );
    return true;
}

// ---- helpers ----------------------------------------------------------------
const json = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function serveStatic(req, res) {
    let pathname = '/';
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { /* keep / */ }
    // Resolve safely inside DIST; SPA-style fallback to index.html for extension-less paths.
    let rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\') rel = '/index.html';
    let file = join(DIST, rel);
    try {
        let info = await stat(file).catch(() => null);
        if (!info || info.isDirectory()) {
            if (!extname(rel)) { file = join(DIST, 'index.html'); info = await stat(file).catch(() => null); }
        }
        if (!info) { res.writeHead(404); res.end('Not found'); return; }
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(500); res.end('Server error');
    }
}

// ---- routing ----------------------------------------------------------------
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/matches' && req.method === 'POST') {
        try {
            const summary = JSON.parse(await readBody(req));
            const stored = saveMatch(summary);
            json(res, 200, { ok: true, stored });
        } catch (err) {
            json(res, 400, { ok: false, error: String(err?.message ?? err) });
        }
        return;
    }

    if (url.pathname === '/api/matches' && req.method === 'GET') {
        if (!db) return json(res, 200, { matches: [] });
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const rows = db.prepare('SELECT * FROM matches ORDER BY id DESC LIMIT ?').all(limit);
        return json(res, 200, { matches: rows.map((r) => ({ ...r, summary: JSON.parse(r.summary) })) });
    }

    if (url.pathname === '/api/stats' && req.method === 'GET') {
        if (!db) return json(res, 200, { total: 0 });
        const agg = db.prepare(`SELECT
            COUNT(*) AS total,
            SUM(winner='player') AS player_wins,
            SUM(winner='enemy') AS enemy_wins,
            AVG(duration_ms) AS avg_duration_ms,
            AVG(player_produced) AS avg_player_produced,
            AVG(enemy_produced) AS avg_enemy_produced
        FROM matches`).get();
        return json(res, 200, agg);
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => console.log(`[lanebreaker] serving dist + /api on :${PORT}`));
