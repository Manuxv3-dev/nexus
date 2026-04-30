# Skill — Intégrer une nouvelle messagerie

**Quand utiliser ce skill** : à chaque ajout d'une plateforme de messagerie
(Discord, Messenger, WhatsApp, et toute future plateforme).

## Préalable

Avant de coder une intégration, il **faut un ADR** validé pour cette plateforme
(cf. ADR-006 Discord, ADR-007 Messenger, ADR-008 WhatsApp). Si la plateforme
n'a pas d'ADR, on commence par ça.

## Architecture cible : provider modulaire

Chaque messagerie implémente l'interface `MessagingProvider` (définie dans
`@nexus/shared`) :

```ts
// packages/shared/src/messaging/provider.ts
export interface MessagingProvider {
  readonly name: 'discord' | 'messenger' | 'whatsapp' | string;

  /** Démarre la connexion (gateway, polling, ou autre) pour un groupe */
  connect(config: ProviderConfig): Promise<ProviderSession>;

  /** Arrête proprement et libère les ressources */
  disconnect(session: ProviderSession): Promise<void>;

  /** Récupère un historique paginé */
  fetchHistory(
    session: ProviderSession,
    channelId: string,
    cursor?: string
  ): Promise<HistoryPage>;

  /** Envoie un message texte (et optionnellement attachments) */
  sendMessage(
    session: ProviderSession,
    channelId: string,
    body: SendMessageBody
  ): Promise<{ externalId: string }>;

  /** Souscription temps réel : appelle le callback à chaque event */
  subscribe(
    session: ProviderSession,
    onEvent: (e: ProviderEvent) => void
  ): () => void;

  /** Liste des membres / contacts accessibles */
  getMembers(session: ProviderSession): Promise<ProviderMember[]>;
}
```

`ProviderEvent` est un union typé : `message:new`, `message:edit`,
`message:delete`, `presence:update`, `typing:*`. C'est la forme **interne
normalisée**, distincte du format propriétaire de chaque plateforme.

## Procédure d'intégration

1. **Créer un dossier dédié** : `packages/backend/src/integrations/<provider>/`
   - `provider.ts` — implémentation de l'interface
   - `mapper.ts` — mappings entre format propriétaire et `ProviderEvent` normalisé
   - `worker.ts` — worker BullMQ qui maintient les connexions et ingère les events
   - `routes.ts` — endpoints OAuth / setup (`/api/v1/integrations/<provider>/...`)
   - `__tests__/` — tests unitaires sur les mappers + tests d'intégration mockés
2. **Stocker les credentials chiffrés** dans `messaging_provider_configs`
   (clé AES-GCM en env, jamais commit).
3. **Mapper sur le modèle interne** : pour chaque event reçu, normaliser et
   pousser via `wsBus.publish` (cf. skill `add-websocket-event.md`).
4. **Gestion des erreurs et reconnexion** :
   - Backoff exponentiel sur déconnexion gateway
   - Métriques basiques (uptime worker, lag de sync)
   - Alerte (log `error` + ouverture issue manuelle pour MVP) si déconnexion > 5 min
5. **Sync historique** : worker dédié, paginé, idempotent (clé d'idempotence =
   `external_message_id`). Stockage dans `messages` avec `provider`, `external_id`,
   `groupId`, `channelExternalId`.
6. **Documentation** : mettre à jour le `README` du package backend avec les
   variables d'env requises et la procédure de setup.

## Considérations transverses

- **RGPD** : afficher à l'utilisateur ce qui est synchronisé, permettre la
  suppression. Politique de purge par défaut documentée.
- **ToS** : si l'intégration est en zone grise (cf. ADR-008 WhatsApp), afficher
  un consentement explicite.
- **Quotas** : respecter les rate limits de la plateforme (helpers `Bottleneck`
  ou intégrés à la lib SDK).

## Checklist avant merge

- [ ] ADR validé (Accepté) pour la plateforme
- [ ] Implémentation conforme à `MessagingProvider`
- [ ] Mappers couverts par tests unitaires (input → output normalisé)
- [ ] Test d'intégration "send-receive round trip" sur un compte de test
- [ ] Stockage des credentials chiffré
- [ ] Worker BullMQ avec gestion d'erreurs et reconnexion
- [ ] Endpoint OAuth / QR-code testé manuellement
- [ ] Variables d'env documentées
- [ ] Politique de purge implémentée (job BullMQ scheduled)

## Anti-patterns à éviter

- ❌ Coupler le code métier à la lib propriétaire (toujours passer par
  l'interface `MessagingProvider` côté coordination)
- ❌ Stocker les tokens en clair en DB
- ❌ Maintenir une connexion gateway dans le process Fastify principal (toujours
  dans un worker dédié, sinon le restart Fastify déconnecte les utilisateurs)
- ❌ Re-télécharger l'historique à chaque restart (utiliser le cursor stocké)
- ❌ Diffuser des events avant validation Zod du payload normalisé
