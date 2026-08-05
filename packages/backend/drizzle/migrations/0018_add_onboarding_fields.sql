-- Tutoriel de découverte au premier login (cf. MAN-217 Phase 1 / MAN-220).
--
-- DÉCISION comptes existants : les deux colonnes sont NULL par défaut pour
-- toute nouvelle ligne, ce qui — selon le modèle d'état côté API
-- (both NULL => tuto à déclencher) — rendrait tous les comptes déjà en base
-- éligibles au tuto à leur prochaine connexion. Ce n'est pas le comportement
-- voulu : la feature cible les *nouveaux* comptes, pas Manu ni les testeurs
-- qui utilisent déjà l'app depuis des semaines. On backfille donc
-- `onboarding_completed_at = now()` sur les lignes préexistantes juste après
-- l'ajout des colonnes, pour que seuls les comptes créés après cette
-- migration voient le tuto.
ALTER TABLE "users" ADD COLUMN "onboarding_step" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "users" SET "onboarding_completed_at" = now() WHERE "onboarding_completed_at" IS NULL;
