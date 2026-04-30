# ADR-004 : Authentification — JWT access court + refresh httpOnly

**Date** : 2026-04-30
**Statut** : Accepté

## Contexte

Nexus a besoin d'une auth utilisateur (clients desktop, mobile à terme) et d'une
auth pour les passerelles tierces (OAuth Discord, Messenger, WhatsApp). Le projet
démarre mono-tenant mais doit pouvoir basculer multi-tenant sans refactor majeur
(cf. ADR-005).

Contraintes :
- Plusieurs clients (desktop Tauri, mobile RN à terme) → tokens portables
- Sessions WebSocket à authentifier
- Pas de réinvention : on s'appuie sur des libs éprouvées
- Sécurité : pas de JWT longue durée stocké en localStorage côté desktop

## Options envisagées

### 1. JWT access seul, longue durée
- **Pros** : simple
- **Cons** : pas de révocation, exposition prolongée si fuite, mauvaise pratique

### 2. JWT access court + refresh long
- **Pros** : standard de l'industrie, révocation possible (refresh DB-backed), attaques limitées dans le temps
- **Cons** : un peu plus de plomberie

### 3. Sessions serveur (cookie + Redis)
- **Pros** : révocation triviale, simple
- **Cons** : pas idéal pour clients natifs (cookies cross-origin, cookie jar Tauri/RN)

## Décision

**JWT access court (15 min) + refresh token long (30 j) stocké en DB.**

Architecture :
- **Access token** : JWT signé HS256 (secret dans env), 15 min, contient `userId`, `groupIds[]` (pour le multi-tenant ready)
- **Refresh token** : opaque (UUID v4), stocké en DB hashé (sha256), associé à `userId`, `deviceId`, `expiresAt`, `revokedAt`
- **Stockage côté client** :
  - Desktop Tauri : refresh token dans le keychain OS via `tauri-plugin-store` chiffré (pas localStorage)
  - Mobile RN (V2) : `expo-secure-store`
- **Endpoints** :
  - `POST /api/v1/auth/login` → `{ accessToken, refreshToken }`
  - `POST /api/v1/auth/refresh` → rotation systématique du refresh (un refresh = un nouveau couple, l'ancien refresh est révoqué)
  - `POST /api/v1/auth/logout` → révocation du refresh courant
  - `POST /api/v1/auth/logout-all` → révocation de tous les refresh de l'user
- **WebSocket** : access token passé en query string à la connexion (`wss://.../ws?token=`), validé une fois ; pas de refresh côté WS (la connexion se réouvre quand l'access expire, le client gère)
- **OAuth tiers (Discord/Messenger/WhatsApp)** : tokens stockés chiffrés (AES-GCM, clé dans env) en DB, refresh géré par worker dédié

Hashing des passwords : `argon2id` (lib `argon2`), paramètres OWASP 2024.

## Conséquences

**Positif** :
- Standard, bien outillé, audit facile
- Révocation possible (refresh DB-backed)
- Compatible mobile dès le départ
- Le `groupIds[]` dans l'access token simplifie l'autorisation (pas de roundtrip DB par requête pour vérifier l'appartenance à un groupe)

**Négatif** :
- Si un access token fuit pendant ses 15 min, l'attaquant a accès jusqu'à expiration (mitigation : 15 min, pas plus)
- Plomberie refresh à écrire (skill dédié `auth-refresh-flow.md` à créer au moment de l'implémentation)

**Neutre** :
- Multi-tenant futur : ajouter un `tenantId` dans le payload JWT le moment venu, l'infra ne change pas
- Côté Tauri, dépendance au keychain OS — fonctionne sur macOS, Windows, Linux (libsecret)
