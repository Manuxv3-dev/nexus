# ADR-016 : Implémentation du design system Nexus à partir du bundle handoff

**Date** : 2026-05-01
**Statut** : Accepté

## Contexte

Manu a livré un bundle de design (`nexus_design.zip`) produit dans Claude
Design (claude.ai/design) contenant 8 écrans HTML + tokens CSS + composants
React mock. Le brief explicite côté README du bundle :

> Find the primary design file under `nexus/project/` and read it top to
> bottom. Then follow its imports : open every file it pulls in (shared
> components, CSS, scripts) so you understand how the pieces fit together
> before you start implementing.

Le bundle livre :
- `Landing Page.html` — page publique nexusapp.chat
- `Auth & Onboarding.html` — login / register / forgot / onboarding
- `App Prototype.html` — UI 3-pane (groupes + channels + conversation)
- `Mobile Prototype.html` — navigation mobile par stack
- `Réglages.html` — profil / notifications / connexions / sécurité
- `Pages Publiques.html` — `/e /p /d /t /l` slug pages + OG cards
- `Mood Board` + `Design System` — références visuelles
- `nexus-tokens.css` — design tokens compatibles shadcn/ui (Neon Dusk)
- `phosphor-icons.jsx` — set Phosphor Regular inline SVG
- `components.jsx`, `killer-features.jsx` — composants React mock

Le projet venait de livrer J3c (propagation events bridges → WS) et la
roadmap rév. 4 prévoyait J4-pre (landing) + J4a/J4b (scaffolding web + auth
+ écrans). Manu a explicitement demandé une livraison **complète** du
bundle, **branchée** au backend existant (J0-J3c).

Question structurelle à trancher : **comment câbler le design en respectant
ADR-001 (monorepo pnpm + Turborepo) et ADR-014 (web-first + couche
platform), sans dette technique en cascade**.

## Options envisagées

### Option A — Tout coller dans `packages/web` directement

Pros : simple, un seul package frontend.
Cons : viole ADR-014 (`packages/platform-web`, `packages/landing` et
`packages/platform` doivent exister à terme). Pas de chemin clair pour
Tauri/RN. Augmente la friction quand on attaquera J4d (Tauri wrapper).

### Option B — Scaffolder les 4 packages prévus en ADR-014 dès cette session

Crée `packages/web` (Vite + React + TS + Tailwind + tokens shadcn-style),
`packages/landing` (Vite light, partage les sources de `web`),
`packages/platform` (interfaces only) et `packages/platform-web` (impl
Web APIs). Implémente tous les écrans dans `packages/web`. Branchage API
réel sur les endpoints existants (J0-J3c) + endpoints stubs pour les
killer features J5.

Pros :
- Aligne avec ADR-014 dès le premier sprint web
- Réutilisation des sources `web` par `landing` via alias Vite
- Zéro découpage à refactor en J4d (Tauri wrapper) ou V2 (RN)
- Le client web a un contrat d'API réel pour les killer features (stubs
  in-memory côté backend), pas de mocks fantômes côté front

Cons :
- Plus de packages à maintenir (4 nouveaux)
- Stubs in-memory côté backend = dette J5 explicite (à tracer dans backlog)

### Option C — Garder les écrans dans le bundle HTML, embed via iframe

Pros : zéro effort d'intégration immédiat
Cons : ridicule. Aucune réutilisation. Pas de typing. Pas de WS. Rejeté
sans débat.

## Décision

**Option B**. Structure livrée :

```
packages/
├── backend/                      # existant (J0-J3c)
├── shared/                       # existant
├── platform/                     # NEW — interfaces capacités natives
│   └── src/index.ts
├── platform-web/                 # NEW — impl web (Notifications, localStorage, etc.)
│   └── src/index.ts
├── web/                          # NEW — SPA Vite + React + TS
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx              # entrypoint
│       ├── router.tsx            # TanStack Router code-based
│       ├── styles/
│       │   ├── tokens.css        # variables CSS Neon Dusk
│       │   └── global.css
│       ├── lib/
│       │   ├── api.ts            # client HTTP cookie+CSRF (ADR-015)
│       │   ├── auth.ts           # zustand store auth + refresh silencieux
│       │   ├── platform.tsx      # PlatformProvider context React
│       │   ├── queries.ts        # hooks TanStack Query (groups/channels/messages/...)
│       │   ├── tokens.ts         # NX = palette JS (style inline)
│       │   ├── useMedia.ts       # useIsMobile (responsive)
│       │   └── ws.ts             # WebSocket reconnect + WsEventSchema validation
│       ├── components/ui/        # primitives (Logo, Avatar, Button, Input,
│       │                         #   Badge, Toggle, PhIcon)
│       └── screens/
│           ├── auth/             # Login, Register, ForgotPassword, Onboarding
│           ├── app/              # AppShell 3-pane + MobileShell + ChatView
│           │   └── killer-features/   # Event/Poll/Expense/Todo Detail
│           ├── public/           # PublicEvent/Poll/Expense/Todo/List
│           ├── settings/         # SettingsScreen (4 sections)
│           └── landing/          # LandingScreen
└── landing/                      # NEW — Vite static, déployé sur nexusapp.chat
    └── src/main.tsx              # importe @web/screens/landing/LandingScreen
                                  # via alias Vite (pas de subpath npm)
```

