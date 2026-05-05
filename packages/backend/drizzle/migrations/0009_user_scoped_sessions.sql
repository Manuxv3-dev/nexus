-- Polish post-ADR-027 (M1) : sessions messageries scopées USER (pas GROUP).
--
-- Erreur de conception ADR-009 / ADR-022 / ADR-027 : les sessions messageries
-- (WhatsApp, Discord, etc.) étaient liées à un groupe. En réalité, un user a
-- son compte WhatsApp, son Discord, son Slack, etc. INDÉPENDAMMENT des
-- groupes nexus auxquels il appartient. Seules les FEATURES (events, polls,
-- expenses, todos) sont scopées au groupe.
--
-- Migration DESTRUCTIVE (validée par Manu) : on drop toutes les sessions
-- existantes et on reinit avec `user_id` à la place de `group_id`. Les
-- users devront re-déclarer leurs messageries depuis Settings.
--
-- Conséquences en cascade :
--  - `messaging_channels` (FK session_id ON DELETE CASCADE) : table déjà
--    orphan depuis ADR-027, le DELETE FROM messaging_provider_sessions
--    vide aussi cette table — sans impact code (plus utilisée).
--
-- Au passage : drop `display_order` (column orphan créée par migration 0008
-- pour le reorder partagé, finalement remplacé par localStorage per-user
-- dans la session 2026-05-04, cf. P4 backlog).

DELETE FROM "messaging_provider_sessions";--> statement-breakpoint

DROP INDEX "messaging_sessions_group_idx";--> statement-breakpoint
DROP INDEX "messaging_sessions_group_order_idx";--> statement-breakpoint

ALTER TABLE "messaging_provider_sessions" DROP COLUMN "group_id";--> statement-breakpoint
ALTER TABLE "messaging_provider_sessions" DROP COLUMN "display_order";--> statement-breakpoint

ALTER TABLE "messaging_provider_sessions"
  ADD COLUMN "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint

CREATE INDEX "messaging_sessions_user_idx"
  ON "messaging_provider_sessions" ("user_id");
