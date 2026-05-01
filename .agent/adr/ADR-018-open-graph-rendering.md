# ADR-018 : Stratégie de rendu Open Graph (preview liens publics)

**Date** : 2026-05-01
**Statut** : Accepté

## Contexte

Les pages publiques Nexus (`/e/:slug` events, `/p/:slug` polls, `/d/:slug` expenses, `/t/:slug` todos, `/l/:slug` lists) sont partagées dans Discord/WhatsApp/Messenger/iMessage par les utilisateurs (cf. ADR-010 : pas d'auto-post, l'utilisateur copie le lien et le colle). Pour qu'un lien donne une **preview riche** dans la conversation source (titre, description, image), il faut :

1. Une **image dynamique** par ressource (exemple : "Soirée chez Manu — samedi 20h" + 4 avatars RSVP), idéalement générée serveur-side et cachée.
2. Des **balises Open Graph** (`og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`) dans le HTML servi à l'URL publique.

Deux contraintes :

- On tourne sur un **VPS Hostinger** (pas de Vercel Edge Functions, pas de Lambda) — donc il faut une stack qui s'exécute en Node natif.
- L'app web est une **SPA Vite** (cf. ADR-014) — pas de SSR React out-of-the-box. Le HTML servi est un `index.html` minimal qui hydrate ensuite côté client.

## Options envisagées

### A. Génération de l'image

**Option A1 — Satori standalone + @resvg/resvg-js** (retenu)
- `satori` (Vercel, MIT) prend un arbre JSX-like et produit du SVG. ~250kb, runtime Node pur.
- `@resvg/resvg-js` (binding Rust → WASM) convertit le SVG en PNG, ~5-10ms par image.
- Pas de Chromium headless. Pas de dépendance vendor.
- **Pros** : léger, rapide, déterministe, pas de browser à installer sur le VPS.
- **Cons** : pas tout le CSS supporté (subset documenté), il faut bundler les fonts.

**Option A2 — @vercel/og**
- Wrapper convenience autour de Satori + resvg, optimisé pour Vercel Edge.
- **Pros** : DX un peu meilleure.
- **Cons** : couplé à Vercel, dépendance vendor pour pas grand-chose vu qu'on assemble Satori + resvg directement.

**Option A3 — Puppeteer / Playwright headless**
- Un Chrome embarqué qui screenshot une page React.
- **Pros** : full CSS, fidélité parfaite.
- **Cons** : ~300 Mo d'image Docker, ~500 Mo de RAM, ~500ms par render. Inadapté pour notre VPS et notre cadence.

### B. Injection des meta tags

**Option B1 — `react-helmet-async` côté SPA uniquement** (retenu pour J5a, suffisant pour Discord/WA/iMessage)
- Le client React modifie `<head>` au montage de la page publique.
- Discord, WhatsApp, iMessage Apple, Telegram exécutent du JS moderne dans leur prévisualiseur — ils voient les balises injectées.
- **Pros** : zéro infra, marche immédiatement, pas de duplication serveur.
- **Cons** : Slack, Twitter (X) et certains crawlers anciens lisent le HTML brut sans exécuter JS — ils ne voient que les balises par défaut de `index.html`.

**Option B2 — SSR meta-tag injection serveur-side**
- Backend Fastify capture les routes `/e/:slug`, `/p/:slug`, etc., fetch la ressource, lit `dist/index.html`, injecte les meta tags via remplacement de placeholders, renvoie le HTML modifié. Caddy route ces paths vers le backend, le reste vers les statics.
- **Pros** : preview parfaite partout.
- **Cons** : ajoute du couplage backend ↔ build front, demande une config Caddy précise.
- **Décision** : reporté en **J9 (déploiement)** parce que ça touche au routing Caddy qui n'est pas encore en place. Tracé en backlog 🟠.

**Option B3 — Pre-rendering au build**
- Vite SSG (vite-plugin-ssr / vike) qui pré-rend les pages au build.
- **Cons** : inadapté car contenu dynamique (un nouvel event créé après le build n'aurait pas de preview).

## Décision

**A1 + B1** pour J5a, **B2 reporté en J9** :

1. Endpoint `GET /api/v1/public/og/:type/:slug.png` côté backend Fastify avec :
   - `satori` pour SVG depuis JSX (1 template par type : event, poll, expense, todo, list)
   - `@resvg/resvg-js` pour PNG (1200×630, format standard Open Graph)
   - Cache Redis clé `og:<type>:<slug>:<updatedAt>` TTL 30 jours
   - Headers `Cache-Control: public, max-age=2592000, immutable`
   - Fonts Inter (Regular + Bold) embarquées dans le bundle (downloadées au build via script)

2. Côté SPA : `react-helmet-async` dans chaque écran public injecte :
   - `og:title`, `og:description`, `og:image` (URL absolue construite depuis `import.meta.env.VITE_API_BASE_URL`), `og:url`
   - `twitter:card=summary_large_image`, `twitter:image`
   - `theme-color`

3. **Reporté en J9** : route Fastify catch-all `/e/*`, `/p/*`, `/d/*`, `/t/*`, `/l/*` qui injecte les meta tags directement dans `dist/index.html` servi. Ça couvrira Slack/Twitter/crawlers no-JS. Tracé dans `.agent/backlog.md` : "🟠 J9 — SSR meta-tag injection pour pages publiques".

## Conséquences

**Positif** :
- DX simple (un endpoint Fastify + un hook helmet).
- Performance maîtrisée : ~10-20ms cold render Satori+resvg, <2ms cache hit Redis.
- Pas de browser headless sur le VPS, RAM économisée.
- Discord/WhatsApp/iMessage/Telegram (les cas d'usage principaux Nexus) marchent **dès J5a**.

**Négatif** :
- Slack/Twitter/no-JS crawlers ratent la preview en dev/staging. Acceptable parce que ce ne sont pas les canaux ciblés — fixé en J9 quand le déploiement sera réel.
- Subset CSS limité (Satori) : il faut écrire les templates avec discipline (pas de `gap`, pas de `clamp()`, etc.). Compensé par le fait qu'on a 1 template par type, format figé.

**Neutre** :
- Les fonts ajoutent ~150kb au bundle backend. Acceptable.
- Le cache Redis évite la re-génération mais demande un mécanisme d'invalidation : on encode `updatedAt` dans la clé, donc dès qu'on mute un event, l'ancienne entrée devient orpheline (purge naturelle au TTL).
