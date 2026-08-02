# syntax=docker/dockerfile:1
# Dockerfile multi-stage pour @nexus/backend.
#
# Cf. ADR-011 — Pipeline CI/CD (image GHCR → VPS).
# Build context : racine du monorepo (pnpm workspaces).
#
# Stages :
#   1. base    — node:22-alpine + corepack pnpm
#   2. deps    — install all deps (avec devDeps pour le build TS)
#   3. builder — build @nexus/shared puis @nexus/backend (tsc → dist/)
#   4. runner  — image finale slim avec dist/ + node_modules production
#
# Image finale ~150-250 MB sur node:22-alpine.

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=9.15.9

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — base
# ─────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base

# libc6-compat pour les binaires natifs (argon2, etc.)
# corepack pour pnpm sans installation globale
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — deps (full install, incluant devDeps pour le build TS)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps

# Outils de build pour modules natifs (argon2, sharp-like)
RUN apk add --no-cache python3 make g++

# Workspace metadata
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json  ./packages/shared/

# Cache pnpm pour layer reuse
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — builder (tsc → dist/)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS builder

# Recopie node_modules + metadata depuis le stage deps
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=deps /app/packages/backend/package.json   ./packages/backend/package.json
COPY --from=deps /app/packages/backend/node_modules   ./packages/backend/node_modules
COPY --from=deps /app/packages/shared/package.json    ./packages/shared/package.json
COPY --from=deps /app/packages/shared/node_modules    ./packages/shared/node_modules

# Configs partagées
COPY tsconfig.base.json turbo.json ./

# Sources (filtrées par .dockerignore)
COPY packages/shared  ./packages/shared
COPY packages/backend ./packages/backend

# Build shared d'abord, backend ensuite (resolve workspace deps)
RUN pnpm --filter @nexus/shared  build \
 && pnpm --filter @nexus/backend build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4 — runner (image finale, prod deps uniquement)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS runner

ENV NODE_ENV=production
# Bind sur toutes interfaces dans le container (Traefik route via réseau Docker)
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3000

# Workspace metadata + lockfile
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Backend : package.json + dist + drizzle migrations + assets (fonts OG)
COPY --from=builder /app/packages/backend/package.json ./packages/backend/
COPY --from=builder /app/packages/backend/dist         ./packages/backend/dist
COPY --from=builder /app/packages/backend/drizzle      ./packages/backend/drizzle
COPY --from=builder /app/packages/backend/assets       ./packages/backend/assets

# Shared : package.json + dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist         ./packages/shared/dist

# Install prod deps uniquement (devDeps exclues : tsx, vitest, eslint, etc.)
# Inclut drizzle-kit (déplacé en deps pour les migrations en prod).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod \
 && pnpm store prune

# Run as non-root
RUN chown -R node:node /app
USER node

WORKDIR /app/packages/backend

EXPOSE 3000

# Healthcheck via fetch natif Node 22+ (pas de curl/wget dans alpine slim)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Entrypoint par défaut = serveur principal.
# Workers et job migrate sont lancés via override de CMD dans docker-compose.
CMD ["node", "dist/index.js"]
