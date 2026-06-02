# Railway (and any container host) deployment for Lanebreaker.
# Two stages: build the static Vite bundle, then serve /dist with a tiny static server.
# `serve` lives only in this image — it is NOT a project dependency.

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
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
# Railway injects $PORT at runtime; fall back to 8080 for local `docker run`.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "serve -s dist -l ${PORT:-8080}"]
