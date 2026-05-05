# `packages/backend/src/integrations/`

Code partagé entre les sessions de provider messagerie.

## Statut post-ADR-027

Depuis ADR-027 (universalisation webview messaging), toutes les
messageries supportées (Discord, WhatsApp, Messenger, Telegram, Instagram,
Slack, Microsoft Teams, LinkedIn, X, Reddit, TikTok, Snapchat) sont
encapsulées dans des webviews Tauri natives côté client. Le serveur ne
fait plus de bridge : pas de worker bridge, pas d'OAuth backend, pas de
chiffrement de credentials, pas de cache de messages.

Ce dossier ne contient donc plus que le **CRUD de la table
`messaging_provider_sessions`**, qui sert de "déclaration d'usage" :
un user déclare au serveur quel provider il a connecté pour que la
sidebar nexus puisse l'afficher partout (sessions scopées USER, cf.
ADR-028).

## Structure actuelle

```
integrations/
└── core/
    └── session-store.ts        # CRUD sessions provider
```

Modules historiques retirés :
- `bridge-registry.ts` (ADR-027) — plus de provider runtime serveur
- `bridge-rpc.ts` (ADR-027) — plus de RPC worker→backend
- `channel-store.ts` (migration 0010) — plus de table channels
- `event-bus.ts` (ADR-027) — plus de pub/sub bridges
- `encryption.ts` (migration 0011) — plus de credentials côté serveur
- `discord/` (ADR-027) — provider devenu webview pure

## Pour ajouter une 13ᵉ messagerie webview

1. Ajouter le `provider_type` dans l'enum DB (`drizzle-kit generate`).
2. Ajouter le label + brand key + URL d'auth dans `@nexus/web`
   (`SettingsScreen.tsx` `WEBVIEW_PROVIDERS` + `lib/tauri.ts`
   `PROVIDER_WEB_URL` + `BrandIcon`).
3. Ajouter dans `messaging/schemas.ts` au backend
   (`ConnectWebviewBodySchema` enum + `WEBVIEW_PROVIDER_LABELS`).
4. C'est tout. Pas de worker, pas d'OAuth, pas de creds.

Skill `add-webview-provider.md` à venir avec le détail.

## Référence ADR

- ADR-022 : encapsulation webview Tauri (modèle Franz)
- ADR-027 : universalisation webview messaging (12 providers)
- ADR-028 : sessions messageries scopées USER (pas GROUP)
