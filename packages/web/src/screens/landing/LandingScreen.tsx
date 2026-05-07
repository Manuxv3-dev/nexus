/**
 * Landing page nexus — servie par le build `@nexus/landing` sur l'apex
 * `nexusapp.chat` (cf. ADR-014, ADR-030).
 *
 * Structure :
 *   - Nav (sticky top, bouton "Se connecter")
 *   - Hero (catchline enrichie + CTA "Découvrir nexus" qui scroll au showcase)
 *   - Showcase scrollytelling (sticky, 4 features × crossfade mockups)
 *   - CtaFinal (call-to-action sans beta — accès direct)
 *   - Footer minimal
 *
 * Les sections Problem/AppPreview/Features/Comparison/HowItWorks/FAQ/Waitlist
 * de la version précédente ont été fusionnées dans `Showcase` (refonte
 * 2026-05-07). L'idée de beta privée est abandonnée — l'app est ouverte.
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { Logo, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

/** Durée de l'animation de transition landing → /login (ms). */
const LOGIN_TRANSITION_MS = 420;

// ─── Helpers d'animation (IntersectionObserver-based) ────────────────────────

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(28px)',
        transition: `opacity 0.7s ${delay}s cubic-bezier(0.16,1,0.3,1), transform 0.7s ${delay}s cubic-bezier(0.16,1,0.3,1)`,
      }}
    >
      {children}
    </div>
  );
}

// ─── Showcase : tracking du scroll dans une section sticky ───────────────────

/**
 * Hook qui retourne un `progress` (0..1) basé sur la position de scroll
 * dans `containerRef`. À utiliser dans une section `height: N*100vh` qui
 * contient un enfant `position: sticky; top: 0; height: 100vh`.
 *
 * progress = 0 quand l'enfant sticky vient d'être pinned (top du container
 *           atteint le top du viewport)
 * progress = 1 quand l'enfant sticky se détache (bottom du container
 *           atteint le bottom du viewport)
 */
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalScrollable = rect.height - window.innerHeight;
      if (totalScrollable <= 0) {
        setProgress(0);
        return;
      }
      const scrolled = -rect.top;
      const t = Math.max(0, Math.min(1, scrolled / totalScrollable));
      setProgress(t);
    };
    compute();
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, []);
  return { ref, progress };
}

// ─── LandingScreen root ──────────────────────────────────────────────────────

