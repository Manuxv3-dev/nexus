# ADR-027 : Universalisation du pattern webview pour tous les providers messagerie

**Date** : 2026-05-04
**Statut** : Accepté

## Contexte

Aujourd'hui Nexus a deux patterns d'intégration messagerie cohabitant :

| Provider | Pattern | Backend coût |
|---|---|---|
| Discord | API officielle bot/user (worker BullMQ + RPC bridge + sync DB) | Lourd : worker dédié, sync messages, 2 routes channels/messages |
| WhatsApp | Webview encapsulée (Phase A web / Phase B Tauri) | Léger : juste une session "déclarative" en DB |
| Messenger | Webview encapsulée (idem) | Léger |

L'asymétrie crée plusieurs problèmes :
1. **UX incohérente** : Discord rendu via `<ChatView>` custom (avec les channels listés en sidebar), WA/Messenger via `<WebviewProviderPane>` (interface native du provider). Sentiment de "deux apps en une".
2. **Maintenance double** : worker Discord à maintenir (rate limits, breaking changes API, OAuth flow), versus une simple webview qui hérite de toutes les features Discord automatiquement (vocal, threads, embeds riches, etc.).
3. **Risques de bannissement bot** : Discord est strict sur les bots autorisés à scraper.
4. **Couverture incomplète** : l'API Discord ne donne pas accès aux DMs personnels (que le bot user peut voir). En webview, l'utilisateur a tout son Discord exactement comme dans le client officiel.
5. **Scaling providers limité** : ajouter Telegram/Instagram/Slack en suivant le pattern API serait à chaque fois un nouveau bridge custom à coder. En webview, c'est ~50 lignes par provider.

Manu pose deux questions stratégiques (2026-05-04) :
- Faut-il migrer Discord en webview pour homogénéiser ?
- Étendre à d'autres services (Instagram, Snapchat, TikTok, etc.) ?

## Options envisagées

### Pour Discord

**A. Statu quo** : Discord garde son API + worker, WA/Messenger restent en webview. Préserve les killer features (sync messages → IA → notif transverses). Asymétrie acceptée.

**B. Migration 100% webview** : Discord devient une session webview comme WA/Messenger. On retire le worker, les routes channels/messages, le RPC bridge. Cohérence totale, mais perte de la sync messages côté DB → l'IA et les notifs transverses ne fonctionneront plus sur Discord.

**C. Hybride** : webview Discord pour la consultation + bot Discord minimaliste qui ne fait que poster les liens Nexus (events/polls/expenses partagés). Compromise entre cohérence et killer features ADR-010.

### Pour les autres providers

| Service | Web messagerie | Faisabilité |
|---|---|---|
| Telegram | ✅ web.telegram.org excellent | 🟢 Top |
| Instagram DMs | ✅ instagram.com | 🟢 Top |
| Slack | ✅ slack.com | 🟢 Top |
| Microsoft Teams | ✅ teams.microsoft.com | 🟢 Top |
| LinkedIn Messaging | ✅ linkedin.com | 🟢 Bon |
| Twitter/X DMs | ✅ twitter.com | 🟢 Bon |
| Reddit chat | ✅ reddit.com | 🟡 OK |
| TikTok DMs | ⚠️ peu utilisés sur web | 🟡 Limité |
| Snapchat | ⚠️ web.snapchat.com restreint | 🟡 Limité |
| Signal | ❌ pas de web | 🔴 Impossible |
| iMessage | ❌ Apple-only | 🔴 Impossible |

## Décision

**Discord → option B (100% webview).** Validée par Manu le 2026-05-04.

**Autres providers : 9 providers à intégrer dans l'ordre du tableau** (Telegram → Snapchat), exclus : Signal et iMessage (impossibles sans web).

### Justification

- **Cohérence > IA sur Discord** : la promesse Nexus est l'organisation cross-provider (events/polls/expenses), pas l'analyse de messages. L'IA pourra être ré-introduite plus tard via une autre voie (suggestions inline dans la UI quand l'utilisateur tape, dictée vocale, etc.) sans dépendre du sync de messages bridges.
- **Liens Nexus partagés** : ADR-010 disait "killer features via liens partagés", c'est-à-dire que l'utilisateur copie-colle un lien Nexus dans Discord/WA/etc. Pas besoin d'un bot pour poster — l'utilisateur le fait lui-même depuis le UI Nexus (bouton "Copier le lien" + ouvrir le channel dans la webview). C'est 100% compatible avec le full-webview.
- **Réduction massive du code backend** : suppression du worker discord-bridge (~500 lignes) + routes channels/messages + RPC bridge + sync (~1000 lignes). Maintenance ↘️, surface d'attaque ↘️, deps Discord.js ↘️.
- **Scaling providers gratuit** : une fois le pattern uniformisé, ajouter Telegram = ~50 lignes. Idem pour les 9 suivants.

