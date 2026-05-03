# ADR-020 : Worker BullMQ pour les rappels d'events

**Date** : 2026-05-03
**Statut** : Accepté

## Contexte

Les events killer features (cf. J5b #38) ont une date de début `startsAt`.
Pour qu'ils servent vraiment l'objectif produit (« arrêter d'oublier les
trucs entre potes »), il faut que Nexus rappelle automatiquement aux
membres du groupe qu'un event approche.

Contraintes :

- Le rappel doit partir à un instant précis dans le futur, calculé à partir
  de `startsAt` — donc quelque chose à scheduler.
- Le scheduling doit survivre à un redémarrage du backend (pas un simple
  `setTimeout` en mémoire).
- Le re-schedule à l'update de l'event doit être propre (pas de doublons,
  pas de rappels périmés).
- L'audience doit refléter les RSVP les plus récents au moment du run, pas
  ceux figés à la création.
- L'infra doit s'inscrire dans le pattern Nexus (process séparé pour les
  workers, lock distribué, observabilité, cf. ADR-009).
- On veut pouvoir étendre le système à d'autres rappels plus tard (todos
  avec deadline, polls qui closent, etc.) sans réinventer la queue.

## Options envisagées

### Option A — `setTimeout` en mémoire dans le process backend

**Pour** : trivial, zéro infra additionnelle.
**Contre** : disparaît au moindre redémarrage. Inopérant en multi-replica
(chaque instance schedulerait son propre timer → doublons). N'évolue pas
au-delà d'un POC.

### Option B — `node-cron` dans un worker dédié

**Pour** : léger, pas de dépendance Redis pour le scheduling.
**Contre** : pas de notion de job persisté — il faut maintenir une table
`scheduled_jobs` à la main, gérer le polling, gérer le retry. Réinvente
BullMQ en moins fonctionnel.

### Option C — BullMQ (Redis-backed)

**Pour** : queue persistante dans Redis (déjà installé), delay natif,
retry/backoff intégré, jobId déterministe pour idempotence, support
multi-replica via des locks distribués au niveau du Worker, dashboard
optionnel (Bull Board) pour debug. Pattern aligné avec la stack visée
(cf. project instructions « Workers asynchrones (BullMQ sur Redis) »).
**Contre** : nouvelle dépendance (~2 Mo), apprentissage de l'API. Connexion
ioredis dédiée pour les commandes bloquantes.

### Option D — `pg_cron` côté Postgres

**Pour** : zéro service supplémentaire si on accepte de mettre des jobs
SQL.
**Contre** : pas dispo sur tous les hébergeurs Postgres. La logique de
notification quitte le code TypeScript (gestion d'erreur, observabilité).
Pas adapté à un worker qui doit publier des events Redis.

## Décision

**Option C — BullMQ.**

Aligné avec les project instructions, intégré sans friction au pattern
existant (workers en process séparés, lock distribué, ioredis), et le
seul à offrir nativement tout ce dont on a besoin (delay, jobId
déterministe, retry, multi-replica safe).

### Spec actée (cf. session 2026-05-03)

| Décision | Choix |
|---|---|
| Paliers | `h24` (T-24h) + `h1` (T-1h) — 2 tiers fixes |
| Audience | members du group **sauf** RSVP=`no` (yes + maybe + non-répondants) |
| Canal V1 | WS only via `publishNexusEvent` → `nexus-relay` |
| Update event | jobId déterministe `event-reminder:{eventId}:{tier}` → `remove()` + `add()` à chaque update de `startsAt` |
| Idempotence runtime | worker re-load en DB, skip si event introuvable ou `startsAt < now() - 5min` |
| Suppression event | DELETE handler → `cancelEventReminders(eventId)` |
| WS event | nouveau `event:reminder`, payload `{ eventId, tier, userIds }`, le client filtre sur son userId |
| Job dans le passé | si `delay <= 0` à la création, on skip ce tier (pas de job rétroactif) |

### Arbitrages secondaires

- **Per-user vs payload `userIds[]` pour le WS** : choix `userIds[]` pour
  éviter le fan-out réseau (1 message Redis pubsub au lieu de N), au prix
  d'une légère exposition côté client (les autres members voient qui est
  notifié — mais ils se voient déjà entre eux dans la liste membres).
  Dette V2 si besoin de confidentialité stricte.
- **Audience calculée côté worker** plutôt que figée à la création du
  job, pour rester fraîche aux derniers RSVP.
- **Lock distribué** sur `lock:worker:event-reminders` (pattern
  ADR-009) : un seul worker par cluster traite la queue. BullMQ
  supporterait nativement le multi-worker (locking sur les jobs), mais
  on garde le pattern singleton pour la cohérence avec
  `discord-bridge` et la simplicité ops.
- **`processEventReminderJob` exporté** : guard `isMainModule` autour du
  bootstrap pour permettre l'import du processor depuis les tests sans
  démarrer le worker BullMQ.

## Conséquences

### Positives

- Rappels persistés (Redis), survivent aux redémarrages.
- Re-schedule trivial via jobId déterministe.
- Pattern queue extensible : todos avec deadline, polls qui closent,
  rappels d'expense en attente de règlement, etc., utiliseront le même
  module `workers/queues.ts` avec une nouvelle queue.
- Tests unitaires faciles : scheduler mocké via `vi.mock` sur
  `workers/queues.js`, processor mocké sur `getEventById` / `listMembers`
  / `publishNexusEvent`.

### Négatives

- Nouvelle dépendance (`bullmq` ~2 Mo) + un process worker en plus à
  superviser sur le VPS.
- Connexion ioredis dédiée par queue (BullMQ exige
  `maxRetriesPerRequest: null`) — légère sur-consommation de connexions
  Redis (négligeable à notre échelle).
- Couverture V1 limitée : pas de push messageries bridgées (Discord/WA),
  pas d'email fallback. Si un user n'est pas connecté au moment du
  rappel, il ne le voit pas. À adresser en V1.5 (cf. backlog).

### Neutres

- ADR à venir pour la stratégie multi-canal des notifications
  (push bridges, email, push mobile via Expo) quand on attaque V1.5.
- Le `dashboard Bull Board` n'est pas activé en V1 mais peut l'être
  trivialement plus tard sur la même queue.

## Implications opérationnelles (VPS Hostinger)

- Nouveau service `nexus-worker-reminders.service` à provisionner aux
  côtés de `nexus-backend.service` et `nexus-worker-discord.service`
  (cf. ADR-012). À documenter dans la procédure de déploiement J3.5.
- Pas de nouveau port (le worker se connecte uniquement à Postgres et
  Redis déjà en place).
- Healthcheck simple : log `event-reminders worker ready` au boot,
  surveiller via `journalctl -u nexus-worker-reminders -f`.
