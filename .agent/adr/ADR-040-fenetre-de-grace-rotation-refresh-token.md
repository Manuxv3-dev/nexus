# ADR-040 : Fenêtre de grâce de 30 s sur la détection de réutilisation d'un refresh token

**Date** : 2026-09-15
**Statut** : Accepté — complète ADR-004 § Décision (`POST /api/v1/auth/refresh`
→ rotation systématique du refresh, détection de réutilisation par cascade).

## Contexte

`POST /auth/refresh` (ADR-004) rote systématiquement le refresh token : un
refresh consomme l'ancien (`revokedAt` posé, `replacedById` pointant vers le
nouveau) et renvoie un nouveau couple access + refresh. Rejouer un refresh
déjà révoqué est lu comme un signal de vol — `revokeAllRefreshTokens` coupe
alors **toutes les sessions** de l'utilisateur, sur tous ses appareils. C'est
la bonne réponse face à un vrai rejeu par un tiers qui aurait intercepté le
token.

`17d116dc` (PR #95) a changé ce que fait le CLIENT face à un refresh qui
échoue : un échec transitoire (coupure réseau, 5xx pendant un déploiement) ne
coûte plus la session — le client garde son refresh token et retente au
prochain 401, au lieu d'effacer le token et de forcer un re-login. Ce choix
laisse ouvert un cas côté serveur : le refresh a **réussi** (rotation faite,
ancien token révoqué, nouveau émis) mais la **réponse** s'est perdue —
timeout, coupure entre l'écriture en base et l'envoi de la réponse HTTP. Le
client ne connaît que l'ancien token ; au prochain essai il le rejoue → le
serveur voit un token révoqué → il l'interprète comme un vol → cascade sur
tous les appareils, pour un aléa réseau. La sanction est maximale pour un
événement qui n'a rien d'une attaque.

Même famille de problème : deux refresh concurrents émis par le même compte
depuis deux fenêtres/appareils (le `refreshInFlight` de `packages/web/src/
lib/api.ts` ne dédoublonne que dans un seul onglet, pas entre deux instances
du client).

## Décision

Une rotation pose déjà les deux informations nécessaires pour distinguer un
rejeu légitime d'un vol : `revokedAt` (quand) et `replacedById` (par quoi).
`revokeAllRefreshTokens` (logout-all, changement de mot de passe, cascade de
réutilisation), en comparaison, ne pose que `revokedAt` — `replacedById`
reste `null`. Cette distinction existante permet de qualifier le rejeu d'un
token révoqué :

1. **Révoqué délibérément** (`replacedById` nul — logout, logout-all,
   changement de mot de passe, cascade) → comportement actuel : cascade
   (`revokeAllRefreshTokens`) + `AUTH_REFRESH_REUSED`. Quelle que soit
   l'ancienneté — une révocation délibérée n'a pas de fenêtre de grâce.
2. **Révoqué par rotation, hors fenêtre** (`replacedById` non nul,
   `now - revokedAt >= 30 000 ms`) → comportement actuel : cascade.
3. **Révoqué par rotation, dans la fenêtre** (`now - revokedAt < 30 000 ms`)
   → jamais de cascade :
   - si le remplacement (`replacedById`) est encore **vivant** (jamais
     consommé, pas expiré) : c'est vraisemblablement le propriétaire
     légitime qui n'a pas reçu sa réponse de rotation. On révoque ce
     remplacement inutilisé et on émet une nouvelle paire sur la même
     chaîne (même session), exactement comme un refresh nominal. Réponse 200.
   - si le remplacement a **déjà été consommé** : deux porteurs se
     disputent la chaîne dans la fenêtre (deuxième requête concurrente du
     même client, ou vol dans les 30 s suivant la rotation). On révoque
     alors **toute la chaîne disputée** (`revokeSessionChain`, filtrée sur
     `session_id`, SANS poser `replacedById` sur la tête de chaîne — tout
     rejeu ultérieur d'un de ses tokens retombe donc sur le cas 1, pas sur
     une nouvelle fenêtre de grâce) puis 401 `AUTH_TOKEN_INVALID` **sans
     cascade user-wide immédiate** : seul cet appareil retombe sur l'écran
     de connexion À CET INSTANT, et le porteur qui a gagné la course perd
     lui aussi la chaîne — sans ce durcissement, il la garderait active et
     indétectable jusqu'à son expiration naturelle (30 j). Mais parce que
     `replacedById` reste nul sur cette tête de chaîne révoquée, le
     PROCHAIN refresh de ce porteur (celui qui avait gagné) la retrouve
     révoquée sans remplacement → il retombe à son tour sur le cas 1
     (`reuse`) → **cascade user-wide, différée** jusque-là (au plus tard le
     TTL de l'access token, 15 min). Les autres sessions du user ne sont
     donc « intactes » que jusqu'à ce refresh différé, pas indéfiniment.
     Cf. § Brèche assumée et § Conséquences (Neutre) pour ce que ça ferme,
     ce que ça ne ferme pas, et le compromis assumé sur un conflit entre
     porteurs légitimes.

`REFRESH_ROTATION_GRACE_MS = 30_000`, constante fixe exportée depuis
`routes/auth/service.ts` — pas de variable d'env : MVP, à revisiter si le
besoin d'ajuster la fenêtre en prod se présente. La décision est extraite
dans `classifyRevokedRefreshToken`, une fonction **pure** (aucun accès DB)
qui prend `revokedAt`, `replacedById`, l'état du remplacement et `now`, et
rend un verdict (`reuse` / `grace_recover` / `grace_reject`) — testable
unitairement sans Postgres. Le handler `/auth/refresh` ne fait que router
dessus.

Effet de bord corrigé au passage, sur le chemin qu'on refactore de toute
façon : l'émission de la nouvelle paire (`issueRotatedTokens`,
`routes/auth/index.ts`) vérifie désormais le claim de `revokeRefreshToken`
(retour booléen, `WHERE revoked_at IS NULL`, même pattern que `resetPassword`).
Sans ça, deux refresh simultanés sur le même token émettraient chacun un
nouveau token valide, et le perdant de la course laisserait le sien orphelin
en base — vivant jusqu'à expiration (30 j), et depuis #100 maintenant une
session « vivante » qui reçoit du push pour un appareil qui ne le détient
plus. Le perdant reçoit maintenant un 401 `AUTH_TOKEN_INVALID` local.

### Comparaison avec l'existant du marché

- **Auth0 (« Reuse Interval »)** : un paramètre de configuration explicite
  qui tolère la réutilisation de l'ancien refresh token pendant une fenêtre
  courte après une rotation, précisément pour absorber les requêtes
  concurrentes/réponses perdues sans déclencher leur détection de
  réutilisation. C'est le même mécanisme — Auth0 documente ce compromis
  comme une nécessité opérationnelle, pas comme un pis-aller.
- **OAuth 2.1 / BCP refresh token rotation** : recommande la rotation
  systématique et la détection de réutilisation, mais ne prescrit pas une
  détection instantanée à la milliseconde — une tolérance courte, bornée, et
  qui ne réémet jamais qu'à un porteur du token valide au départ, reste dans
  l'esprit de la recommandation. Ce n'est pas désactiver la détection ; c'est
  la reporter de quelques secondes pour le seul cas où le remplacement n'a
  jamais servi.

## Conséquences

**Positif** :

- Une coupure réseau ou un timeout entre la rotation et sa réponse ne coûte
  plus TOUTES les sessions de l'utilisateur — au pire un aller-retour
  transparent (200, nouvelle paire), au pire un re-login sur le seul appareil
  concerné.
- Couvre aussi le cas de deux fenêtres/appareils du même compte qui
  rafraîchissent en même temps sans coordination (`refreshInFlight` ne
  dédoublonne que dans un seul contexte JS).
- `classifyRevokedRefreshToken` est pure et testée sans DB : la logique de
  décision est vérifiable en local, indépendamment de Postgres/CI.

**Négatif / brèche assumée** (décrite telle qu'implémentée, pas telle
qu'espérée — la première rédaction de cette section affirmait à tort que la
fenêtre « retarde de 30 s » la détection dans tous les cas ; revue de sécurité
de la PR) :

La fenêtre ne borne PAS la détection à 30 s dans l'absolu. Ce qui se passe
dépend de qui, du voleur (S) ou du propriétaire légitime (O), retente un
refresh en premier après une rotation contestée sur la même chaîne :

- **O rejoue en premier après une rotation faite par S** (S a roté
  T0→T1s puis T1s→T2s avant qu'O ne rejoue T0) : le remplacement de T0
  (T1s) est déjà consommé → `grace_reject`. Ce verdict révoque désormais
  **toute la chaîne** (`revokeSessionChain`) : T2s — la tête active de S —
  meurt avec elle. O reçoit un 401 local (comportement observable
  inchangé) ; S est évincé dès son prochain refresh, ce qui, en pratique,
  arrive vite (son unique jeton valide vient d'être révoqué) — et cette
  éviction cascade alors TOUT le compte (`revokeAllRefreshTokens`), pas
  seulement la chaîne du voleur (cf. § Conséquences, Neutre, pour le coût de
  ce même mécanisme dans un conflit entre porteurs légitimes). Ce cas est
  **fermé** par le durcissement `revokeSessionChain` de cette révision — sans
  lui, T2s survivait, invisible, jusqu'à son expiration naturelle (30 j).
- **S rejoue en premier après une rotation nominale d'O** (O a roté
  normalement T0→T1, T1 n'a pas encore servi) : `grace_recover` traite S
  comme le propriétaire légitime qui n'a pas reçu sa réponse — S reçoit une
  nouvelle paire, T1 est révoqué. O ne le découvre qu'à SON prochain
  refresh, ce qui peut prendre jusqu'au TTL de l'access token (15 min,
  ADR-004) s'il n'a aucune raison de rafraîchir avant. Ce refresh tombe
  hors fenêtre (largement) → `reuse` → cascade complète, sur tout le
  compte. **Ce cas n'est PAS fermé** par cette révision : il est inhérent à
  toute tolérance de rejeu — le porteur évincé n'est détecté que lorsqu'il
  se manifeste. La borne haute réelle est donc le TTL de l'access token
  (15 min), pas 30 s.
- La fenêtre **glisse** : chaque `grace_recover` pose un `revokedAt` neuf
  sur le token qu'il révoque, ouvrant une fenêtre de 30 s propre à CE token.
  Un enchaînement de récupérations peut donc repousser la détection sur
  plusieurs fenêtres successives — pas une fenêtre glissante sans borne :
  elle ne s'étend qu'au rythme des requêtes de refresh effectivement
  envoyées, chacune bornée à 30 s de plus.

Dans tous les cas, la fenêtre ne donne jamais à un porteur un accès qu'il
n'avait pas déjà : que le rejeu réussisse (`grace_recover`) ou échoue
(`grace_reject`, qui révoque maintenant sa chaîne), le porteur qui perd la
course n'obtient jamais qu'un 401 sur cet appareil. Ce qui est retardé, c'est
la cascade sur les AUTRES appareils du compte — au maximum jusqu'au TTL de
l'access token du porteur évincé dans le second scénario ci-dessus, pas 30 s
dans l'absolu. Le vol initial (comment l'attaquant a obtenu un token en
premier lieu) reste le problème réel, non couvert par cette ADR.

Reste, hors des deux scénarios ci-dessus : deux porteurs légitimes qui se
disputent réellement une chaîne (bug client, copie manuelle d'un token entre
deux processus) tombent sur un 401 propre au lieu d'un diagnostic explicite
— attendu, le contrat de l'API ne distingue pas ces cas d'un vol.

**Neutre** :

- Aucun changement client : `AUTH_TOKEN_INVALID` et `AUTH_REFRESH_REUSED`
  sont tous les deux des 401, et `isSessionRejected` (`packages/web/src/lib/
api.ts`) traite tout 401 comme terminal pour CET appareil — le comportement
  observable pour un appareil qui perd la course est inchangé. Ce qui change,
  c'est que les AUTRES appareils ne tombent plus avec lui **à l'instant du
  rejet** — cf. le point suivant pour la nuance sur ce qui se passe ensuite.
- **`grace_reject` diffère la cascade, il ne l'annule pas.** Parce que
  `revokeSessionChain` ne pose pas `replacedById` sur la tête de chaîne
  qu'elle révoque, le porteur qui avait gagné la course la retrouve sans
  remplacement à SON prochain refresh — ce qui la fait retomber sur le
  verdict `reuse` et cascade alors TOUT le compte (`revokeAllRefreshTokens`),
  pas seulement cette chaîne. Dans le scénario visé (un voleur qui a déjà
  roté deux fois avant que le propriétaire ne rejoue), c'est voulu : le
  voleur perd sa chaîne immédiatement, et sa tentative suivante déclenche une
  cascade qui ferme aussi ses autres footholds éventuels sur le compte. Mais
  dans un conflit entre porteurs LÉGITIMES du même compte (typiquement trois
  onglets web restaurés simultanément avec le même cookie `nexus_refresh` —
  il en faut désormais TROIS concurrents dans la fenêtre de 30 s pour
  atteindre ce cas, contre deux avant cette PR pour une cascade immédiate),
  le porteur qui avait gagné la course se fait déconnecter puis déclenche à
  son insu une déconnexion générale DIFFÉRÉE de tout le compte (jusqu'à
  15 min plus tard), là où l'ancien comportement (avant ce durcissement) ne
  coûtait qu'un onglet perdant, immédiatement, sans effet de bord sur les
  autres. **Décision : assumé.** Le cas demande trois porteurs concurrents
  dans la fenêtre (rare) ; fermer la brèche du voleur prime sur ce coût
  résiduel. La déduplication inter-onglets côté web (`refreshInFlight` ne
  couvre qu'un seul onglet, cf. § Contexte) reste hors scope de cette ADR et
  est ticketée séparément.
