# `packages/backend/src/integrations/`

Architecture commune des bridges messageries (cf. ADR-009).

## Structure

```
integrations/
├── core/                       # Code partagé entre tous les providers
│   ├── encryption.ts           # AES-256-GCM pour les credentials
│   ├── encryption.test.ts
│   ├── session-store.ts        # CRUD chiffré transparent sur messaging_provider_sessions
│   ├── bridge-registry.ts      # Map providerType → ProviderConstructor
│   ├── event-bus.ts            # Redis pub/sub : worker → backend → WS
│   └── lock.ts                 # Lock distribué Redis pour workers singleton
├── discord/                    # J3b — DiscordProvider + OAuth + worker
│   └── ...
├── whatsapp/                   # J7 — WhatsAppProvider via Baileys
│   └── ...
└── messenger/                  # J8 — MessengerProvider via mautrix-meta
    └── ...
```

## Pour ajouter une nouvelle messagerie

Cf. skill `.agent/skills/integrate-messaging-platform.md` pour le workflow
détaillé. Résumé :

1. Créer `integrations/<provider>/provider.ts` qui implémente l'interface
   `MessagingProvider` de `@nexus/shared`.
2. Ajouter le provider à `ProviderTypeSchema` (ENUM Postgres + Zod).
3. `registerProvider('<type>', (session) => new MyProvider(session))` dans
   `integrations/<provider>/index.ts`.
4. Ajouter le worker correspondant dans `packages/backend/src/workers/`.
5. Créer les endpoints REST de gestion de session sous
   `routes/messaging/<provider>/`.
6. Tests unit (mapper) + tests d'intégration (CRUD endpoints).

## Variables d'env

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `ENCRYPTION_KEY_BRIDGES` | Si bridges actifs | base64 de 32 bytes — chiffre les credentials |
| `DISCORD_BOT_TOKEN` | J3b+ | Token du bot Discord global |
| `DISCORD_CLIENT_ID` | J3b+ | App ID Discord |
| `DISCORD_CLIENT_SECRET` | J3b+ | Secret OAuth Discord |
| `DISCORD_BOT_PERMISSIONS` | J3b+ | Bitfield des perms du bot |
| `PUBLIC_BASE_URL` | J3b+ | URL publique pour redirect_uri OAuth (https://api.nexusapp.chat en prod) |

## Architecture runtime

```
[Worker bridge]                     [Backend HTTP]
  ├─ connect au gateway              ├─ register routes /api/v1/messaging/*
  ├─ event MessageCreate             ├─ publishControl quand session ajoutée
  └─ publishBridgeEvent ─────────────────► subscribeBridgeEvents
                                         └─ relay sur WS Nexus aux membres
                                            du groupe scope
```

Topics Redis :
- `bridge:event:discord` — events worker → backend (events: message:new, etc.)
- `bridge:event:whatsapp`, `bridge:event:messenger` — idem pour les autres providers
- `bridge:control:discord` — commandes backend → worker (cmd: session:added, etc.)
- Idem pour les autres providers

## Sécurité

- **Credentials chiffrés** AES-256-GCM avec authTag (intégrité + confidentialité)
- **Clé hors-DB** : `ENCRYPTION_KEY_BRIDGES` à backuper séparément des dumps Postgres
- **Anti-leak DB** : contrainte unique `(provider_type, external_id)` empêche
  de rattacher un même serveur Discord à 2 groupes Nexus différents
- **Lock distribué** : empêche deux instances du même worker de tourner en
  parallèle (intent : pour quand on aura plusieurs replicas backend en prod)

## Patterns de tests

- **Encryption** : tests unit purs (round-trip, corruption, mauvaise clé)
- **Session-store** : tests d'intégration avec Postgres réel (couvert
  indirectement par les tests des endpoints messaging)
- **Event-bus** : tests d'intégration avec Redis réel (publish dans un
  topic test, vérifier réception)
- **Workers** : tests E2E manuels documentés dans le skill

## Référence ADR

- ADR-005 : multi-tenant `groupId` partout, anti-leak strict
- ADR-009 : architecture des bridges server-side
- ADR-010 : pas d'auto-envoi vers les conversations source
