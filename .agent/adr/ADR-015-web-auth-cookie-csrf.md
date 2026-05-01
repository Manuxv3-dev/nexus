# ADR-015 : Auth web — refresh token httpOnly cookie + CSRF token

**Date** : 2026-05-01
**Statut** : Proposé

## Contexte

ADR-004 a défini une stratégie d'authentification pour Nexus :
- Access token JWT (HS256, TTL 15 min) transmis dans le header `Authorization: Bearer`
- Refresh token opaque (UUID v4) hashé sha256 en base, TTL 30 jours,
  rotation systématique avec détection de réutilisation

Le client transmet le refresh token **dans le body** des appels à
`/api/v1/auth/refresh` et `/auth/logout`. Le client le stocke où il veut
(SecureStorage Tauri, Keychain RN, etc.).

Cette stratégie convient aux **clients natifs** mais **pas au web** :
- `localStorage` est volable via XSS (un script tiers compromis lit tout)
- `sessionStorage` perd le token à la fermeture de l'onglet
- Mémoire JS pure : déconnexion à chaque refresh de page

ADR-014 acte que la version web est prioritaire. Il faut donc compléter
ADR-004 par un mode d'auth adapté au web, sans casser le mode existant.

## Options envisagées

### Option A — Refresh token en httpOnly cookie + CSRF token (RETENU)

Le backend pose un cookie `nexus_refresh` à `httpOnly`, `Secure`, `SameSite=Strict`,
`Path=/api/v1/auth`. Le navigateur l'envoie automatiquement aux endpoints
auth ; JavaScript ne peut pas le lire ni l'écrire.

Pour la protection CSRF, on ajoute un **double-submit cookie pattern** :
- Un cookie `nexus_csrf` (lisible par JS — `httpOnly: false`) avec une
  valeur aléatoire
- Sur chaque requête mutating (POST/PATCH/DELETE), le client envoie cette
  valeur dans un header `X-CSRF-Token`
- Le backend vérifie que la valeur du header correspond à la valeur du
  cookie (un attaquant CSRF peut forger une requête mais ne peut pas lire
  le cookie pour fournir le bon header → blocage)

Pros :
- XSS ne peut pas voler le refresh (httpOnly)
- CSRF couvert par double-submit
- `SameSite=Strict` bloque la plupart des attaques cross-origin de toute
  façon (couches de défense)
- Compatible avec rotation de refresh telle qu'elle existe dans ADR-004

Cons :
- Nécessite que le backend implémente le mode cookie en plus du mode body
- Nécessite un middleware de validation CSRF côté backend

### Option B — Refresh token en mémoire JS uniquement

L'access token et le refresh token sont gardés en mémoire React (Zustand
store, sans persistence).

