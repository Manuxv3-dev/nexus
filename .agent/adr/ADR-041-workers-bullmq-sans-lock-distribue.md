# ADR-041 : Pas de lock distribué sur les workers BullMQ

**Date** : 2026-09-17
**Statut** : Accepté — remplace ADR-020 § Arbitrages secondaires (« Lock
distribué sur `lock:worker:event-reminders` »). Le reste d'ADR-020 (choix de
BullMQ, paliers `h24`/`h1`, audience calculée côté worker, jobId
déterministe) est inchangé.

## Contexte

ADR-009 (architecture des bridges server-side, abandonnée depuis) posait un
lock Redis (`workers/lock.ts`, TTL 60s + refresh périodique) sur chaque
worker en process séparé, motivé par un besoin réel à l'époque : un bridge
Discord/WhatsApp/Messenger maintient une session (WebSocket gateway) avec le
provider, et deux instances connectées avec le même token provoquent des
double-connexions côté provider — la session devait donc être **sticky à une
seule instance**, d'où le lock.

ADR-020 (worker BullMQ `event-reminders`, 2026-05-03) a repris ce même
pattern par cohérence avec `discord-bridge` (« on garde le pattern singleton
pour la cohérence avec `discord-bridge` et la simplicité ops »), sans
revalider si BullMQ avait besoin de cette garantie. `notifications-purge`
(ADR-023) et `event-reminders` ont donc démarré avec un lock ; seul
`push-send` (introduit plus tard, ticket Cortex `505c6a76`) ne l'a jamais eu.

Deux choses ont rendu ce pattern caduc :

1. **ADR-027 (universalisation webview) a supprimé tous les bridges** —
   `discord-bridge` et sa contrainte de session sticky au provider
   n'existent plus dans le code. Le rationale « cohérence avec
   discord-bridge » d'ADR-020 n'a donc plus de référent.
2. **Le lock n'apportait aucune garantie que BullMQ ne fournit pas déjà.**
   Revue de la dette du ticket Cortex `97ad8728` (PR #118) :
   - Un `Worker` BullMQ garantit qu'un job donné n'est actif que sur un seul
     worker à la fois (verrou interne au job, indépendant du nombre de
     workers qui écoutent la queue) — plusieurs replicas d'un même worker
     BullMQ sur la même queue, c'est le mécanisme de scale-out **prévu**,
     pas une menace de double-traitement.
   - `Queue.upsertJobScheduler` (utilisé par `notifications-purge` pour
     poser son cron) passe par un script Lua BullMQ
     (`Scripts.addJobScheduler`), exécuté atomiquement côté Redis et clé par
     l'id du scheduler (vérifié dans `bullmq@5.76.5`,
     `dist/cjs/classes/job-scheduler.js` → `dist/cjs/classes/scripts.js`) :
     deux replicas qui l'appellent au démarrage convergent vers un seul
     scheduler enregistré, sans race possible. Aucun lock applicatif requis
     pour cette exclusivité-là non plus.
   - Le lock avait un coût réel : après un `--force-recreate` (déploiement),
     l'ancien conteneur reçoit un SIGKILL après `stop_grace_period` (10s)
     sans avoir eu le temps de faire `bridgeLock.release()` (qui attend
     jusqu'à 10s pour un fan-out propre) ;
     le lock reste donc posé jusqu'à expiration de son TTL (60s). Le nouveau
     conteneur poll toutes les 5s pendant cette fenêtre → les rappels/purges
     sont retardés de jusqu'à ~60s après **chaque** déploiement, pour une
     garantie que BullMQ fournissait déjà gratuitement.

## Décision

**Aucun worker BullMQ de Nexus ne pose de lock distribué applicatif.**
L'exclusivité nécessaire est déjà garantie par BullMQ lui-même :

- **Consommation de jobs** (`event-reminders`, `push-send`,
  `notifications-purge`) : le verrou interne par job de BullMQ suffit.
  Plusieurs replicas d'un worker peuvent tourner sans double-traitement —
  c'est le mécanisme de scale-out prévu.
- **Production périodique** (`notifications-purge`, seul cas actuel via
  `upsertJobScheduler`) : l'atomicité du script Lua sous-jacent suffit.
  Plusieurs replicas qui démarrent en même temps convergent vers un seul
  scheduler enregistré, sans corruption ni doublon.

`workers/lock.ts` (`acquireLock`/`BridgeLock`) est supprimé : plus aucun
worker ne l'utilise.

Si un futur worker a un besoin d'exclusivité que BullMQ ne couvre pas
nativement (ex. un état externe non-BullMQ à ne modifier que par une seule
instance à la fois, à la manière de l'ancienne session de gateway
discord-bridge), un lock distribué redevient légitime — mais ce sera une
décision reprise au cas par cas, pas un pattern par défaut copié d'un worker
à l'autre.

## Conséquences

**Positif** :

- Scale-out horizontal des workers BullMQ possible sans configuration
  supplémentaire (plusieurs replicas derrière la même queue).
- Plus de délai de reprise après déploiement : avant, jusqu'à ~60s
  (TTL du lock) après **chaque** `deploy.sh` pour `event-reminders` et
  `notifications-purge` ; maintenant, le nouveau conteneur traite dès qu'il
  est up.
- Une dépendance de moins (`workers/lock.ts` + sa connexion ioredis dédiée
  par worker) à maintenir et à raisonner en cas d'incident Redis.
- Ferme un cargo-cult identifié en revue : le pattern était copié d'un
  worker à l'autre (`event-reminders` ← `notifications-purge` ← ADR-009)
  sans revalider ce qu'il garantissait à chaque copie.

**Négatif / à savoir** :

- Le lock avait une garantie de dernier recours en cas de bug BullMQ lui-même
  (verrou interne par job cassé par un bug de la librairie) — accepté comme
  risque résiduel, pas différent de faire confiance à BullMQ pour tout le
  reste de son contrat (retry, backoff, jobId déterministe).
- `upsertJobScheduler` est appelé à chaque démarrage de `notifications-purge`
  (pas seulement une fois) : en cas de rolling deploy avec chevauchement de
  deux replicas, les deux appellent `upsertJobScheduler` avec les mêmes
  paramètres statiques (`CRON_PATTERN`, `SCHEDULER_ID`) — idempotent par
  construction, pas seulement par l'absence de lock.

**Neutre** :

- `discord-bridge` (ADR-009) n'existe plus dans le code (ADR-027) : cette
  ADR ne le concerne donc pas rétroactivement — elle documente juste que le
  rationale qu'ADR-020 en avait hérité ne s'applique plus à rien
  aujourd'hui.
