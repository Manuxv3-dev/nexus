-- Lie chaque abonnement push à la session qui l'a créé (cf. ticket abf71bf4).
--
-- Une session est une CHAÎNE de refresh tokens : chaque rotation révoque
-- l'ancien et en émet un nouveau (`replaced_by_id`). Rien n'identifiait la
-- chaîne autrement qu'en la remontant ; `session_id` — l'id du premier token,
-- hérité à chaque rotation — la nomme. C'est ce que porte le JWT d'accès
-- (`sid`) et ce à quoi `push_subscriptions` se lie : un abonnement ne reçoit
-- que tant qu'un token de sa session est vivant, ce qui couvre d'un seul
-- filtre logout, logout-all, changement de mot de passe, réutilisation et
-- expiration.
--
-- Backfill : chaque token existant devient l'identité de sa propre session
-- (`session_id = id`). Pour un token vivant, c'est exact — sa prochaine
-- rotation héritera de cet id. Pour un token déjà révoqué, c'est sans effet.
-- La colonne est ajoutée nullable, remplie, puis verrouillée NOT NULL : un
-- ADD COLUMN NOT NULL sans défaut échouerait sur une table non vide.
--
-- `push_subscriptions.session_id` reste nullable : les abonnements existants
-- n'ont pas de session connue — ils continuent de recevoir (couper le push de
-- tout le monde au déploiement n'est pas une option) et se lient au prochain
-- toggle des Réglages, qui ré-enregistre l'endpoint sous la session courante.
ALTER TABLE "push_subscriptions" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "session_id" uuid;--> statement-breakpoint
UPDATE "refresh_tokens" SET "session_id" = "id" WHERE "session_id" IS NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_session_idx" ON "refresh_tokens" USING btree ("session_id");
