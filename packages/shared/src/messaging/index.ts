/**
 * @nexus/shared/messaging
 *
 * Types et schémas partagés pour l'architecture des bridges messageries
 * (cf. ADR-009).
 *
 * Exporte :
 *  - L'interface `MessagingProvider` et ses types associés
 *  - Les events normalisés `BridgeEvent` (worker → backend → WS clients)
 *  - Les commandes de contrôle `BridgeControl` (API HTTP → worker)
 *  - Les helpers de nommage des topics Redis pub/sub
 */
export * from './provider.js';
export * from './events.js';
