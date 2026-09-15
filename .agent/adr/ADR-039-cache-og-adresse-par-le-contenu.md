# ADR-039 : Cache de l'image Open Graph adressé par le contenu rendu

**Date** : 2026-09-15
**Statut** : Accepté — remplace ADR-018 § Décision (cache et headers) et
§ Conséquences (invalidation par `updatedAt`). Le reste d'ADR-018 (Satori +
resvg, un template par type, balises Helmet côté SPA) est inchangé.

## Contexte

ADR-018 met le PNG de l'aperçu social en cache Redis sous la clé
`og:<type>:<slug>:<updatedAt>` (TTL 30 jours) et le sert avec
`Cache-Control: public, max-age=2592000, immutable` sur une URL stable. Le
cache n'est donc invalidé que par ce qui change `updated_at` de la ressource.

Deux choses ont rendu ce contrat intenable :

1. **Le rendu dépend de plus que la ligne.** Depuis `2f422033`, le départ
   d'un membre retire son RSVP du décompte par un filtre à la lecture — sans
   toucher `events.updated_at`. Une image déjà rendue affichait « 5 oui » dont
   un absent, pendant 30 jours. Le nom du payeur d'une dépense, le libellé
   d'une option de sondage, tout futur filtre à la lecture ont le même
   problème : la clé ne sait pas ce qui est dessiné.
2. **Le contrat avait déjà été contourné.** `upsertRsvp` et `vote` touchaient
   `updated_at` _pour_ ce cache — un détournement de « dernière modification »
   qui restait faux pour tout ce qu'on oublierait.

Et l'`immutable` 30 jours sur une URL stable : les clients et CDN qui avaient
l'image la gardaient un mois quoi qu'on fasse côté serveur.

## Options envisagées

**1. Faire porter la version par l'URL** (`?v=<updatedAt>`), garder
`immutable`. Le pattern canonique d'un cache agressif — mais il exige un
`updatedAt` exact, précisément ce qui manque ; et les balises `og:image`
sont posées par Helmet côté client, invisibles des crawlers no-JS.

**2. Élargir ce qui bump `updated_at`** (départ de membre, filtres…). Étend le
détournement, et reste faux pour la prochaine source de rendu oubliée.

**3. Baisser `max-age`, lâcher `immutable`.** Nécessaire, mais insuffisant
seul : le PNG reste périmé dans Redis.

**4. Adresser le cache par le contenu rendu** (retenu, avec 3).

## Décision

1. **Clé Redis dérivée du template** : `og:<type>:<slug>:<sha1(template)[0:16]>`
   (`ogCacheKey`, `routes/public-og/og-renderer.ts`). Le template Satori
   contient tout ce qui est dessiné ; si le rendu change, la clé change,
   quelle qu'en soit la raison — et rien d'autre n'a à être versionné.
   `updatedAt` disparaît de l'interface du renderer. Les 16 hex de SHA-1 sont
   de l'adressage, pas de la sécurité. TTL 30 jours conservé comme borne
   mémoire : les clés orphelines expirent.
2. **Header** : `Cache-Control: public, max-age=300`, sans `immutable`. Les
   plateformes sociales (Facebook/Messenger, X, Slack, Discord via son proxy,
   WhatsApp/iMessage sur l'appareil) fetchent côté serveur et cachent de leur
   côté sans tenir compte de ce header ; aucun cache partagé n'est devant
   l'endpoint. 5 minutes absorbent une rafale de partages d'un même lien sans
   rien figer.
3. Les touches de `updated_at` dans `upsertRsvp` et `vote` **restent**, pour
   une autre raison : la rail « Activité récente » des tableaux de bord
   (`EventsDashboard`, `PollsDashboard`) date chaque RSVP/vote par le
   `updatedAt` de la ligne parente. Elles ne sont plus une obligation du
   cache.

## Conséquences

**Positif** :

- Ferme toute la classe « on a oublié de bump `updated_at` », pas seulement
  le cas RSVP. Tout filtre à la lecture ou valeur dérivée future invalide
  gratuitement.
- Empreinte Redis stable : un RSVP qui bascule oui → non → oui retombe sur
  des clés existantes au lieu d'en frapper une par mutation.
- Le renderer ne connaît plus que ce qu'il dessine.

**Négatif / à savoir** :

- `JSON.stringify(template)` est déterministe par construction (objets
  littéraux dans un ordre fixe, dates pré-formatées en chaînes, pas
  d'`undefined`), mais dépend de deux entrées cachées : la version ICU de
  Node (séparateurs de `toLocaleString`) et le fuseau du process
  (`toLocaleTimeString`). Sur un VPS unique et une image `node` figée, ce
  sont des constantes ; une mise à jour se traduit par un rendu de plus, pas
  par une image périmée — c'est le bon sens de l'erreur.
- Le fuseau du process n'est pas fixé dans l'image de prod : les heures
  rendues sont en UTC. Préexistant, indépendant du cache, tracé en ticket.
- Le point 3 d'ADR-018 (injection SSR des balises pour les crawlers no-JS)
  reste reporté et n'est pas affecté.

**Neutre** :

- Tout rendu coûte ~10-20 ms hors cache ; un hit Redis < 2 ms. Le
  `max-age` court ne change rien à la charge : c'est Redis qui absorbe.
