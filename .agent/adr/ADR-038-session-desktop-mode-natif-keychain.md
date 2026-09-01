# ADR-038 : Session desktop — mode natif et refresh token au keychain de l'OS

**Date** : 2026-09-01
**Statut** : Accepté

## Contexte

Sur desktop, la session ne survit pas au redémarrage de l'application :
l'utilisateur doit ressaisir son mot de passe à chaque lancement. Ce n'est pas
une fonctionnalité manquante — le mécanisme existe et vise 30 jours
(`JWT_REFRESH_TTL` vaut `'30d'` par défaut, `packages/backend/src/core/env.ts`).
Il ne fonctionne simplement jamais sur desktop.

### Pourquoi

ADR-015 a posé le mode web : le refresh token voyage dans un cookie httpOnly
`nexus_refresh`, en `SameSite=Strict` (`routes/auth/service.ts`,
`setAuthCookies`). C'est le bon choix pour `app.nexusapp.chat`, servi
same-origin derrière Traefik.

Le desktop, lui, sert le front depuis une origine locale — `frontendDist` dans
`tauri.conf.json`, donc `http://tauri.localhost` sous WebView2 — pendant qu'il
appelle l'API en absolu sur `https://api.nexusapp.chat` (`VITE_API_BASE`, cf.
ADR-031). Front et API sont donc **cross-site**, et un cookie `SameSite=Strict`
n'est par définition jamais envoyé sur une requête cross-site.

Conséquence : le `POST /auth/refresh` du démarrage (`lib/auth.ts`, `init()`)
part sans cookie, le serveur répond 401, et l'utilisateur retombe sur l'écran de
login. Le login lui-même continue de marcher parce qu'il renvoie l'access token
**dans le corps** de la réponse, gardé en mémoire — d'où une session qui vit
tant que le process tourne et meurt avec lui.

Vérifié en préflight réel contre la production :

| Origine                  | `OPTIONS /api/v1/auth/login` |
| ------------------------ | ---------------------------- |
| `http://localhost:5173`  | rejeté (500)                 |
| `http://tauri.localhost` | 204, `Allow-Origin` renvoyé  |

La liste blanche CORS accepte donc bien l'origine desktop : le problème n'est
pas le CORS, c'est uniquement le `SameSite` du cookie.

## Options envisagées

1. **`SameSite=None; Secure` conditionnel au client desktop.** Le backend
   poserait le cookie en `None` quand la requête vient du desktop, en gardant
   `Strict` pour le web. C'est le moins de code et aucune dépendance nouvelle.
   Mais le cookie devient un **cookie tiers**, dont le sort dépend des
   politiques de blocage de Chromium/WebView2 — le blocage des cookies tiers
   étant une direction de fond des moteurs, la session pourrait recasser sans
   prévenir à une mise à jour du moteur, sur un mécanisme qu'on ne contrôle
   pas. On échangerait une panne certaine contre une panne différée.

2. **Servir le front desktop depuis l'origine de l'API**, ce qui rétablirait le
   same-site. Écarté : contredit `frontendDist` (copie figée au build, ADR-031)
   et rendrait le lancement de l'application dépendant du réseau.

3. **Repasser le desktop en mode natif, avec le refresh token au keychain de
   l'OS.** Le token quitte le cookie et transite dans le corps de la réponse ;
   il est rangé dans le magasin de secrets du système.

## Décision

**Option 3.**

Le desktop bascule en mode `native`. Le refresh token n'est plus un cookie mais
une valeur applicative, stockée dans le magasin de secrets de l'OS
(Credential Manager sous Windows, Keychain sous macOS, Secret Service sous
Linux) via une commande Tauri dédiée.

### Ce qui rend cette option peu coûteuse

Le mode natif **existe déjà de bout en bout côté backend**, hérité d'avant
ADR-015 et jamais retiré :

- `detectClientMode` (`routes/auth/service.ts`) renvoie `'native'` par défaut,
  et ne bascule en `'web'` que sur le header `X-Nexus-Client: web` ou la
  présence du cookie.