### Principes appliqués

1. **Tokens uniques source de vérité** : `nexus-tokens.css` du bundle est
   re-exporté en CSS variables dans `packages/web/src/styles/tokens.css`,
   et dupliqué en constantes JS dans `lib/tokens.ts` pour les usages
   inline (palettes avatars, animations, etc.). Tout shift de palette
   passe par ces deux fichiers en même temps.

2. **Phosphor icons inline** : on n'ajoute pas la dépendance
   `@phosphor-icons/react`. Les paths SVG du bundle sont copiés dans
   `components/ui/PhIcon.tsx` (set restreint, ~40 icônes). Pour ajouter
   une icône, copier-coller depuis https://phosphoricons.com.

3. **Auth web mode cookie + CSRF strict** (ADR-015) : `lib/api.ts`
   envoie `X-Nexus-Client: web` et lit `nexus_csrf` depuis `document.cookie`
   pour les méthodes mutantes. L'access token reste **en mémoire** (zustand)
   et ne touche jamais le localStorage. Refresh silencieux automatique sur
   401 + retry transparent.

4. **WebSocket = même contrat que J3c** : `lib/ws.ts` valide chaque event
   avec `WsEventSchema` de `@nexus/shared`. Reconnexion exponentielle.

5. **Killer features stubs in-memory** : `packages/backend/src/routes/killer-features/`
   expose un contrat REST complet (events, polls, expenses, todos + leurs
   pages publiques) avec un store en RAM seedé pour la démo. La vraie
   implémentation Drizzle + WS events + workers BullMQ arrive en J5
   (cf. `.agent/backlog.md` → "J5 — remplacer le store in-memory").

6. **Mobile responsive** : `MobileShell` activé sous 768px via `useIsMobile`.
   Navigation par stack (groupes → channels → détail). Pas de RN dans cette
   session (V2 selon ADR-014).

7. **Landing comme alias** : `packages/landing` réutilise les sources de
   `packages/web` via l'alias Vite `@web/...` (pas via subpath exports
   npm complexes). Build statique léger pour `nexusapp.chat`.

### Stubs backend ajoutés

| Endpoint                                             | Auth          | Source            |
|------------------------------------------------------|---------------|-------------------|
| GET `/api/v1/groups/:groupId/events`                 | requireAuth + membership | killer-features/store.ts |
| GET `/api/v1/public/events/:slug`                    | public        | killer-features/store.ts |
| GET `/api/v1/groups/:groupId/polls`                  | requireAuth + membership | killer-features/store.ts |
| GET `/api/v1/public/polls/:slug`                     | public        | killer-features/store.ts |
| GET `/api/v1/groups/:groupId/expenses`               | requireAuth + membership | killer-features/store.ts |
| GET `/api/v1/public/expenses/:slug`                  | public        | killer-features/store.ts |
| GET `/api/v1/groups/:groupId/todos`                  | requireAuth + membership | killer-features/store.ts |
| GET `/api/v1/public/todos/:slug`                     | public        | killer-features/store.ts |
| POST `/api/v1/waitlist`                              | public        | waitlist/index.ts |

Aucune mutation (POST RSVP, POST vote, POST expense add, etc.) côté backend
— le front mute en local pour le moment, et J5 ajoutera les endpoints +
WS events correspondants.

## Conséquences

**Positives**
- Toute la roadmap J4-pre + J4a + J4b (auth + app shell + écrans + landing)
  est livrée en avance sur planning
- Le client web a un contrat d'API réel et stable, prêt à consommer J5
- Les ADR-001, ADR-010, ADR-014, ADR-015 sont respectés sans surprise
- Mobile responsive web-first sans RN (cohérent avec ADR-014 V2)

**Négatives**
- Dette technique explicite J5 (mutations backend killer features) —
  tracée dans `.agent/backlog.md`
- Pas encore de tests visuels / e2e côté `@nexus/web` — à ajouter en J4c
  (Playwright recommandé)
- Le store in-memory backend est perdu au restart serveur. Acceptable
  pour démo, à remplacer par Drizzle en J5.
- Les hooks killer features côté front retournent un tableau vide en cas
  d'erreur 404 : pratique pour ne pas casser l'UI quand un groupe n'a pas
  encore d'events, mais masque les erreurs réseau silencieusement (à
  surveiller en J4c via React Query devtools).

**Neutres**
- ADR-014 reste le source de vérité pour la structure monorepo. Cet
  ADR-016 documente uniquement l'opérationnalisation immédiate.
- Le mobile prototype du bundle a guidé `MobileShell` mais pas de RN
  package créé — V2 selon ADR-014.

## Références

- ADR-001 : monorepo pnpm + Turborepo
- ADR-003 : protocole WS typé
- ADR-010 : pages publiques + deep links (`/e/:slug`, etc.)
- ADR-014 : web-first + couche platform
- ADR-015 : auth web cookie + CSRF
- Bundle : `nexus_design.zip` reçu 2026-05-01
- Roadmap rév. 4 : `.agent/roadmap.md` (J4-pre / J4a / J4b)