export function LandingScreen() {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const downloadsRef = useRef<HTMLDivElement>(null);

  const goToLogin = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      void navigate({ to: '/login' });
    }, LOGIN_TRANSITION_MS);
  };

  const scrollToShowcase = () => {
    showcaseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToDownloads = () => {
    downloadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      style={{
        background: NX.bg,
        color: NX.fg,
        minHeight: '100vh',
        transform: leaving ? 'translateX(-12%)' : 'translateX(0)',
        opacity: leaving ? 0 : 1,
        transition: `transform ${LOGIN_TRANSITION_MS}ms cubic-bezier(0.16,1,0.3,1), opacity ${LOGIN_TRANSITION_MS}ms ease-out`,
        willChange: 'transform, opacity',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      <Nav onLogin={goToLogin} onDownload={scrollToDownloads} />
      <Hero onPrimary={scrollToShowcase} onSecondary={goToLogin} onDownload={scrollToDownloads} />
      <div ref={showcaseRef}>
        <Showcase />
      </div>
      <CtaFinal onCta={goToLogin} />
      <div ref={downloadsRef}>
        <Downloads />
      </div>
      <Footer onDownload={scrollToDownloads} />
    </div>
  );
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

function Nav({ onLogin, onDownload }: { onLogin: () => void; onDownload: () => void }) {
  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: NX.glassBg,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        borderBottom: `1px solid ${NX.glassBorder}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: 1100,
        }}
      >
        <a
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <Logo size={26} />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.04em', color: NX.fg }}>
            nexus
          </span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={onDownload}
            style={{
              padding: '8px 16px',
              borderRadius: NX.radiusPill,
              background: 'transparent',
              color: NX.fg,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = NX.elevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <PhIcon name="downloadSimple" size={14} color={NX.fg} />
            Télécharger
          </button>
          <button
            type="button"
            onClick={onLogin}
            style={{
              padding: '8px 20px',
              borderRadius: NX.radiusPill,
              background: NX.primary,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              border: 'none',
              cursor: 'pointer',
              boxShadow: NX.shadowGlow,
            }}
          >
            Se connecter
          </button>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero({
  onPrimary,
  onSecondary,
  onDownload,
}: {
  onPrimary: () => void;
  onSecondary: () => void;
  onDownload: () => void;
}) {
  return (
    <section
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '120px 24px 80px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 800,
          height: 800,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(0,122,255,0.12) 0%, rgba(88,86,214,0.05) 40%, transparent 70%)',
          animation: 'pulseGlow 6s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Logo HD + wordmark "nexus" */}
      <div
        style={{
          position: 'relative',
          marginBottom: 48,
          color: NX.fg,
          display: 'flex',
          alignItems: 'center',
          gap: 'clamp(12px, 2vw, 24px)',
          lineHeight: 0,
        }}
      >
        <Logo hd size={220} />
        <span
          style={{
            fontSize: 'clamp(64px, 11vw, 128px)',
            fontWeight: 900,
            letterSpacing: '-0.05em',
            lineHeight: 1,
            color: NX.fg,
          }}
        >
          nexus
        </span>
      </div>

      <Reveal>
        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 52px)',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1.1,
            maxWidth: 'min(95vw, 1080px)',
            marginBottom: 20,
            background: 'linear-gradient(135deg, var(--nx-fg) 0%, var(--nx-feat-chat) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Une app pour discuter, planifier et partager —
          <br />
          sans jongler entre dix outils.
        </h1>
      </Reveal>

      <Reveal delay={0.1}>
        <p
          style={{
            fontSize: 'clamp(16px, 2.2vw, 20px)',
            color: NX.fgMuted,
            maxWidth: 640,
            lineHeight: 1.6,
            marginBottom: 36,
          }}
        >
          Tes conversations Discord, WhatsApp et Messenger réunies — plus des{' '}
          <Pill color={NX.featEvents}>événements</Pill>, <Pill color={NX.featPolls}>sondages</Pill>,{' '}
          <Pill color={NX.featExpenses}>dépenses partagées</Pill> et{' '}
          <Pill color={NX.featTodo}>listes collaboratives</Pill> pour t'organiser avec ta bande.{' '}
          Sans changer les habitudes de personne.
        </p>
      </Reveal>

      <Reveal delay={0.2}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onPrimary}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 32px',
              borderRadius: NX.radiusPill,
              background: NX.primary,
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 0 40px rgba(0,122,255,0.32)',
              border: 'none',
              cursor: 'pointer',
              transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Découvrir nexus
            <PhIcon name="arrowDown" size={18} color="#fff" />
          </button>
          <button
            type="button"
            onClick={onDownload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 32px',
              borderRadius: NX.radiusPill,
              background: NX.glassBg,
              backdropFilter: NX.glassBlurSm,
              WebkitBackdropFilter: NX.glassBlurSm,
              color: NX.fg,
              fontSize: 16,
              fontWeight: 600,
              textDecoration: 'none',
              border: `1px solid ${NX.glassBorder}`,
              cursor: 'pointer',
              transition: 'background 200ms ease, border-color 200ms ease, transform 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = NX.elevated;
              e.currentTarget.style.borderColor = NX.borderHover;
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = NX.glassBg;
              e.currentTarget.style.borderColor = NX.glassBorder;
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <PhIcon name="downloadSimple" size={18} color={NX.fg} />
            Télécharger l'app
          </button>
          <button
            type="button"
            onClick={onSecondary}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '14px 24px',
              borderRadius: NX.radiusPill,
              background: 'transparent',
              color: NX.fgMuted,
              fontSize: 15,
              fontWeight: 500,
              textDecoration: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = NX.fg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = NX.fgMuted;
            }}
          >
            Se connecter
            <PhIcon name="arrowRight" size={16} color="currentColor" />
          </button>
        </div>
      </Reveal>

      <Reveal delay={0.35}>
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {[
            { name: 'Discord', color: NX.discord, bg: 'rgba(114,137,218,0.1)' },
            { name: 'WhatsApp', color: NX.whatsapp, bg: 'rgba(37,211,102,0.08)' },
            { name: 'Messenger', color: NX.messenger, bg: 'rgba(0,132,255,0.08)' },
          ].map((s) => (
            <span
              key={s.name}
              style={{
                padding: '6px 16px',
                borderRadius: NX.radiusPill,
                background: s.bg,
                color: s.color,
                fontSize: 13,
                fontWeight: 600,
                border: `1px solid ${s.color}22`,
              }}
            >
              {s.name}
            </span>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        color,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// ─── Showcase : sticky scroll + crossfade mockups ────────────────────────────

interface ShowcaseFeature {
  id: string;
  icon: PhIconName;
  color: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
}

const SHOWCASE_FEATURES: ShowcaseFeature[] = [
  {
    id: 'events',
    icon: 'calendarBlank',
    color: NX.featEvents,
    eyebrow: 'Événements',
    title: 'Un lien. Un RSVP. Pas un tableau Excel.',
    description:
      "Crée un événement en 10 secondes, partage le lien dans n'importe quelle conversation. Tes amis répondent en un clic — même sans compte nexus.",
    bullets: [
      'Réponses oui / non / peut-être en temps réel',
      'Rappels automatiques J-3 et J-1',
      'Synchro avec ton agenda perso (Google, iCal)',
    ],
  },
  {
    id: 'polls',
    icon: 'chartBar',
    color: NX.featPolls,
    eyebrow: 'Sondages',
    title: 'Pizza ou sushi ? Vote en un tap.',
    description:
      "Plus besoin de scroller 400 messages pour trouver l'option choisie. Un sondage, des options, des résultats live. Voilà.",
    bullets: [
      'Choix unique ou multiples',
      'Anonyme ou nominatif au choix',
      'Clôture automatique à une date',
    ],
  },
  {
    id: 'expenses',
    icon: 'currencyDollar',
    color: NX.featExpenses,
    eyebrow: 'Dépenses partagées',
    title: 'Qui doit combien à qui. Fini les disputes.',
    description:
      "Ajoute une dépense, choisis qui paie, qui doit, et nexus calcule les soldes. Comme un Tricount intégré à ta conv — sans changer d'app.",
    bullets: [
      'Répartition égale, parts ou montants custom',
      'Soldes nets simplifiés (qui rembourse qui)',
      'Marquage payé en un clic',
    ],
  },
  {
    id: 'todos',
    icon: 'listChecks',
    color: NX.featTodo,
    eyebrow: 'Listes & todos',
    title: 'Qui amène quoi. Cochez en équipe.',
    description:
      'Une liste partagée, cochable, assignable. Pour les courses, le déménagement, le week-end à la mer. Tout le monde voit qui a fait quoi en temps réel.',
    bullets: [
      'Assignation à un ou plusieurs membres',
      'Sync temps réel cross-device',
      'Templates récurrents (courses hebdo, etc.)',
    ],
  },
];

function Showcase() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();

  // progress 0..1 → activeFloat 0..N-1 (chaque feature occupe une plage égale)
  const activeFloat = progress * SHOWCASE_FEATURES.length;

  return (
    <section
      ref={ref}
      style={{
        position: 'relative',
        // 4 features × 100vh (la 1re feature reste affichée pendant son segment,
        // crossfade vers la suivante au passage entre segments).
        height: `${SHOWCASE_FEATURES.length * 100}vh`,
        background: NX.bg,
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          padding: '60px clamp(24px, 5vw, 80px)',
          overflow: 'hidden',
        }}
      >
        {/* Halo de fond qui change de couleur selon la feature active */}
        <ShowcaseHalo activeFloat={activeFloat} />

        <div
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'clamp(40px, 6vw, 80px)',
            alignItems: 'center',
            width: '100%',
            maxWidth: 1200,
            margin: '0 auto',
          }}
        >
          {/* Colonne gauche : texte */}
          <div style={{ position: 'relative', minHeight: 360 }}>
            {SHOWCASE_FEATURES.map((feat, i) => {
              const opacity = computeOpacity(activeFloat, i);
              return (
                <ShowcaseText
                  key={feat.id}
                  feature={feat}
                  opacity={opacity}
                  step={i + 1}
                  total={SHOWCASE_FEATURES.length}
                />
              );
            })}
          </div>

          {/* Colonne droite : mockup */}
          <div style={{ position: 'relative', minHeight: 480 }}>
            {SHOWCASE_FEATURES.map((feat, i) => {
              const opacity = computeOpacity(activeFloat, i);
              return (
                <div
                  key={feat.id}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity,
                    transition: 'opacity 0.6s cubic-bezier(0.16,1,0.3,1)',
                    pointerEvents: opacity > 0.5 ? 'auto' : 'none',
                  }}
                >
                  <Mockup featureId={feat.id} accent={feat.color} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Indicateur de progression à droite */}
        <ShowcaseProgress activeFloat={activeFloat} />
      </div>
    </section>
  );
}

function computeOpacity(activeFloat: number, index: number): number {
  // Trapezoidal opacity : pleine opacité quand activeFloat ≈ index, fade
  // sur ±0.5 autour. Hors de cette zone, opacité 0.
  const dist = Math.abs(activeFloat - index);
  if (dist < 0.4) return 1;
  if (dist > 0.7) return 0;
  return 1 - (dist - 0.4) / 0.3;
}

function ShowcaseHalo({ activeFloat }: { activeFloat: number }) {
  const idx = Math.max(0, Math.min(SHOWCASE_FEATURES.length - 1, Math.round(activeFloat)));
  const color = SHOWCASE_FEATURES[idx]?.color ?? NX.featEvents;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: '50%',
        right: '5%',
        transform: 'translateY(-50%)',
        width: 800,
        height: 800,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}1f 0%, ${color}0a 35%, transparent 65%)`,
        filter: 'blur(20px)',
        transition: 'background 0.8s ease',
        pointerEvents: 'none',
      }}
    />
  );
}