- `TokenPairSchema` (`routes/auth/schemas.ts`) déclare déjà
  `refreshToken: z.string().optional()`, documenté « présent en mode native,
  absent en mode web ».
- `POST /auth/refresh` et `POST /auth/logout` acceptent déjà le token en body,
  avec un garde-fou explicite si les deux sources sont fournies
  (`ambiguous_token_sources`).
- La validation CSRF n'est appliquée qu'en mode web, ce qui est cohérent : sans
  cookie, il n'y a pas de requête authentifiée ambiante à forger.

**Aucun changement backend n'est nécessaire.** Le seul verrou est côté client :
`lib/api.ts` envoie `X-Nexus-Client: 'web'` en dur, pour toutes les cibles.

### Ce qui est explicitement refusé

Le refresh token ne doit **jamais** être écrit dans `localStorage` ni
`sessionStorage`. Le commentaire de `lib/api.ts` interdit déjà `localStorage`
pour l'access token (durée de vie 15 min) au motif du XSS ; un refresh token de
30 jours y serait strictement pire. Le magasin de secrets de l'OS est la seule
destination acceptable — c'est la raison d'être de cette décision, pas un
détail d'implémentation.

## Conséquences

### Positives

- La session desktop survit au redémarrage, pour la durée réellement prévue.
- Le mode web n'est pas touché : `SameSite=Strict` et le double-submit CSRF
  d'ADR-015 restent intacts sur `app.nexusapp.chat`. Aucun affaiblissement
  n'est concédé au navigateur pour arranger le desktop.
- Le secret est protégé par le système (chiffrement au repos, déverrouillage
  lié à la session utilisateur) plutôt que par le stockage d'un navigateur.
- La révocation existante continue de fonctionner sans adaptation : la
  rotation, la détection de réutilisation et `logout-all` opèrent sur le hash
  en base, indépendamment du transport.

### Négatives et risques

- **Une dépendance Rust supplémentaire.** `keyring` (crates.io, v4.2.0 au
  2026-08-29, ~9,4 M de téléchargements récents, MIT/Apache-2.0) est le
  candidat retenu. Attention : la **v4 a restructuré le crate** en
  `keyring-core` plus des crates de stockage par plateforme, au lieu d'un crate
  unique à features. Les snippets antérieurs ne s'appliquent pas — le jeu exact
  de dépendances doit être figé à l'implémentation, en compilant, et non recopié
  d'un tutoriel.
- **Linux sans Secret Service.** Le magasin de secrets n'est pas garanti
  présent sur une session Linux minimale ou headless. L'écriture du token peut
  donc échouer à l'exécution alors que le build passe. Le comportement doit
  **dégrader proprement** : si le magasin est indisponible, on retombe sur la
  session en mémoire — c'est-à-dire le comportement actuel — sans bloquer le
  login ni faire planter l'application. Un échec de stockage n'est pas un échec
  d'authentification.
- **Surface de test réduite.** La CI de release build les trois plateformes,
  mais le comportement du magasin de secrets ne se vérifie qu'à l'exécution,
  sur une vraie session de bureau. Windows est la seule plateforme réellement
  vérifiable dans le cadre de travail actuel ; macOS et Linux resteront
  vérifiés par usage.
- **Deux modes d'authentification coexistent durablement** (web cookie, desktop
  natif). C'était déjà le cas dans le code depuis ADR-015 ; cette décision rend
  la coexistence intentionnelle et testée, au lieu de laisser une branche morte.

### Rapport avec les autres décisions

- **ADR-015** n'est pas révoqué. Il reste la règle pour le mode web. Cet ADR
  documente que le desktop n'est pas un client web et ne doit pas être traité
  comme tel.
- **ADR-031** (release desktop) est inchangé : `frontendDist` et l'appel API en
  absolu restent la configuration retenue — c'est précisément ce qui impose le
  mode natif plutôt que de le contourner.
