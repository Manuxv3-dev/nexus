# ADR-040 : Fenêtre de grâce de 30 s sur la détection de réutilisation d'un refresh token

**Date** : 2026-09-15
**Statut** : Accepté

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
     même client, ou vol dans les 30 s suivant la rotation). 401
     `AUTH_TOKEN_INVALID` **sans cascade** — seul cet appareil retombe sur
     l'écran de connexion.

`REFRESH_ROTATION_GRACE_MS = 30_000`, constante fixe exportée depuis
`routes/auth/service.ts` — pas de variable d'env : MVP, à revisiter si le
besoin d'ajuster la fenêtre en prod se présente. La décision est extraite
dans `classifyRevokedRefreshToken`, une fonction **pure** (aucun accès DB)
qui prend `revokedAt`, `replacedById`, l'état du remplacement et `now`, et
rend un verdict (`reuse` / `grace_recover` / `grace_reject`) — testable
unitairement sans Postgres. Le handler `/auth/refresh` ne fait que router
dessus.

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

**Négatif / brèche assumée** :

- Un voleur qui rejoue un token volé dans les 30 s suivant sa rotation
  légitime n'est plus détecté comme voleur : il obtient soit un 401 (si le
  vrai propriétaire a déjà consommé son remplacement), soit — cas plus
  gênant — **une nouvelle paire valide**, si le vrai propriétaire n'a pas
  encore consommé le sien. Ce dernier cas est accepté en connaissance de
  cause : dans ce scénario, l'attaquant détenait déjà un refresh token
  valide de toute façon (celui qu'il vient de rejouer était, jusqu'à la
  rotation, un token actif). La fenêtre ne lui donne pas un accès qu'il
  n'avait pas — elle retarde de 30 s le moment où sa présence est détectée
  et sanctionnée par une cascade. Le vol initial (comment l'attaquant a
  obtenu le token en premier lieu) reste le problème réel, non couvert par
  cette ADR.
- Deux porteurs légitimes qui se disputent réellement une chaîne (bug client,
  copie manuelle d'un token entre deux processus) tombent sur un 401 propre
  au lieu d'un diagnostic explicite — attendu, le contrat de l'API ne
  distingue pas ces cas d'un vol.

**Neutre** :

- Aucun changement client : `AUTH_TOKEN_INVALID` et `AUTH_REFRESH_REUSED`
  sont tous les deux des 401, et `isSessionRejected` (`packages/web/src/lib/
api.ts`) traite tout 401 comme terminal pour CET appareil — le comportement
  observable pour un appareil qui perd la course est inchangé. Ce qui change,
  c'est que les AUTRES appareils ne tombent plus avec lui.
