# Deploying Lanebreaker (Railway)

The game is a static Vite build. The `Dockerfile` builds it and serves `/dist` with a
tiny static server on Railway's `$PORT`. This gives you a public URL you can open in the
browser on your phone from anywhere — no laptop or wifi tether needed.

## One-time setup on Railway

1. **railway.app → New Project → Deploy from GitHub repo** → pick this repo.
   (Authorise Railway for the repo if it asks.)
2. Open the service → **Settings → Source** and set the **branch** to the one you want to
   test (e.g. `claude/milestone-4-economy-ET6F4`). Railway defaults to `main`, which may
   not have the latest work.
3. Railway detects the `Dockerfile` automatically — no build/start commands to configure.
   The first deploy runs `npm ci` → `npm run build` → serves `dist`.
4. **Settings → Networking → Generate Domain** (under Public Networking). You'll get a URL
   like `lanebreaker-production.up.railway.app`. Open that on your phone.

That's it. No environment variables are required — Railway provides `$PORT` and the
container listens on it.

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
docker run --rm -p 8080:8080 lanebreaker
# open http://localhost:8080
```
