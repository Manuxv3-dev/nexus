/**
 * Helper de "branded types" pour distinguer au compile-time des chaînes
 * sémantiquement différentes (UserId vs GroupId vs MessageId, etc.).
 *
 * Usage :
 *   type UserId = Brand<string, 'UserId'>;
 *   const id = '...' as UserId;
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Identifiants forts utilisés dans tout Nexus.
 * Les UUID v4 sont stockés en string côté JS/TS.
 */
export type UserId = Brand<string, 'UserId'>;
export type GroupId = Brand<string, 'GroupId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type EventId = Brand<string, 'EventId'>;
export type PollId = Brand<string, 'PollId'>;
export type ExpenseId = Brand<string, 'ExpenseId'>;
export type TodoId = Brand<string, 'TodoId'>;