## Architecture cible

### DB

Migration `0007_extend_provider_type.sql` :

```sql
ALTER TYPE "provider_type" ADD VALUE 'telegram';
ALTER TYPE "provider_type" ADD VALUE 'instagram';
ALTER TYPE "provider_type" ADD VALUE 'slack';
ALTER TYPE "provider_type" ADD VALUE 'teams';
ALTER TYPE "provider_type" ADD VALUE 'linkedin';
ALTER TYPE "provider_type" ADD VALUE 'twitter';
ALTER TYPE "provider_type" ADD VALUE 'reddit';
ALTER TYPE "provider_type" ADD VALUE 'tiktok';
ALTER TYPE "provider_type" ADD VALUE 'snapchat';
```

L'enum existant garde `discord`, `whatsapp`, `messenger`. Plus 9 nouvelles valeurs. Total : 12 providers.

### Sessions Discord legacy

Les sessions Discord créées via l'ancien flow OAuth (avec `external_id = guildId` et credentials chiffrés) seront :
- **Non supprimées** automatiquement par la migration (préservation données utilisateur)
- Affichées normalement en webview à partir de cette version
- Si l'utilisateur veut les "nettoyer" : déconnexion via Settings UI (route DELETE existante)

Une session Discord créée en webview après ADR-027 aura `external_id = webview:{userId}:{groupId}`, comme WA/Messenger.

### Backend — code à retirer

- `packages/backend/src/integrations/discord/` → tout retirer (bot, OAuth, RPC handlers)
- `packages/backend/src/workers/discord-bridge.ts` → retirer
- `packages/backend/src/routes/messaging/index.ts` :
  - Routes Discord OAuth (install-url + callback)
  - Routes channels (`/channels`, `/messages`)
  - Logic `publishControl` pour `discord`
- `packages/backend/src/integrations/core/bridge-rpc.ts` + `event-bus.ts` → retirer (si plus aucun consommateur)
- `packages/backend/package.json` : retirer `discord.js` et `dotenv` (si plus utilisé ailleurs)
- `scripts/dev-start.bat` : retirer l'onglet "Worker Discord"

### Backend — code à ajouter

Aucun ajout backend pour les 9 nouveaux providers. La route `POST /messaging/webview-sessions` (créée pour WA/Messenger en ADR-025) accepte déjà n'importe quel `providerType` après extension de l'enum.

### Frontend — code à modifier (par provider)

Pour chaque provider (Discord migration + 9 nouveaux), 5 fichiers à toucher :

1. **`packages/web/src/components/ui/BrandIcon.tsx`** : ajouter le SVG path simpleicons + couleur officielle
2. **`packages/web/src/lib/tauri.ts`** : ajouter au map `PROVIDER_WEB_URL`
3. **`packages/web/src/screens/app/WebviewProviderPane.tsx`** : ajouter au `PROVIDER_META` (nom, description QR/login)
4. **`packages/web/src/screens/settings/SettingsScreen.tsx`** : ajouter une `ConnectionCard`
5. **`packages/web/src/lib/tokens.ts`** : ajouter `sourceColor[provider]` si pas déjà présent

Soit ~50 lignes par provider, sans aucune logique custom.

### Frontend — Discord migration spécifique

- `packages/web/src/screens/app/AppShell.tsx` : retirer la logique distincte Discord (channels list dans la sidebar, ChatView dédié). Remplacer par : Discord = `webviewSessions` comme les autres → s'affiche dans la card list provider, ouvre `WebviewProviderPane`.
- `packages/web/src/screens/app/ChatView.tsx` → **DELETE**
- `packages/web/src/lib/queries.ts` : retirer `useChannels`, `useMessages`, `useSendMessage`
- `packages/web/src/lib/useKillerFeaturesWs.ts` : retirer les invalidations sur message:* events si plus utilisés
- Plus aucun lien à `discord/install-url` côté front (handleConnectDiscord retiré)

