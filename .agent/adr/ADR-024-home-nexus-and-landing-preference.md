# ADR-024 : Home Nexus + préférence d'atterrissage post-login

**Date** : 2026-05-03
**Statut** : Accepté

## Contexte

Jusqu'ici, après login l'utilisateur atterrit toujours dans le AppShell sur le **dernier groupe disponible + premier canal** (logique implicite des `useEffect` qui auto-sélectionnent `groups[0]` puis `channels[0]`). Trois limites :

1. **Pas de vue trans-groupes** — pour savoir "où ça bouge pour moi", l'user doit ouvrir chaque dashboard de chaque groupe. Les RSVP en attente, les dépenses à régler, les todos qui me sont assignées sont dispersés.
2. **Pas de personnalisation de l'arrivée** — un user qui se sert principalement de Nexus comme front pour Discord veut atterrir sur son canal habituel ; un autre qui veut "voir ce qui s'est passé pendant qu'il était parti" veut un feed personnel.
3. **Le logo "nexus" du sidebar n'est pas cliquable** — il n'y a pas de point de retour à la racine.

Manu a demandé deux features couplées :

- une **Home Nexus** (dashboard global, post-login)
- une **option de profil** : choisir la page d'arrivée (Home Nexus, dernier canal, etc.)

## Options envisagées

### Concept de la Home

1. **Feed personnel actionnable** — RSVP en attente, dépenses à régler, todos assignées, mes prochains events, mentions/messages non lus. Centré sur "ce qui m'attend".
   - **Pro** : actionnable en un coup d'œil, pas un dump d'activité, faisable avec ce qu'on a déjà côté DB.
   - **Con** : pas de "lifestream" si l'user voulait scroller l'activité.
2. **Timeline d'activité brute multi-groupes** — derniers messages, derniers events, sondages ouverts, etc. Style Discord home.
   - **Pro** : volume, sensation de vie.
   - **Con** : peu actionnable (qui scroll ça ?), gros payload, queries lourdes (joindre messages de N bridges).
3. **Hybride 2 colonnes** — feed actionnable à gauche + timeline à droite.
   - **Pro** : couvre les deux usages.
   - **Con** : double l'effort, risque de rendre les deux paneaux moins bien.

### Granularité de la préférence

A. **Simple : 4 options fixes** — `home`, `last_channel`, `last_group_first_channel`, `last_group_first_feature`. Couvre 95% des cas, UI triviale (radio).
B. **Granulaire : n'importe quel canal/feature précis** — combobox 2 niveaux (groupe → canal). Plus puissant mais UI complexe et casse si le canal disparaît.

### Stockage de la préférence

P1. **DB user (colonne `users.landing_preference`)** — synchro automatique desktop/mobile, perdu si on change de compte. Migration Drizzle nécessaire.
P2. **Local Tauri/localStorage** — pref par device. Pas de migration, mais l'user doit reconfigurer sur chaque appareil.

### Tracking de la "dernière position"

L1. **Backend** — colonne `users.last_group_id`, `users.last_channel_id`. Synchro multi-device.
L2. **localStorage côté front** — par device. Pas de schema change.

## Décision

**Concept Home : option 1 (feed personnel actionnable)**.
**Granularité pref : option A (4 options fixes)**.
**Stockage pref : option P1 (DB user)**.
**Tracking last position : option L2 (localStorage)**.

### Justification

Manu a explicitement validé chaque choix dans l'échange du 2026-05-03 (cf. `AskUserQuestion` answers). Trois rationales structurantes :