Pros : trivial à implémenter, immune au XSS sur le storage (mais XSS reste
dangereux pour d'autres raisons)

Cons :
- Déconnexion à chaque rechargement de page → friction inacceptable pour
  un produit que l'user ouvre des dizaines de fois par jour

### Option C — Refresh en localStorage

Pros : simple

Cons : volable via XSS — pour un produit messagerie qui contient les
conversations privées d'utilisateurs, c'est un risque inacceptable. **Rejeté**.

### Option D — Pas de refresh, access token long

Access TTL ~7 jours en httpOnly cookie. Pas de mécanisme de rotation.

Cons :
- Si le cookie est compromis, fenêtre d'exposition très longue
- Pas de "logout-all" propre (pas de DB-backed lifecycle)
- Régression par rapport à ADR-004. **Rejeté**.

## Décision

**Option A**. Le backend supporte **deux modes** d'auth en parallèle, choisi
côté client :

### Mode "native" (clients Tauri, RN, mobile, CLI)
- Inchangé par rapport à ADR-004
- Refresh token transmis dans le body de `/auth/refresh` et `/auth/logout`
- Access token dans `Authorization: Bearer`
- Pas de cookie posé

### Mode "web" (clients navigateur)
- Le client envoie un header `X-Nexus-Client: web` lors du `/auth/login` ou
  `/auth/register`
- Le backend pose deux cookies dans la réponse :
  - `nexus_refresh` : `httpOnly`, `Secure`, `SameSite=Strict`,
    `Path=/api/v1/auth`, TTL = TTL du refresh
  - `nexus_csrf` : `Secure`, `SameSite=Strict`, lisible par JS, TTL = TTL
    du refresh
- L'access token est retourné dans la **réponse JSON** (pas en cookie),
  et le client le stocke en mémoire React (Zustand). Pas persistant, pas
  visible aux scripts tiers facilement (JS isolation).
- Sur `/auth/refresh` :
  - Le client appelle l'endpoint sans body (le cookie part automatiquement)
  - Le client fournit `X-CSRF-Token: <value du cookie nexus_csrf>` dans le
    header
  - Le backend vérifie le cookie + le header, rotate le refresh, pose un
    nouveau cookie `nexus_refresh`, retourne le nouveau access token en JSON
- Sur `/auth/logout` : pareil, le backend supprime les cookies + révoque
  l'entrée DB

### Schéma cookies

| Cookie         | httpOnly | Secure | SameSite | Path                | TTL        | Lisible JS |
|----------------|----------|--------|----------|---------------------|------------|------------|
| `nexus_refresh`| Oui      | Oui    | Strict   | `/api/v1/auth`      | 30j        | Non        |
| `nexus_csrf`   | Non      | Oui    | Strict   | `/`                 | 30j        | Oui        |

Le path `/api/v1/auth` pour le refresh évite que le cookie soit envoyé sur
les autres endpoints (limite la surface en cas de bug serveur ou logging
accidentel).

### Implémentation backend

**Nouveau plugin Fastify `csrf-protection.ts`** :
- À l'inscription/login en mode web → génère un nouveau token CSRF aléatoire
  (32 bytes hex), le pose en cookie `nexus_csrf`
- Pour toute requête `POST/PUT/PATCH/DELETE` avec un cookie `nexus_refresh`
  présent → vérifie que `X-CSRF-Token` header == valeur du cookie `nexus_csrf`.
  Si mismatch → `AppError('AUTH_CSRF_MISMATCH', 403)`
- Les routes publiques (health, pages publiques) sont exemptées (pas de
  cookie nexus_refresh attendu)

**Nouveau code d'erreur** :
```ts
AUTH_CSRF_MISMATCH: { http: 403, message: 'CSRF token mismatch' }
```

**Endpoints auth modifiés** (rétro-compatibles) :
- `/auth/login` : si `X-Nexus-Client: web` → pose les cookies + retourne
  `{ user, accessToken }` (pas de refreshToken dans le JSON). Sinon →
  comportement existant (accessToken + refreshToken en JSON).
- `/auth/register` : pareil
- `/auth/refresh` : accepte soit `body.refreshToken` (mode native) soit
  cookie + header CSRF (mode web). Si les deux fournis → erreur
  `VALIDATION_ERROR`.
- `/auth/logout` : pareil, supprime les cookies si mode web

### Implémentation côté `@nexus/web`

- `fetch` wrapper qui :
  - Inclut toujours `credentials: 'include'` (pour les cookies)
  - Lit `nexus_csrf` cookie (via `document.cookie`) et l'ajoute en header
    `X-CSRF-Token` sur les requêtes mutating
  - Sur 401 → tente un refresh, retry une fois ; si refresh échoue, déclenche
    le logout (vide le store, redirige vers `/login`)
- `Authorization: Bearer <accessToken>` ajouté depuis le store Zustand

### Test : pourquoi `SameSite=Strict` n'est pas suffisant seul

`SameSite=Strict` bloque la plupart des attaques CSRF modernes (le cookie
n'est pas envoyé sur des requêtes initiées depuis un autre site). Mais
deux cas restent :
1. Sous-domaines compromis : un sous-domaine `xss-vulnerable.nexusapp.chat`
   peut faire des requêtes qui sont same-site → cookies envoyés. La défense
   `nexus_csrf` double-submit empêche l'attaquant de forger.
2. Anciens navigateurs (avant 2020-ish) qui interprètent mal SameSite. Le
   double-submit CSRF reste utile pour les couvrir.

Donc `SameSite=Strict` + double-submit = **ceinture + bretelles**. Standard
moderne (recommandé OWASP cheat sheet 2024).

### Token CSRF : par session ou par requête ?

**Par session** (RETENU pour V1) : un seul token CSRF par session de login,
tourné à chaque refresh. Plus simple à implémenter.

**Par requête** : token jetable, plus safe mais lourdingue (sync nécessaire
à chaque action). Pas justifié pour un produit messagerie B2C.

### Multi-tabs

Plusieurs onglets ouverts → chaque onglet a son propre access token en
mémoire mais ils partagent les cookies refresh + CSRF. À la première
expiration access, l'onglet déclenche `/auth/refresh`. Si deux onglets
font /refresh en même temps : le premier réussit (rotate), le second
échoue (token revoked = AUTH_REFRESH_REUSED).

→ Pour éviter ce faux positif, utiliser **BroadcastChannel** : avant de
refresh, l'onglet diffuse "I'm refreshing". Les autres attendent le résultat
plutôt que tenter en parallèle. Pattern classique, à implémenter dans le
fetch wrapper.

### Logout multi-device

Inchangé : `/auth/logout-all` (POST) revoke tous les refresh tokens de
l'user. En mode web, l'endpoint accepte le cookie comme auth source.

## Conséquences

**Positives**
- Refresh token immune au XSS direct
- Les clients natifs continuent à fonctionner exactement comme aujourd'hui
- Pattern industry-standard (cookie httpOnly + double-submit CSRF est dans
  toutes les recos OWASP)

**Négatives / coûts**
- ~1 jour de boulot dans J3 ou J4 pour ajouter le mode cookie + plugin CSRF
- Tests d'intégration auth doivent couvrir les deux modes
- Petite complexité front (cookie reading + BroadcastChannel pour
  multi-tabs)

**Neutres**
- ADR-004 reste valide pour les clients natifs
- Pas de changement de schéma DB (la table `refresh_tokens` est agnostique
  du mode de transport)

## Implémentation prévue

À insérer en **J3** (avant J4-pre, pour que le backend soit prêt avant
qu'on attaque l'app web). Sous-jalon dédié estimé 1-2 j :
- Nouveau plugin `csrf-protection.ts`
- Modif endpoints auth pour supporter le mode web (`X-Nexus-Client: web`,
  cookies, CSRF header)
- Tests d'intégration : mode native (existants), mode web (nouveaux)
- ERROR_CODE `AUTH_CSRF_MISMATCH`
- Doc dans `.agent/skills/use-auth-web.md` (skill réutilisable côté front)

## Références

- ADR-004 : auth JWT + refresh tokens (étendu ici, pas remplacé)
- ADR-014 : web-first — motive l'ajout de ce mode
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet (2024)
- MDN : `Set-Cookie` / `SameSite` (https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