## Découpage en lots (prochaine session)

| # | Lot | Effort | Risque |
|---|---|---|---|
| 1 | ADR-027 (cet ADR) | ✓ fait | Néant |
| 2 | Migration DB `0007_extend_provider_type.sql` (9 nouvelles valeurs enum) | 15 min | Faible — Postgres ALTER TYPE ADD VALUE est sûr et ne casse rien |
| 3 | Frontend : `BrandIcon` 9 logos + `PROVIDER_WEB_URL` + `PROVIDER_META` + `sourceColor` | 1h | Faible — pattern répétitif |
| 4 | Settings : 9 nouvelles `ConnectionCard` (Telegram → Snapchat) | 30 min | Faible |
| 5 | Discord migration : retirer ChatView, retirer routing channels, brancher sur `WebviewProviderPane` | 2h | Moyen — toucher AppShell logic centrale |
| 6 | Backend cleanup : retirer worker Discord, routes channels/messages, integration discord/ | 2h | Moyen — bien tester que les sessions Discord existantes restent listables et basculent en webview |
| 7 | `scripts/dev-start.bat` : retirer onglet Worker Discord | 5 min | Néant |
| 8 | Tests : connecter chaque provider en mode Tauri, vérifier la webview se charge correctement | 1h | Faible — manuel, pas de tests auto à écrire |
| 9 | README + ADR cleanup (mentionner les 12 providers, retirer mentions Discord API) | 20 min | Néant |

**Total estimé : ~7h.** À faire en une session focus ou splitter en 2 selon ton rythme.

## Conséquences

### Positif

- **UX 100% cohérente** : tous les providers vivent dans `<WebviewProviderPane>`, switch via la sidebar à l'identique. L'utilisateur ne sait pas (et ne s'en soucie pas) que Discord a été migré
- **Backend allégé d'environ 1500 lignes** (worker discord-bridge + routes channels/messages + integration bot/OAuth + RPC)
- **Couverture immédiate de 12 providers** (3 actuels + 9 nouveaux) sans bridge à maintenir
- **Plus de risque de ban Discord** : on présente une WebView Chromium standard, indissociable d'un browser légitime
- **Écosystème extensible** : ajouter Mastodon / Bluesky / Threads / WeChat-Web sera trivial le jour où ça pertinente

### Négatif

- **Perte de l'IA messages Discord** : le détecteur d'intention (cf. ADR-026 roadmap) ne pourra pas s'appliquer aux messages Discord (on n'y a plus accès côté serveur). Pareil pour WA/Messenger qu'on n'a jamais sync. **Conséquence stratégique** : l'IA dans Nexus se repositionne — au lieu de "lire les messages bridges", elle deviendra "assistant inline pendant que tu tapes" dans le UI Nexus (créer event, suggérer formulation, etc.). À retraiter dans un futur ADR-028 (IA repositionnée) si on relance le sujet.
- **Perte des notifications cross-provider basées sur messages** : les notifs Nexus ne fan-out plus depuis les messages Discord. Reste les notifs internes (RSVP, expenses, todos) qui sont indépendantes des messages bridges.
- **Migration data Discord** : les channels et messages déjà sync en DB deviendront orphelins. À nettoyer via une migration ou laisser mourir (peu de volume probablement).
- **Snapchat/TikTok** : couvertures partielles côté web (Snapchat pas de Snaps, TikTok DMs minimes). On les inclut quand même (ne coûtent rien à ajouter), l'utilisateur final acceptera l'expérience dégradée.

### Neutre

- ADR-006 (Discord API officielle) devient **obsolète** mais reste dans l'historique comme ADR remplacé par ADR-027.
- ADR-010 (killer features via liens partagés) reste valide : l'utilisateur copie-colle manuellement les liens Nexus dans la webview Discord/etc. Pas de bot poster requis.
- ADR-017 (RPC bridge pattern) devient obsolète après suppression du worker Discord. Reste dans l'historique.

## Suivi

- Une fois implémenté, ce sera la fin du concept "bridge messaging" côté Nexus. Tous les providers sont des webviews encapsulées.
- Si un jour Manu veut **réintroduire un sync** sur un provider précis (ex : Slack pour besoin entreprise), on pourra ajouter un bridge optionnel au-dessus de la session webview (sans casser l'UX). Mais c'est explicitement hors scope V1-V2.