function ShowcaseProgress({ activeFloat }: { activeFloat: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 24,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        zIndex: 10,
      }}
      aria-hidden
    >
      {SHOWCASE_FEATURES.map((feat, i) => {
        const isActive = Math.round(activeFloat) === i;
        return (
          <div
            key={feat.id}
            style={{
              width: 4,
              height: isActive ? 32 : 12,
              borderRadius: 4,
              background: isActive ? feat.color : NX.border,
              transition: 'all 0.4s cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        );
      })}
    </div>
  );
}

function ShowcaseText({
  feature,
  opacity,
  step,
  total,
}: {
  feature: ShowcaseFeature;
  opacity: number;
  step: number;
  total: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        transform: `translateY(${(1 - opacity) * 16}px)`,
        transition:
          'opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1)',
        pointerEvents: opacity > 0.5 ? 'auto' : 'none',
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          color: feature.color,
          fontWeight: 700,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <PhIcon name={feature.icon} size={16} color={feature.color} />
        {feature.eyebrow}
        <span style={{ color: NX.fgMuted, fontWeight: 500, marginLeft: 'auto' }}>
          {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>
      <h2
        style={{
          fontSize: 'clamp(28px, 3.6vw, 44px)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1.15,
          marginBottom: 20,
          color: NX.fg,
        }}
      >
        {feature.title}
      </h2>
      <p style={{ fontSize: 17, color: NX.fgMuted, lineHeight: 1.7, marginBottom: 28 }}>
        {feature.description}
      </p>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 0 }}>
        {feature.bullets.map((b) => (
          <li
            key={b}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              listStyle: 'none',
              fontSize: 15,
              color: NX.fg,
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: `${feature.color}1f`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 2,
              }}
            >
              <PhIcon name="check" size={12} color={feature.color} />
            </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Mockups réalistes (par feature) ─────────────────────────────────────────

function Mockup({ featureId, accent }: { featureId: string; accent: string }) {
  return (
    <DeviceFrame accent={accent}>
      {featureId === 'events' && <MockupEvents accent={accent} />}
      {featureId === 'polls' && <MockupPolls accent={accent} />}
      {featureId === 'expenses' && <MockupExpenses accent={accent} />}
      {featureId === 'todos' && <MockupTodos accent={accent} />}
    </DeviceFrame>
  );
}

/** Frame style "device" — bezel arrondi, ombre prononcée, coin avec dot status. */
function DeviceFrame({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 'min(440px, 100%)',
        background: NX.elevated,
        borderRadius: 32,
        border: `1px solid ${NX.border}`,
        boxShadow: `0 30px 80px -20px ${accent}40, 0 10px 30px rgba(0,0,0,0.18)`,
        overflow: 'hidden',
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
      }}
    >
      {/* Header style macOS / Tauri titlebar */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${NX.border}`,
          background: NX.glassBg,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        <span
          style={{
            marginLeft: 12,
            fontSize: 11,
            color: NX.fgMuted,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          nexus · La bande
        </span>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

/** Avatar circulaire avec initiale. */
function Avatar({ initial, color, size = 28 }: { initial: string; color: string; size?: number }) {
  return (
    <span
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `${color}29`,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        textTransform: 'uppercase',
      }}
    >
      {initial}
    </span>
  );
}

function MockupEvents({ accent }: { accent: string }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          fontSize: 13,
          color: NX.fgMuted,
          fontWeight: 600,
        }}
      >
        <PhIcon name="calendarBlank" size={14} color={accent} />
        Événements à venir
      </div>

      <div
        style={{
          background: NX.bg,
          border: `1px solid ${NX.border}`,
          borderRadius: 16,
          padding: 16,
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 4,
            background: accent,
          }}
        />
        <div style={{ paddingLeft: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: accent,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 6,
            }}
          >
            Sam. 15 nov · 19h00
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: NX.fg, marginBottom: 4 }}>
            Anniv Léa · chez Tom
          </div>
          <div style={{ fontSize: 12, color: NX.fgMuted, marginBottom: 14 }}>
            12 rue des Lilas, 75011 Paris
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', marginRight: 4 }}>
              {[
                { i: 'L', c: NX.featEvents },
                { i: 'T', c: NX.featPolls },
                { i: 'M', c: NX.featExpenses },
                { i: 'A', c: NX.featTodo },
              ].map((a, idx) => (
                <span
                  key={a.i}
                  style={{
                    marginLeft: idx === 0 ? 0 : -8,
                    border: `2px solid ${NX.elevated}`,
                    borderRadius: '50%',
                  }}
                >
                  <Avatar initial={a.i} color={a.c} size={26} />
                </span>
              ))}
            </div>
            <span style={{ fontSize: 12, color: NX.fg, fontWeight: 600 }}>4 oui · 1 peut-être</span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="button"
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 10,
            background: accent,
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <PhIcon name="check" size={14} color="#fff" />
          J'y serai
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 10,
            background: NX.bg,
            color: NX.fgMuted,
            fontSize: 13,
            fontWeight: 600,
            border: `1px solid ${NX.border}`,
            cursor: 'pointer',
          }}
        >
          Peut-être
        </button>
      </div>

      <div
        style={{
          marginTop: 16,
          fontSize: 11,
          color: NX.fgMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <PhIcon name="link" size={12} color={NX.fgMuted} />
        nexusapp.chat/e/anniv-lea
      </div>
    </div>
  );
}

function MockupPolls({ accent }: { accent: string }) {
  const options = [
    { label: 'Pizza Lulu', votes: 5, total: 7, voters: ['L', 'T', 'M', 'A', 'C'] },
    { label: 'Sushi Yama', votes: 3, total: 7, voters: ['J', 'S', 'P'] },
    { label: 'Burger King', votes: 1, total: 7, voters: ['Z'] },
  ];
  const max = Math.max(...options.map((o) => o.votes));
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          fontSize: 13,
          color: NX.fgMuted,
          fontWeight: 600,
        }}
      >
        <PhIcon name="chartBar" size={14} color={accent} />
        Vote en cours · 7 / 9 ont voté
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NX.fg, marginBottom: 4 }}>
          On mange où ce soir ?
        </div>
        <div style={{ fontSize: 12, color: NX.fgMuted }}>Clôture à 19h · Léa</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((o, idx) => {
          const isWinner = o.votes === max;
          const widthPct = (o.votes / o.total) * 100;
          return (
            <div
              key={o.label}
              style={{
                position: 'relative',
                background: NX.bg,
                border: `1px solid ${isWinner ? `${accent}66` : NX.border}`,
                borderRadius: 12,
                padding: '12px 14px',
                overflow: 'hidden',
              }}
            >
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${widthPct}%`,
                  background: `${accent}1a`,
                  transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
                }}
              />
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: `2px solid ${isWinner ? accent : NX.border}`,
                      background: isWinner ? accent : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isWinner && <PhIcon name="check" size={10} color="#fff" />}
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: isWinner ? 700 : 500,
                      color: NX.fg,
                    }}
                  >
                    {o.label}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex' }}>
                    {o.voters.slice(0, 3).map((v, i) => (
                      <span
                        key={`${idx}-${v}-${i}`}
                        style={{
                          marginLeft: i === 0 ? 0 : -6,
                          border: `1.5px solid ${NX.bg}`,
                          borderRadius: '50%',
                        }}
                      >
                        <Avatar initial={v} color={accent} size={20} />
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: NX.fg }}>{o.votes}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MockupExpenses({ accent }: { accent: string }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          fontSize: 13,
          color: NX.fgMuted,
          fontWeight: 600,
        }}
      >
        <PhIcon name="currencyDollar" size={14} color={accent} />
        Week-end Bordeaux · soldes
      </div>

      <div
        style={{
          background: `linear-gradient(135deg, ${accent}1f 0%, ${accent}0a 100%)`,
          border: `1px solid ${accent}33`,
          borderRadius: 16,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 12, color: NX.fgMuted, marginBottom: 4, fontWeight: 600 }}>
          Tu dois en tout
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 900,
            color: accent,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          47,30 €
        </div>
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${accent}1f`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {[
            { name: 'Léa', amount: 28.5, count: 2 },
            { name: 'Tom', amount: 18.8, count: 1 },
          ].map((p) => (
            <div
              key={p.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar initial={p.name[0] ?? '?'} color={accent} size={22} />
                <span style={{ color: NX.fg, fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: NX.fgMuted, fontSize: 11 }}>· {p.count} déps</span>
              </div>
              <span style={{ color: NX.fg, fontWeight: 700 }}>{p.amount.toFixed(2)} €</span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          background: NX.bg,
          border: `1px solid ${NX.border}`,
          borderRadius: 12,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: `${accent}1f`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhIcon name="receipt" size={18} color={accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: NX.fg }}>Courses Carrefour</div>
          <div style={{ fontSize: 11, color: NX.fgMuted, marginTop: 2 }}>
            Léa a payé · réparti à 4
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: NX.fg }}>114 €</div>
      </div>
    </div>
  );
}

function MockupTodos({ accent }: { accent: string }) {
  const items = [
    { label: 'Apéro & chips', done: true, who: 'L', whoColor: NX.featEvents },
    { label: 'Salade composée', done: true, who: 'T', whoColor: NX.featPolls },
    { label: 'Plat principal', done: false, who: 'M', whoColor: NX.featExpenses },
    { label: 'Dessert', done: false, who: 'A', whoColor: NX.featTodo },
    { label: 'Boissons (vin, eau)', done: false, who: '?', whoColor: NX.fgMuted },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          fontSize: 13,
          color: NX.fgMuted,
          fontWeight: 600,
        }}
      >
        <PhIcon name="listChecks" size={14} color={accent} />
        Qui amène quoi · samedi
      </div>

      <div
        style={{
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            background: NX.border,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${(doneCount / items.length) * 100}%`,
              height: '100%',
              background: accent,
              borderRadius: 3,
              transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: NX.fg, minWidth: 'max-content' }}>
          {doneCount} / {items.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 12,
              background: NX.bg,
              border: `1px solid ${NX.border}`,
              opacity: it.done ? 0.6 : 1,
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                border: `2px solid ${it.done ? accent : NX.border}`,
                background: it.done ? accent : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {it.done && <PhIcon name="check" size={12} color="#fff" />}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 14,
                color: NX.fg,
                fontWeight: 500,
                textDecoration: it.done ? 'line-through' : 'none',
              }}
            >
              {it.label}
            </span>
            <Avatar initial={it.who} color={it.whoColor} size={22} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CTA Final (sans concept de beta) ────────────────────────────────────────

