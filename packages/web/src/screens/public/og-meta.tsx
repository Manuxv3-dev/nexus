/**
 * Composant <OgMeta /> — injecte les balises Open Graph + Twitter Card
 * dans <head> via react-helmet-async (cf. ADR-018).
 *
 * Usage :
 *   <OgMeta
 *     type="event"
 *     slug="abc123"
 *     title="Soirée chez Léa"
 *     description="Samedi 20h, 42 rue de la Roquette"
 *   />
 *
 * Limite connue (cf. backlog J9 — SSR meta-tag injection) :
 *   les crawlers no-JS (Slack, Twitter, certains anciens bots) ne voient pas
 *   ces balises injectées côté client. Discord, WhatsApp, iMessage et
 *   navigateurs directs les voient correctement.
 */
import { Helmet } from 'react-helmet-async';

export type OgType = 'event' | 'poll' | 'expense' | 'todo' | 'list';

export interface OgMetaProps {
  type: OgType;
  slug: string;
  title: string;
  description?: string;
}

/**
 * Renvoie l'URL absolue de l'image OG. En navigateur, `window.location.origin`
 * pointe :
 *  - en dev : http://localhost:5173 (proxy Vite vers backend:3000)
 *  - en prod : https://app.nexusapp.chat (Caddy → backend)
 */
function ogImageUrl(type: OgType, slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.nexusapp.chat';
  return `${origin}/api/v1/public/og/${type}/${slug}.png`;
}

function pageUrl(type: OgType, slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.nexusapp.chat';
  const prefix: Record<OgType, string> = {
    event: '/e/',
    poll: '/p/',
    expense: '/d/',
    todo: '/t/',
    list: '/l/',
  };
  return `${origin}${prefix[type]}${slug}`;
}

export function OgMeta({ type, slug, title, description }: OgMetaProps) {
  const fullTitle = `${title} · Nexus`;
  const desc = description ?? '';
  const image = ogImageUrl(type, slug);
  const url = pageUrl(type, slug);

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={desc} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Nexus" />
      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={image} />
      {/* Theme */}
      <meta name="theme-color" content="#0B0F1A" />
    </Helmet>
  );
}
