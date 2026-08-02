import { useEffect, useState } from 'react';

import { OrbitLogo } from '../components/OrbitLogo';
import { useViewport } from '../hooks/useViewport';
import { LX } from '../tokens';

const NAV_LINKS = [
  { href: '#nx-produit', label: 'Produit' },
  { href: '#nx-integrations', label: 'Intégrations' },
  { href: '#nx-faq', label: 'FAQ' },
];

/**
 * Header sticky. Aucune bordure basse (demande explicite du client, cf.
 * README) — le fond `rgba(10,10,15,.72)` + blur n'apparaît qu'après ~40px
 * de scroll, sur un fond transparent avant ça. Le fond sticky déborde toute
 * la largeur du viewport ; le contenu (logo, liens, CTAs) reste contenu
 * dans les 1200px de largeur de conception (cf. `LX.maxWidth`).
 *
 * <768px : nav en menu burger (cf. README §Responsive, non maquetté).
 */
export function Nav({ onLogin, onDownload }: { onLogin: () => void; onDownload: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const tier = useViewport();
  const isMobile = tier === 'mobile';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!isMobile) setMenuOpen(false);
  }, [isMobile]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: scrolled || menuOpen ? 'rgba(10,10,15,.72)' : 'transparent',
        backdropFilter: scrolled || menuOpen ? 'blur(14px)' : 'none',
        WebkitBackdropFilter: scrolled || menuOpen ? 'blur(14px)' : 'none',
        transition: 'background .3s ease, backdrop-filter .3s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: LX.maxWidth,
          margin: '0 auto',
          padding: isMobile ? '18px 20px' : '22px 40px',
        }}
      >
        <a
          href="#"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <OrbitLogo size={30} />
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.055em', color: LX.text }}>
            nexus
          </span>
        </a>

        {!isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 30,
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                style={{ textDecoration: 'none', color: LX.text2, transition: 'color .2s' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = LX.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = LX.text2;
                }}
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {!isMobile && (
            <button
              type="button"
              onClick={onLogin}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 13.5,
                fontWeight: 500,
                color: LX.text2,
                cursor: 'pointer',
                transition: 'color .2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = LX.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = LX.text2;
              }}
            >
              Se connecter
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              padding: '9px 17px',
              borderRadius: 999,
              background: LX.text,
              color: LX.bg,
              border: 'none',
              cursor: 'pointer',
              transition: 'transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1.5px)';
              e.currentTarget.style.boxShadow = '0 8px 22px rgba(255,255,255,.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.boxShadow = '';
            }}
          >
            Télécharger
          </button>
          {isMobile && (
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="nx-mobile-menu"
              aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              onClick={() => setMenuOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 10,
                border: `1px solid ${LX.border}`,
                background: 'rgba(255,255,255,.04)',
                color: LX.text,
                cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                {menuOpen ? (
                  <path
                    d="M3 3l10 10M13 3 3 13"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M2 4h12M2 8h12M2 12h12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>

      {isMobile && menuOpen && (
        <div
          id="nx-mobile-menu"
          style={{
            padding: '4px 20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderTop: `1px solid ${LX.border}`,
          }}
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={closeMenu}
              style={{
                padding: '12px 4px',
                textDecoration: 'none',
                color: LX.text2,
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => {
              closeMenu();
              onLogin();
            }}
            style={{
              padding: '12px 4px',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              color: LX.text2,
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Se connecter
          </button>
        </div>
      )}
    </nav>
  );
}