function CtaFinal({ onCta }: { onCta: () => void }) {
  return (
    <section
      style={{
        padding: 'clamp(80px, 12vw, 140px) 24px',
        display: 'flex',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 700,
          height: 700,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(0,122,255,0.08) 0%, rgba(88,86,214,0.04) 40%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ maxWidth: 720, textAlign: 'center', position: 'relative' }}>
        <Reveal>
          <div
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: NX.primaryText,
              fontWeight: 700,
              marginBottom: 16,
            }}
          >
            Pas de waitlist
          </div>
          <h2
            style={{
              fontSize: 'clamp(32px, 5vw, 56px)',
              fontWeight: 900,
              letterSpacing: '-0.04em',
              lineHeight: 1.1,
              marginBottom: 20,
              background: 'linear-gradient(135deg, var(--nx-fg) 0%, var(--nx-feat-chat) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Pas de file d'attente.
            <br />
            Crée ton compte, c'est tout.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p
            style={{
              fontSize: 'clamp(15px, 1.8vw, 18px)',
              color: NX.fgMuted,
              lineHeight: 1.6,
              marginBottom: 36,
              maxWidth: 540,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            nexus est ouvert. Connecte une messagerie, invite ta bande, organise votre prochain
            week-end. Tout le reste suit naturellement.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <button
            type="button"
            onClick={onCta}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '16px 36px',
              borderRadius: NX.radiusPill,
              background: NX.primary,
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 0 60px rgba(0,122,255,0.36)',
              border: 'none',
              cursor: 'pointer',
              transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Créer mon compte
            <PhIcon name="arrowRight" size={20} color="#fff" />
          </button>
        </Reveal>
        <Reveal delay={0.3}>
          <p
            style={{
              marginTop: 18,
              fontSize: 13,
              color: NX.fgMuted,
            }}
          >
            Gratuit pendant la phase publique · pas de carte bancaire demandée
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Downloads (desktop + mobile) ────────────────────────────────────────────

/**
 * Section téléchargement — 3 cards (Desktop, iOS, Android).
 *
 * URLs : pour V1 ouverte, on pointe vers les GitHub Releases. Quand des
 * builds Tauri seront publiés, ils apparaîtront automatiquement sur la
 * page releases. iOS / Android sont en "bientôt" tant qu'on n'a pas
 * d'app mobile sur les stores.
 */
const RELEASES_URL = 'https://github.com/Manuxv3-dev/nexus/releases/latest';

interface DownloadCard {
  id: string;
  icon: PhIconName;
  platform: string;
  description: string;
  available: boolean;
  href?: string;
  badge?: string;
  variants?: { label: string; sub: string }[];
}

const DOWNLOAD_CARDS: DownloadCard[] = [
  {
    id: 'desktop',
    icon: 'desktop',
    platform: 'Desktop',
    description:
      "Application native légère (Tauri) avec notifications, intégration système et raccourcis clavier. Plus rapide qu'un onglet de navigateur.",
    available: true,
    href: RELEASES_URL,
    variants: [
      { label: 'Windows', sub: '.exe / .msi' },
      { label: 'macOS', sub: '.dmg / Apple Silicon' },
      { label: 'Linux', sub: '.AppImage / .deb' },
    ],
  },
  {
    id: 'ios',
    icon: 'deviceMobile',
    platform: 'iOS',
    description:
      "Application iPhone avec notifications push, support du widget agenda et partage natif depuis n'importe quelle app iOS.",
    available: false,
    badge: 'Bientôt',
  },
  {
    id: 'android',
    icon: 'deviceMobile',
    platform: 'Android',
    description:
      'Application Android avec notifications, partage natif et synchronisation des contacts pour inviter ta bande en deux taps.',
    available: false,
    badge: 'Bientôt',
  },
];

function Downloads() {
  return (
    <section
      style={{
        padding: 'clamp(80px, 12vw, 120px) 24px',
        position: 'relative',
        background: NX.bg,
        borderTop: `1px solid ${NX.border}`,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Reveal>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                color: NX.primaryText,
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              Télécharger
            </div>
            <h2
              style={{
                fontSize: 'clamp(28px, 4.5vw, 48px)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                lineHeight: 1.1,
                marginBottom: 16,
              }}
            >
              Sur tous tes écrans.
            </h2>
            <p
              style={{
                fontSize: 'clamp(15px, 1.8vw, 17px)',
                color: NX.fgMuted,
                lineHeight: 1.6,
                maxWidth: 560,
                margin: '0 auto',
              }}
            >
              nexus tourne en natif sur ton ordi via Tauri (~10 Mo, démarrage instantané), et
              bientôt en natif sur mobile.
            </p>
          </Reveal>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {DOWNLOAD_CARDS.map((card, i) => (
            <Reveal key={card.id} delay={i * 0.08}>
              <DownloadCardView card={card} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.3}>
          <p
            style={{
              marginTop: 40,
              textAlign: 'center',
              fontSize: 13,
              color: NX.fgMuted,
              lineHeight: 1.6,
            }}
          >
            Tu préfères ne rien installer ?{' '}
            <a
              href="/login"
              style={{ color: NX.primaryText, fontWeight: 600, textDecoration: 'none' }}
            >
              Utilise nexus directement dans ton navigateur →
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function DownloadCardView({ card }: { card: DownloadCard }) {
  const accent = card.available ? NX.primaryText : NX.fgMuted;
  const inner = (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: card.available ? NX.featChatBg : `${NX.fgMuted}1a`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhIcon name={card.icon} size={26} color={accent} />
        </div>
        {card.badge && (
          <span
            style={{
              padding: '4px 10px',
              borderRadius: NX.radiusPill,
              background: `${NX.fgMuted}1a`,
              color: NX.fgMuted,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {card.badge}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: NX.fg,
          marginBottom: 8,
        }}
      >
        {card.platform}
      </div>
      <p
        style={{
          fontSize: 14,
          color: NX.fgMuted,
          lineHeight: 1.55,
          marginBottom: 20,
          minHeight: 60,
        }}
      >
        {card.description}
      </p>
      {card.variants && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {card.variants.map((v) => (
            <div
              key={v.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 10,
                background: NX.bg,
                border: `1px solid ${NX.border}`,
                fontSize: 13,
              }}
            >
              <span style={{ color: NX.fg, fontWeight: 600 }}>{v.label}</span>
              <span style={{ color: NX.fgMuted, fontSize: 11 }}>{v.sub}</span>
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 18px',
          borderRadius: NX.radiusPill,
          background: card.available ? NX.primary : 'transparent',
          color: card.available ? '#fff' : NX.fgMuted,
          fontSize: 13,
          fontWeight: 700,
          border: card.available ? 'none' : `1px solid ${NX.border}`,
          width: 'fit-content',
          boxShadow: card.available ? NX.shadowGlow : 'none',
        }}
      >
        {card.available ? (
          <>
            <PhIcon name="downloadSimple" size={14} color="#fff" />
            Télécharger
          </>
        ) : (
          <>
            <PhIcon name="bell" size={14} color={NX.fgMuted} />
            Me prévenir
          </>
        )}
      </div>
    </>
  );

  const cardStyle: React.CSSProperties = {
    display: 'block',
    textDecoration: 'none',
    padding: 28,
    borderRadius: 20,
    background: NX.glassBgStrong,
    backdropFilter: NX.glassBlurSm,
    WebkitBackdropFilter: NX.glassBlurSm,
    border: `1px solid ${NX.glassBorder}`,
    boxShadow: NX.shadowSm,
    transition:
      'transform 250ms cubic-bezier(0.16,1,0.3,1), box-shadow 250ms ease, border-color 250ms ease',
    color: NX.fg,
    cursor: card.available ? 'pointer' : 'default',
    opacity: card.available ? 1 : 0.85,
  };

  if (card.available && card.href) {
    return (
      <a
        href={card.href}
        target="_blank"
        rel="noopener noreferrer"
        style={cardStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.boxShadow = NX.shadowLg;
          e.currentTarget.style.borderColor = NX.borderStrong;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = NX.shadowSm;
          e.currentTarget.style.borderColor = NX.glassBorder;
        }}
      >
        {inner}
      </a>
    );
  }
  return <div style={cardStyle}>{inner}</div>;
}

// ─── Footer minimal (sans beta) ──────────────────────────────────────────────

function Footer({ onDownload }: { onDownload: () => void }) {
  return (
    <footer
      style={{
        padding: '40px 24px 60px',
        borderTop: `1px solid ${NX.border}`,
        background: NX.bg,
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 24,
          }}
        >
          <div style={{ maxWidth: 360 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Logo size={24} />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  color: NX.fg,
                }}
              >
                nexus
              </span>
            </div>
            <p style={{ fontSize: 13, color: NX.fgMuted, lineHeight: 1.6, margin: 0 }}>
              L'app qui réunit tes messageries et l'organisation de ta bande. Conçue avec amour
              quelque part en France.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
            <FooterColumn
              title="Produit"
              items={[
                { label: 'Se connecter', href: '/login' },
                { label: 'Créer un compte', href: '/login' },
                { label: 'Télécharger', onClick: onDownload },
              ]}
            />
            <FooterColumn
              title="Liens"
              items={[
                { label: 'GitHub', href: 'https://github.com/Manuxv3-dev/nexus' },
                { label: 'Releases', href: RELEASES_URL },
                { label: 'API status', href: 'https://api.nexusapp.chat/api/v1/health' },
              ]}
            />
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            paddingTop: 24,
            borderTop: `1px solid ${NX.border}`,
            fontSize: 12,
            color: NX.fgMuted,
          }}
        >
          <span>© {new Date().getFullYear()} nexus · tous droits réservés</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PhIcon name="heart" size={12} color={NX.fgMuted} />
            Fait pour les bandes d'amis
          </span>
        </div>
      </div>
    </footer>
  );
}

interface FooterItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  const linkStyle: React.CSSProperties = {
    fontSize: 14,
    color: NX.fg,
    textDecoration: 'none',
    fontWeight: 500,
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'color 200ms ease',
  };
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: NX.fgMuted,
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 0 }}>
        {items.map((item) => (
          <li key={item.label} style={{ listStyle: 'none' }}>
            {item.href ? (
              <a
                href={item.href}
                style={linkStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = NX.primaryText;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = NX.fg;
                }}
              >
                {item.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={item.onClick}
                style={linkStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = NX.primaryText;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = NX.fg;
                }}
              >
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
