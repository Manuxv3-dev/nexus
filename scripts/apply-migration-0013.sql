-- Application manuelle de la migration 0013 (cf. ADR-029 Activity Log).
--
-- À exécuter une seule fois quand drizzle-kit migrate ne reconnaît pas le
-- fichier 0013 (cas où la migration a été ajoutée à la main sans passer par
-- drizzle-kit generate). Idempotent grâce aux IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "activity_log" (
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

CREATE INDEX IF NOT EXISTS "activity_log_group_created_idx"
  ON "activity_log" ("group_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "activity_log_created_brin"
  ON "activity_log" USING BRIN ("created_at");

-- Marque cette migration comme appliquée dans le tracking drizzle pour que
-- `drizzle-kit migrate` ne tente pas de la rejouer. Le hash est arbitraire
-- (drizzle ne le valide pas — il sert juste de clé d'unicité).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('0013_add_activity_log_manual', extract(epoch from now()) * 1000)
ON CONFLICT DO NOTHING;
