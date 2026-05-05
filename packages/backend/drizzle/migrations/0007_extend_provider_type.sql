-- ADR-027 : universalisation webview messaging.
-- Etendre l enum provider_type avec 9 nouvelles valeurs (Telegram, Instagram,
-- Slack, Teams, LinkedIn, X/Twitter, Reddit, TikTok, Snapchat).
-- Discord/WhatsApp/Messenger restent inchanges.
--
-- ALTER TYPE ADD VALUE est non-transactional cote Postgres : chaque ALTER doit
-- etre dans son propre statement (cf. doc Postgres). Les marqueurs de
-- separation drizzle-kit suivent chaque statement.

ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'telegram';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'instagram';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'slack';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'teams';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'linkedin';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'twitter';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'reddit';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'tiktok';--> statement-breakpoint
ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'snapchat';
