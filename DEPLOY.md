# Deploying Lanebreaker (Railway)

The `Dockerfile` builds the Vite bundle and runs a tiny dependency-free Node server
(`server/index.mjs`) that serves `/dist` **and** a small stats API, on Railway's `$PORT`.
This gives you a public URL you can open in the browser on your phone from anywhere — no
laptop or wifi tether needed.

## One-time setup on Railway

1. **railway.app → New Project → Deploy from GitHub repo** → pick this repo.
   (Authorise Railway for the repo if it asks.)
2. Open the service → **Settings → Source** and set the **branch** to the one you want to
   test (e.g. `claude/milestone-4-economy-ET6F4`). Railway defaults to `main`, which may
   not have the latest work.
3. Railway detects the `Dockerfile` automatically — no build/start commands to configure.
   The first deploy runs `npm ci` → `npm run build` → runs `server/index.mjs`.
4. **Settings → Networking → Generate Domain** (under Public Networking). You'll get a URL
   like `lanebreaker-production.up.railway.app`. Open that on your phone.

The game runs with no env vars (Railway provides `$PORT`). For stats to **persist across
redeploys**, add a volume (next section) — otherwise the SQLite file is ephemeral and resets
on each deploy.

## Match stats database

Every finished match POSTs a detailed summary to `POST /api/matches`; the server stores it in
SQLite (`node:sqlite`, no extra dependency). Endpoints:

- `POST /api/matches` — store one match (the game does this automatically on win/lose).
- `GET  /api/matches?limit=50` — recent matches, newest first (full JSON summary included).
- `GET  /api/stats` — quick aggregate (counts, win split, average duration / units produced).

**Persist it on Railway:** add a **Volume** to the service (Settings → Volumes) mounted at
`/data`. The Dockerfile already sets `DB_PATH=/data/lanebreaker.db`, so the DB lives on the
volume and survives redeploys. To analyse, hit `…up.railway.app/api/matches` in a browser, or
point any SQLite tool at the volume's `lanebreaker.db`. If SQLite ever fails to open, the
server logs it and keeps serving the game (stats just won't persist) — a DB hiccup never takes
the site down.

## Testing a new version

Auto-deploy is on by default for the connected branch, so the loop is just:

```
git push        # to the deployed branch
```

Railway rebuilds and redeploys in ~1–2 min; refresh the URL on your phone. (Watch the
build in the Railway **Deployments** tab if you want to confirm it picked up the push.)

Because this is a plain browser URL, a hard refresh always shows the latest — there's no
service-worker cache to fight yet. (That changes if/when we add the installable PWA layer;
see the notes in chat.)

## Running the container locally (optional sanity check)

```
docker build -t lanebreaker .
docker run --rm -p 8080:8080 -v lanebreaker-data:/data lanebreaker
# open http://localhost:8080   (stats persist in the named volume)
```

Or without Docker, after `npm run build`:

```
npm start   # node --experimental-sqlite server/index.mjs — serves dist + /api on :8080
```
