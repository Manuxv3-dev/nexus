-- Suite de 0020 (liaison push ↔ session, cf. abf71bf4), sortie de sa revue de
-- code après merge.
--
-- 1. DEFAULT sur `refresh_tokens.session_id` — pour la fenêtre de déploiement
--    (ADR-013, expand/contract). `deploy.sh` migre PENDANT que l'image
--    précédente sert encore, et y revient si la nouvelle échoue son
--    healthcheck. Une image qui ignore la colonne insère sans `session_id` :
--    sans défaut, chaque login, register et refresh violerait le NOT NULL — et
--    le rollback censé sauver la prod tuerait l'auth pour de bon. 0020 avait
--    ce trou ; son déploiement s'est bien passé, mais un rollback vers l'image
--    d'avant 0020 reste possible tant que celle-ci est « l'image précédente ».
--    L'application pose toujours la valeur ; le défaut ne sert qu'à l'ancienne
--    image, dont un login reçoit alors une session neuve — ce qui est juste.
--    `SET DEFAULT` est une opération de catalogue, sans réécriture.
--
-- 2. Index PARTIEL (tokens vivants) à la place de l'index plein de 0020 : une
--    session ouverte 30 jours accumule ~2 900 lignes révoquées par rotation,
--    jamais purgées ; le filtre à l'envoi du push (`sessionAlive`) et le
--    retrait des sessions mortes ne doivent lire que la vivante.
DROP INDEX IF EXISTS "refresh_tokens_session_idx";--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_session_live_idx" ON "refresh_tokens" USING btree ("session_id") WHERE revoked_at IS NULL;
