/**
 * @nexus/shared
 *
 * Types, schémas Zod, et logique métier portable entre backend et clients.
 *
 * Exports stables — toute modification doit préserver la rétro-compatibilité
 * ou versionner explicitement.
 */
export * from './health.js';
export * from './brand.js';
export * from './ws-protocol.js';
export * from './messaging/index.js';
