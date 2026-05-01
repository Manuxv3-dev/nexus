# ADR-014 : Web app prioritaire — restructuration monorepo + couche `platform`

**Date** : 2026-05-01
**Statut** : Accepté

## Contexte

Décision produit prise par Manu le 2026-05-01 : **la version web est
prioritaire** sur les versions desktop et mobile. La friction d'installation
d'une app native tue le potentiel viral du produit (un user clique sur un
lien Nexus partagé dans WhatsApp/Discord, il doit pouvoir essayer en
30 secondes sans rien installer).

Cette décision change la roadmap initialement prévue (ADR-001 mentionnait
desktop Tauri en V1 et mobile RN en V2). Le monorepo doit être restructuré
pour refléter cette priorité, **sans pénaliser** les futures versions
desktop et mobile.

L'app web et l'app desktop partagent ~80% de leur code (UI React,
state, data fetching, business logic). Ce qui diffère est le 20% qui
s'interface avec le système hôte (notifications, deep links, raccourcis
globaux, démarrage auto).

## Options envisagées

### Option A — `packages/web` standalone, `packages/desktop` réimporte tout

Pros : simple
Cons : duplication de code dans desktop si on n'extrait pas les capacités
natives ; pas de chemin clair pour mobile

### Option B — `packages/app-shell` partagé + 3 wrappers (RETENU)

Le code applicatif vit dans un package partagé (`@nexus/web` qui est
volontairement un misnomer mais cohérent avec la priorité). Les wrappers
desktop/mobile importent ce package et fournissent juste un host.

Une couche d'abstraction `@nexus/platform` définit l'interface des capacités
natives (notifications, storage sécurisé, deep links, file pickers...).
Trois implémentations : `@nexus/platform-web`, `@nexus/platform-tauri`,
`@nexus/platform-rn`.

Pros :
- Un seul codebase UI à maintenir
- Capacités natives proprement isolées derrière une interface
- Mobile RN bénéficie de la même architecture quand on l'attaque (V2)
- Tests UI tournent une seule fois pour les 3 plateformes

Cons :
- Structure monorepo plus complexe
- Discipline nécessaire : ne pas leak Tauri/RN/Web APIs dans `@nexus/web`,
  toujours passer par `@nexus/platform`

### Option C — Monorepo séparé pour web vs desktop

Pros : isolation forte
Cons : duplication massive, double effort de maintenance, pas tenable

## Décision

**Option B**. Structure monorepo finale :

```
packages/
├── backend/                  # Fastify + Drizzle + workers
├── shared/                   # Types Zod, schémas, logique métier pure (existant)
├── web/                      # App React principale (UI, state, data fetching)
├── desktop/                  # Wrapper Tauri minimal qui charge `web`
├── mobile/                   # React Native (V2) — réutilise `web` autant que possible
├── platform/                 # Interface "capabilities" natives (types only)
├── platform-web/             # Impl web (Web Notifications API, IndexedDB, etc.)
├── platform-tauri/           # Impl desktop (Tauri APIs)
└── platform-rn/              # Impl mobile (V2 — Expo APIs)
```

### Principes

