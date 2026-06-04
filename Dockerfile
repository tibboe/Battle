# Railway (and any container host) deployment for Lanebreaker.
# Two stages: build the static Vite bundle, then serve /dist + the stats API with a tiny
# dependency-free Node server (server/index.mjs, uses Node 22's built-in node:sqlite).

# ---- build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage -----------------------------------------------------------
FROM node:22-alpine AS run
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
# Railway injects $PORT at runtime; fall back to 8080 for local `docker run`.
# DB_PATH should point at a mounted Railway VOLUME so match stats survive redeploys (e.g. mount
# a volume at /data). Without a volume the server still runs, but the SQLite file lives on
# ephemeral storage and resets on each redeploy.
ENV PORT=8080
ENV DB_PATH=/data/lanebreaker.db
EXPOSE 8080
CMD ["node", "--experimental-sqlite", "server/index.mjs"]
