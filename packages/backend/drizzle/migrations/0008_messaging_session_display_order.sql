-- Polish post-ADR-027 (P4) : reorder drag and drop des sessions messageries
-- dans la sidebar AppShell.
--
-- Ajoute une colonne display_order (smallint) qui pilote l'ordre d'affichage
-- des sessions par groupe. Default 0 pour ne pas casser les sessions
-- existantes (elles garderont l'ordre par createdAt comme avant).
--
-- L'index composite (group_id, display_order) permet de trier efficacement
-- cote serveur sans full scan.

ALTER TABLE "messaging_provider_sessions"
  ADD COLUMN "display_order" smallint NOT NULL DEFAULT 0;

CREATE INDEX "messaging_sessions_group_order_idx"
  ON "messaging_provider_sessions" ("group_id", "display_order");
