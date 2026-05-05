-- ADR-029 : Activity log append-only (Bloc E HomeDashboard).
-- Table de log des actions importantes par groupe, lue par l'endpoint
-- /activity-feed pour alimenter la timeline Home + GroupHome.

CREATE TABLE "activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "actor_id" uuid,
  "kind" text NOT NULL,
  "target_id" uuid,
  "target_type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activity_log_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE,
  CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
-- Index principal : timeline d'un groupe (filter group_id, sort created_at desc).
CREATE INDEX "activity_log_group_created_idx" ON "activity_log" ("group_id", "created_at" DESC);
--> statement-breakpoint
-- BRIN sur created_at pour le scroll cross-groupes (Home Nexus). Beaucoup
-- plus compact qu'un B-tree, suffisant pour les ranges chronologiques.
CREATE INDEX "activity_log_created_brin" ON "activity_log" USING BRIN ("created_at");
