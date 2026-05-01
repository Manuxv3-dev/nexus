# Tâche en cours

**Statut** : ✅ J3.0 (Auth web cookie + CSRF) livré. Prêt à attaquer **J3a — Architecture commune des bridges**.

## J3.0 — Auth web cookie + CSRF : livré

### Validations finales

- ✅ `pnpm typecheck` propre (3/3 packages)
- ✅ `pnpm lint` 0 errors (99 warnings préexistants ws code)
- ✅ `pnpm test` 14 unit + 2 fichiers d'intégration skip (Postgres absent en sandbox, OK en CI)
- ✅ Mode native (existant) inchangé, mode web ajouté en parallèle

### Livrables J3.0

| Fichier                                              | Contenu                                                       |
|------------------------------------------------------|---------------------------------------------------------------|
| `packages/backend/package.json`                      | + `@fastify/cookie@^11.0.0`                                   |
| `packages/backend/src/core/errors.ts`                | + code `AUTH_CSRF_MISMATCH` (403)                             |
| `packages/backend/src/core/csrf.ts`                  | NOUVEAU : helpers `validateCsrf`, `generateCsrfToken`, constantes |
| `packages/backend/src/routes/auth/service.ts`        | + helpers `detectClientMode`, `setAuthCookies`, `clearAuthCookies`, `readRefreshFromCookie`, `parseTtlMs` exposé |
| `packages/backend/src/routes/auth/schemas.ts`        | refreshToken devient optionnel dans body et reply             |
| `packages/backend/src/routes/auth/index.ts`          | 5 endpoints adaptés mode dual (native/web)                    |
| `packages/backend/src/routes/auth/auth.test.ts`      | + 8 tests bloc "auth — mode web (cookie + CSRF, ADR-015)"     |
| `packages/backend/src/server.ts`                     | + `await app.register(cookie)`                                |
| `.agent/skills/use-auth-web.md`                      | NOUVEAU skill : pattern fetch wrapper côté front, multi-tabs, erreurs |

### Comportement effectif

**Détection du mode** (cf. `detectClientMode`) :
1. Header `X-Nexus-Client: web` → mode web
2. Cookie `nexus_refresh` présent → mode web (session existante)
3. Sinon → mode native (body-token historique)

**Mode web (login/register)** :
- Backend pose 2 cookies : `nexus_refresh` (httpOnly + Secure + SameSite=Strict + Path=/api/v1/auth, Max-Age TTL refresh) et `nexus_csrf` (lisible JS pour double-submit)
- Réponse JSON : `{ user, accessToken }` — **pas de refreshToken**

**Mode web (refresh)** :
- Cookie + header `X-CSRF-Token` requis (sinon 403 AUTH_CSRF_MISMATCH)
- Comparaison constant-time (timingSafeEqual)
- Rotation : nouveaux cookies posés
- Body + cookie ensemble = VALIDATION_ERROR (signal d'attaque potentielle)

**Mode web (logout)** :
- CSRF requis
- Refresh révoqué en DB + cookies clear

**Mode native** :
- Inchangé, body-token. Test E2E "login sans X-Nexus-Client" en preuve.

### Points techniques notables

- **Comparaison CSRF constant-time** via `crypto.timingSafeEqual` (évite les
  timing attacks même si l'exploitation sur 32 bytes hex est très limitée)
- **Path=/api/v1/auth pour `nexus_refresh`** : le cookie ne part que sur les
  endpoints auth, pas sur les autres routes. Réduit le risque d'exposition
  accidentelle (logs, etc.)
- **`Secure` cookies désactivés en dev** (NODE_ENV !== production) pour
  permettre HTTP localhost. En prod toujours HTTPS via Caddy → Secure on.
- **Aucune dette ajoutée** : mode native 100% rétro-compatible, tests
  natifs existants passent inchangés.

## Prochaine étape — J3a (Architecture commune des bridges, ≈ 4-5 j)

Cf. plan détaillé `.agent/notes/j3-plan.md` (section J3a).

Découpage prévu :

- **J3a-1** (1 j) : interface `MessagingProvider` dans `@nexus/shared/messaging/`
- **J3a-2** (1.5 j) : schémas DB `messaging_provider_sessions` + `messaging_channels` + `messaging_messages` + migration `0002_add_messaging_tables.sql`
- **J3a-3** (1 j) : module `integrations/core/encryption.ts` (AES-256-GCM) + tests unitaires (round-trip, authTag corruption, mauvaise clé)
- **J3a-4** (1 j) : module `integrations/core/session-store.ts` (CRUD chiffré transparent) + tests d'intégration
- **J3a-5** (0.5 j) : modules `bridge-registry.ts` + `event-bus.ts` (Redis pub/sub publisher + subscriber) + skeleton worker BullMQ avec lock Redis
- **J3a-6** (0.5 j) : variables d'env (ENCRYPTION_KEY_BRIDGES) + doc `integrations/README.md`

## Pré-requis avant J3a

- [x] J3.0 livré (auth web mode cookie)
- [ ] Manu push J3.0 sur GitHub (git add + commit + push)
- [ ] Manu génère `ENCRYPTION_KEY_BRIDGES` via `openssl rand -base64 32` et la pose dans son `.env` local + dans un coffre sécurisé (1Password, KeePass...)

## Action attendue côté Manu

```bash
cd C:\Users\Manu\claude\nexus\nexus
git add .agent/ packages/backend
git commit -m "feat(backend): J3.0 auth web cookie + CSRF (ADR-015)

- @fastify/cookie register dans server.ts
- core/csrf.ts : validateCsrf + generateCsrfToken (timingSafeEqual)
- AUTH_CSRF_MISMATCH (403) ajouté aux ERROR_CODES
- auth/service.ts : detectClientMode, setAuthCookies, clearAuthCookies, readRefreshFromCookie
- auth/schemas.ts : refreshToken optionnel (mode dual)
- auth/index.ts : register/login/refresh/logout/logout-all dual mode
- auth.test.ts : +8 tests mode web (cookies posés, CSRF validation, double-submit, idempotence rotation, mode native inchangé)
- skill use-auth-web.md : pattern front (fetch wrapper, BroadcastChannel multi-tabs)"
git push
```

## Blockers

Aucun.
