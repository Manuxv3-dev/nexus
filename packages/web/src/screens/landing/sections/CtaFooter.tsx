import { MagneticButton } from '../components/MagneticButton';
import { OrbitLogo } from '../components/OrbitLogo';
import { Reveal } from '../components/Reveal';
import { useViewport } from '../hooks/useViewport';
import { LX } from '../tokens';

const APP_WEB_URL = 'https://app.nexusapp.chat';

/** Desktop distribué via GitHub Releases + auto-updater (ADR-031, tauri.conf.json). */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/Manuxv3-dev/nexus/releases/latest';

const FOOTER_COLUMNS = [
  {
    title: 'PRODUIT',
    links: [
      { label: 'Fonctionnalités', href: '#nx-produit' },
      { label: 'Intégrations', href: '#nx-integrations' },
    ],
  },
  {
    title: 'RESSOURCES',
    links: [
      { label: 'FAQ', href: '#nx-faq' },
      { label: 'Blog', href: undefined },
      { label: 'Statut', href: undefined },
    ],
  },
  {
    title: 'LÉGAL',
    links: [
      { label: 'Confidentialité', href: undefined },
      { label: 'Conditions', href: undefined },
      { label: 'Cookies', href: undefined },
    ],
  },
];

/**
 * CTA final (ancre `#nx-download`, cible des CTA "Télécharger" du header et
 * du hero) + footer. Cf. README §7-8. Le CTA primaire est un lien direct
 * vers `DESKTOP_DOWNLOAD_URL` — pas un scroll (MAN-99 : il ne peut pas
 * pointer vers son propre ancre sans être un clic sans effet).
 */
export function CtaFooter() {
  const tier = useViewport();
  const isMobile = tier === 'mobile';

  return (
    <>
      <section
        id="nx-download"
        style={{
          position: 'relative',
          marginTop: isMobile ? 72 : 120,
          padding: isMobile ? '72px 20px 56px' : '110px 44px 88px',
          overflow: 'hidden',
          background:
            'linear-gradient(180deg, transparent, rgba(255,255,255,.03) 45%, transparent)',
          scrollMarginTop: 24,
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -180,
            width: 1000,
            height: 640,
            transform: 'translateX(-50%)',
            background:
              'radial-gradient(ellipse at center, rgba(88,86,214,.26), rgba(0,122,255,.09) 46%, transparent 70%)',
            filter: 'blur(24px)',
            maskImage: 'linear-gradient(180deg, #000 58%, transparent)',
            WebkitMaskImage: 'linear-gradient(180deg, #000 58%, transparent)',
          }}
        />

        <Reveal>
          <div
            style={{
              position: 'relative',
              maxWidth: LX.maxWidth,
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <OrbitLogo size={52} durationS={22} />
            <h2
              style={{
                margin: '26px 0 0',
                maxWidth: 620,
                fontSize: isMobile ? 36 : 60,
                lineHeight: 1.04,
                fontWeight: 800,
                letterSpacing: '-.05em',
                textWrap: 'balance',
                color: LX.text,
              }}
            >
              Vos amis vous attendent quelque part.
            </h2>
            <p
              style={{
                margin: '20px 0 0',
                maxWidth: 460,
                fontSize: 17,
                lineHeight: 1.55,
                color: LX.text3,
              }}
            >
              Installe Nexus, branche tes messageries, et retrouve tout le monde au même endroit.
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: 'center',
                gap: 12,
                marginTop: 32,
                width: isMobile ? '100%' : undefined,
              }}
            >
              <MagneticButton
                href={DESKTOP_DOWNLOAD_URL}
                style={{
                  padding: '16px 30px',
                  fontSize: 15.5,
                  width: isMobile ? '100%' : undefined,
                  justifyContent: 'center',
                }}
              >
                Télécharger l&apos;app
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M8 2v9m0 0 3.5-3.5M8 11 4.5 7.5M2.5 13.5h11"
                    stroke={LX.bg}
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </MagneticButton>
              <a
                href={APP_WEB_URL}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px 26px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,.15)',
                  fontSize: 15.5,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,.85)',
                  textDecoration: 'none',
                  width: isMobile ? '100%' : undefined,
                  transition: 'background .2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,.07)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Ouvrir la version web
              </a>
            </div>
            <div
              style={{
                marginTop: 18,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: '.06em',
                color: LX.text4,
              }}
            >
              GRATUIT · SANS PUB · SANS CARTE BANCAIRE
            </div>
          </div>
        </Reveal>
      </section>

      <div
        style={{
          position: 'relative',
          height: 1,
          margin: isMobile ? '0 20px' : '0 44px',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.1), transparent)',
        }}
      />

      <div style={{ maxWidth: LX.maxWidth, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr 1fr' : '1.4fr 1fr 1fr 1fr',
            gap: isMobile ? 28 : 40,
            padding: isMobile ? '32px 20px 28px' : '44px 44px 36px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <OrbitLogo size={24} spin={false} />
              <span
                style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.055em', color: LX.text }}
              >
                nexus
              </span>
            </div>
            <p
              style={{
                margin: '14px 0 0',
                maxWidth: 250,
                fontSize: 13,
                lineHeight: 1.6,
                color: 'rgba(255,255,255,.38)',
              }}
            >
              Tes amis sont partout. Vos plans, ici.
            </p>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '.11em',
                  color: LX.text4,
                }}
              >
                {col.title}
              </div>
              {col.links.map((link) =>
                link.href ? (
                  <a
                    key={link.label}
                    href={link.href}
                    style={{
                      textDecoration: 'none',
                      fontSize: 13.5,
                      color: LX.text2,
                      transition: 'color .2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = LX.text;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = LX.text2;
                    }}
                  >
                    {link.label}
                  </a>
                ) : (
                  <span key={link.label} style={{ fontSize: 13.5, color: LX.text2 }}>
                    {link.label}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? 8 : 0,
            padding: isMobile ? '14px 20px 24px' : '18px 44px 26px',
            fontSize: 12,
            color: LX.text5,
          }}
        >
          <span>© 2026 Nexus. Fait en France.</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '.06em' }}>
            TOUS TES MESSAGES, AU MÊME ENDROIT
          </span>
        </div>
      </div>
    </>
  );
}