**1. `@nexus/web` est l'app primary.**
- Stack : Vite + React 19 + TypeScript + TanStack Query + Zustand + Tailwind + shadcn/ui
- N'importe **jamais** `@tauri-apps/*`, `expo-*`, ou `react-native`
- N'importe **jamais** d'API Web non-portable (file://, etc.) directement —
  passe par `@nexus/platform`

**2. `@nexus/platform` définit les capacités via interfaces TypeScript.**
- Pas de code, juste des types et des contrats
- Exemple :
```ts
export interface PlatformCapabilities {
  notifications: NotificationProvider;
  secureStorage: SecureStorageProvider;
  deepLinks: DeepLinkProvider;
  // ...
}

export interface NotificationProvider {
  requestPermission(): Promise<'granted' | 'denied'>;
  show(opts: { title: string; body: string; icon?: string }): Promise<void>;
}
```

**3. Au runtime, `@nexus/web` reçoit l'implémentation via Context React.**
```ts
// dans desktop/src/main.tsx (Tauri)
import { TauriPlatform } from '@nexus/platform-tauri';
import { App } from '@nexus/web';

ReactDOM.createRoot(...).render(
  <PlatformProvider impl={TauriPlatform}>
    <App />
  </PlatformProvider>
);
```

**4. `@nexus/desktop` = entrypoint Tauri minimal.**
- `tauri.conf.json` qui charge `packages/web/dist/index.html`
- Pas de logique métier, juste le bootstrap natif (registre des deep
  links `nexus://`, démarrage auto, raccourcis globaux)

**5. `@nexus/mobile` (V2) = entrypoint Expo.**
- Réutilise `@nexus/web` autant que possible (composants UI portables via
  `react-native-web` / NativeWind / Tamagui — choix tranché en V2)
- À défaut, certains écrans seront réécrits pour RN si la portabilité React
  Web → React Native s'avère trop coûteuse (à arbitrer en V2)

### Hosting et URLs

Cf. ADR-012 pour la topologie. Résumé :
- `nexusapp.chat` → landing statique pré-launch, **puis** redirige vers
  l'app web post-launch
- `app.nexusapp.chat` → SPA `@nexus/web` (build Vite servi en static via Caddy)
- `api.nexusapp.chat` → backend Fastify (API REST + WebSocket)

### PWA (Progressive Web App)

`@nexus/web` est conçu PWA dès le début :
- `manifest.webmanifest` (icônes, theme color, display standalone)
- Service worker (`vite-plugin-pwa`) pour :
  - Cache offline du shell UI (HTML/CSS/JS)
  - Cache des dernières conversations vues (read-only en offline)
  - Background sync des messages en attente d'envoi (best-effort)
- Web Push API (VAPID keys) pour les notifs push
  - Supporté Chrome/Edge/Firefox/Safari ≥ 16.4 (iOS PWA installée)
  - Fallback : pas de notif sur iOS < 16.4 ou desktop sans permission
    accordée
- Installation native : "Ajouter à l'écran d'accueil" sur Android/desktop,
  "Add to Home Screen" sur iOS

Conséquence importante : **pour beaucoup d'utilisateurs, la PWA suffit**.
Le wrapper Tauri reste utile pour :
- Notifs natives Windows/macOS/Linux (plus fiables que Web Push desktop)
- Démarrage automatique au login
- Raccourcis globaux (cmd+shift+N pour faire apparaître Nexus)
- Accès au système de fichiers (drag-drop pièces jointes)

### Auth web

Cf. ADR-015. Les clients web utilisent le mode **cookie httpOnly + CSRF**.
Les clients natifs (Tauri, RN) utilisent le mode **body-token** existant.

### Stratégie de migration depuis l'archi actuelle

L'archi actuelle (post-J2) a :
- `packages/backend` : OK, ne change pas
- `packages/shared` : OK, ne change pas

À ajouter en J4 :
- `packages/web` : nouveau, app React Vite
- `packages/platform` : nouveau, interfaces seulement
- `packages/platform-web` : nouveau, impl web

À ajouter en J4-bis ou plus tard :
- `packages/desktop` : nouveau, wrapper Tauri minimal
- `packages/platform-tauri` : nouveau, impl Tauri

À ajouter en V2 :
- `packages/mobile`, `packages/platform-rn`

L'ADR-001 mentionnait `packages/desktop` et `packages/mobile` directement —
cet ADR-014 les remplace par la structure ci-dessus. ADR-001 reste valide
pour la partie monorepo / pnpm workspaces / Turborepo.

## Conséquences

**Positives**
- Un seul codebase UI à maintenir, déployable en web instantanément
- Web app installable comme PWA → ~70-80% des cas d'usage natifs couverts
  sans Tauri/RN
- Architecture prête pour mobile en V2 sans refactor
- Plus court chemin vers une beta privée avec utilisateurs externes (web =
  pas d'install)

**Négatives / coûts**
- Plus de packages dans le monorepo (~3 nouveaux en J4, +3 en V2)
- Discipline d'architecture nécessaire : tout accès aux capacités natives
  passe par `@nexus/platform`
- Choix retardés à V2 : framework de portabilité RN (Tamagui, NativeWind,
  réécriture pure RN, etc.)
- Premier deploy tauri demande une signature de code (cert. Apple Developer
  ~99 €/an, cert. Microsoft EV optionnel) — repoussé au moment où le
  desktop devient prioritaire (post-launch web)

**Neutres**
- ADR-001 reste valide globalement, juste l'arbo `packages/` est étendue
- ADR-004 (auth) reste valide pour les clients natifs ; ADR-015 ajoute le
  mode cookie pour web

## Implémentation prévue

Sous-jalons J4 (remanié — cf. roadmap rév.4) :

**J4-pre** (2 j) : landing teasing statique + waitlist
- `packages/landing/` (Astro ou Vite static, hors monorepo logique principal
  ou comme package mineur — à arbitrer en mini-ADR si doute)
- Déployée sur `nexusapp.chat`

**J4a** (3-4 j) : `@nexus/platform` + `@nexus/platform-web` + scaffolding
`@nexus/web` (Vite, Tailwind, shadcn/ui, routing, query client)

**J4b** (5-6 j) : login + écran groupes + écran conversation Discord
(quand J3 livre Discord)

**J4c** (3-4 j) : PWA (manifest, service worker, Web Push, install prompt)

**J4d** (5-7 j) : `@nexus/desktop` (Tauri wrapper) + `@nexus/platform-tauri`
— optionnel selon priorité ressentie après J4c

V2 plus tard :
**J?** : `@nexus/mobile` + `@nexus/platform-rn`

## Références

- ADR-001 : monorepo pnpm + Turborepo (structure étendue ici)
- ADR-004 : auth JWT (complétée par ADR-015 pour le web)
- ADR-010 : pages publiques + deep links — l'app web sert aussi les
  destinations de partage (`/e/:slug`, etc.)
- ADR-012 : topologie VPS — sert le SPA via Caddy en static