1. **Feed actionnable plutôt que timeline** : c'est la valeur ajoutée nette de Nexus par rapport à 5 onglets de messageries ouverts. Le feed dit "voilà ce qui demande ton attention", l'inverse de "voilà tout ce qui s'est dit". Aligné avec la ligne du produit (couche d'organisation > pure agrégation).

2. **Pref en DB, position locale** : la pref est intrinsèquement à propos de "moi en tant qu'user" → multi-device. La position ("le dernier canal que j'ai consulté") est intrinsèquement device-specific (j'ai un mobile pour les conversations rapides, un desktop pour les docs). Mélanger les deux donnerait des comportements absurdes ("ouvre #famille sur mon mobile parce que c'est ce que je consultais à mon bureau").

3. **4 options fixes, pas granulaire** : les 4 options couvrent les patterns réels (feed / restore / discussion / planification). Une combobox granulaire ouvre la question du fallback si le canal disparaît — complexité disproportionnée pour un gain marginal.

## Conséquences

### Positif

- Une **vraie home page** trans-groupes qui devient le point d'entrée naturel pour les users actifs.
- Pas de schema break massif : 1 colonne `text NOT NULL DEFAULT 'home'` sur `users`, les comptes existants atterrissent sur la nouvelle Home → sensation de "découverte" automatique de la feature.
- Le **endpoint `/home/feed` est cacheable** côté front (TanStack Query, polling 60 s, stale 15 s). 5 queries SQL parallélisées via `Promise.all` → 1 RTT logique côté API.
- **Logo cliquable** dans la Sidebar = geste familier (toutes les apps SaaS le font), pas de bouton supplémentaire à apprendre.
- Pattern **deep-link** déjà câblé (cf. `NotificationsBell`) → les Cards de la Home réutilisent le même contrat `{ groupId, pane, sourceId? }`. Pas de chemin de code dupliqué.

### Négatif

- 1 nouvelle migration Drizzle (`0006_add_landing_preference.sql`).
- **Duplication du schéma Zod** `LandingPreferenceSchema` côté backend ET côté front (pattern existant pour `ThemeMode`). Dette à résorber en J6 quand on bouge plus de DTOs vers `@nexus/shared`.
- L'option `last_channel` peut être **frustrante en cas de churn** : si l'user ne s'est pas connecté depuis longtemps et que le canal a disparu, on retombe sur `home`. Acceptable comme fallback silencieux mais à monitorer si Manu utilise activement cette option.
- **Pas d'unread count par message** côté backend — la section "Activité non lue" agrège uniquement les notifications transverses (cf. ADR-023), pas les messages bridges non lus. Différence à expliquer à l'user si confusion. À ajuster en V2 si pertinent.

### Neutre

- La pref `last_group_first_feature` ouvre directement sur le pane `event` (pas un autre feature). Choix arbitraire — un user qui veut "1re feature = polls" devra patcher la résolution. Pas de demande explicite de granularité ici, on garde simple.

## Implémentation (récap des 5 lots)

### Lot 1 — Backend préférence

- Migration `0006_add_landing_preference.sql` : `ALTER TABLE users ADD COLUMN landing_preference text NOT NULL DEFAULT 'home'`
- Schéma Drizzle : `landingPreference: text('landing_preference').notNull().default('home')`
- Schéma Zod `LandingPreferenceSchema` (enum 4 valeurs) ajouté à `routes/auth/schemas.ts`
- `UserDtoSchema` étendu avec `landingPreference: LandingPreferenceSchema`
- `UpdateMeBodySchema` étendu avec `landingPreference?: LandingPreferenceSchema`
- `userToDto` : map `coerceLandingPreference` (defensive : invalide → fallback 'home')
- `updateUserPreferences` : nouveau champ accepté
- Tests intégration : 4 cas (défaut, update, invalid, partial)

### Lot 2 — Backend `/home/feed`

- Nouveau plugin `routes/home/` : `index.ts`, `repo.ts`, `schemas.ts`
- Endpoint `GET /api/v1/home/feed` : agrégat 5 sections en `Promise.all`
- 5 fonctions repo : `listPendingRsvps`, `listUnsettledExpenses`, `listAssignedTodos`, `listUpcomingEvents`, `listUnreadByGroup`
- Filtrage membership 100% en SQL (pas de raisonnement JS) → fermeture de la classe d'erreurs "j'ai oublié de filtrer"
- Tests intégration : empty, pendingRsvps, RSVP yes flow, anti-leak

### Lot 3 — Frontend Settings

- Section "Démarrage" dans `SettingsScreen` avec composant `LandingPreferenceRow`
- Radio group 4 options + descriptions
- Méthode `setLandingPreference` ajoutée à `useAuth` Zustand store : optimistic update + rollback si KO

### Lot 4 — Frontend HomeDashboard

- Nouveau composant `screens/app/HomeDashboard.tsx`
- Hook `useHomeFeed` (TanStack Query, polling 60 s, stale 15 s)
- Layout : header sobre + grid auto-fit de 4 cards (RSVP, dépenses, todos, events) + 5e card "activité non lue" pleine largeur
- Empty state global élégant si tout est vide
- Helpers `formatRelativeDate` (i18n FR), `formatMoney` (Intl.NumberFormat), `greetingFor` (heure → salutation)

### Lot 5 — Frontend navigation Home + redirect login

- `Pane` étendu avec `'home'`
- AppShell rendu `<HomeDashboard />` quand `pane === 'home'`, avec callback `onNavigate` qui réutilise le pattern deep-link existant
- `landingAppliedRef` : applique `user.landingPreference` UNE FOIS au premier mount où user + groups sont chargés. Reset si on change d'user (logout/relogin).
- `persistLastLocation()` : useEffect qui sauve `nx:lastGroup`, `nx:lastPane`, `nx:lastChannel` à chaque change
- `resolveLandingDestination()` : pure function pref + groupes connus → `{ groupId, pane }`. Fallback silencieux sur `home` si l'option n'est pas applicable.
- Sidebar : logo + "Nexus" devient un bouton cliquable (background actif quand `pane === 'home'`), prop `onLogoClick`

## Endpoints exposés

```
GET  /api/v1/home/feed         → HomeFeedReply (5 sections, top N par section)
PATCH /api/v1/auth/me          → étendu avec landingPreference?: LandingPreference
```

## Migration DB

```sql
-- 0006_add_landing_preference.sql
ALTER TABLE "users"
  ADD COLUMN "landing_preference" text DEFAULT 'home' NOT NULL;
```

Backwards-compatible : tous les users existants ont `'home'` par défaut, donc atterrissage Home Nexus à la prochaine connexion. Aucune backfill applicative nécessaire.
