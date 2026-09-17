import { z } from 'zod';

import { EventDtoSchema } from '../events/schemas.js';
import { ExpenseDtoSchema } from '../expenses/schemas.js';
import { PollDtoSchema } from '../polls/schemas.js';
import { TodoListDtoSchema } from '../todos/schemas.js';

import { GroupDtoSchema, GroupMemberDtoSchema } from './schemas.js';

/**
 * Schéma de l'export JSON d'un groupe (ticket 645f29ca — RGPD + sauvegarde
 * personnelle : la suppression de compte, ADR-033, laissait partir sans
 * pouvoir récupérer ses données au préalable).
 *
 * Compose les DTO déjà publics de chaque domaine plutôt que d'inventer une
 * forme dédiée : le format d'export est exactement ce qu'un membre voit déjà
 * par l'API (mêmes noms de champs, mêmes types), pas une projection
 * supplémentaire à maintenir en parallèle. Documenté (contrat stable) dans
 * `docs/export-format.md`.
 *
 * À DÉPLACER dans `@nexus/shared` une fois les DTO events/polls/expenses/
 * todos/groupes migrés là-bas (chantier en cours en parallèle, ticket
 * 0e8b5905) — `@nexus/shared` ne peut pas dépendre du backend aujourd'hui,
 * d'où cette définition côté backend pour l'instant.
 *
 * `formatVersion` : à incrémenter uniquement pour un changement non
 * rétrocompatible (champ retiré/retypé) — un ajout de champ optionnel ne
 * casse aucun consommateur existant et n'exige pas de bump.
 */
export const GroupExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  exportedBy: z.string().uuid(),
  group: GroupDtoSchema,
  members: z.array(GroupMemberDtoSchema),
  events: z.array(EventDtoSchema),
  polls: z.array(PollDtoSchema),
  expenses: z.array(ExpenseDtoSchema),
  todoLists: z.array(TodoListDtoSchema),
});
export type GroupExport = z.infer<typeof GroupExportSchema>;
