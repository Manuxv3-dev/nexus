-- Trimmée à la main : `drizzle-kit generate` réinclut ici les CREATE TABLE de
-- activity_log/user_notif_prefs (déjà créées par 0013/0014), faute des
-- fichiers 0013_snapshot.json/0014_snapshot.json manquants dans
-- drizzle/migrations/meta/ — drizzle-kit perd le fil après 0012_snapshot.json
-- et croit ces deux tables absentes. Suivi : tâche flaggée en session (cf.
-- commentaire MAN-21) pour régénérer ces snapshots ; en attendant, ne PAS
-- copier-coller ces CREATE TABLE si `db:generate` les réintroduit à nouveau.
CREATE TABLE IF NOT EXISTS "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_email_lower_idx" ON "waitlist" USING btree (lower("email"));
