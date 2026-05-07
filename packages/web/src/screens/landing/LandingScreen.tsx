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
import { useEffect, useRef, useState } from 'react';

import { Logo, PhIcon, type PhIconName } from '@/components/ui';
import { NX } from '@/lib/tokens';

/** Durée du fade-out avant redirection (ms). */
const LOGIN_TRANSITION_MS = 280;

/** URL absolue de l'app — la landing est sur l'apex `nexusapp.chat`,
 * le SPA web est servi sur `app.nexusapp.chat` (cf. ADR-030). Donc
 * tous les CTA "Se connecter" doivent pointer vers le sous-domaine app. */
const APP_LOGIN_URL = 'https://app.nexusapp.chat/login';

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

// ─── LandingScreen root ──────────────────────────────────────────────────────

export function LandingScreen() {
  const [leaving, setLeaving] = useState(false);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const downloadsRef = useRef<HTMLDivElement>(null);

  const goToLogin = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      // Redirection cross-domain : landing (nexusapp.chat) → app SPA
      // (app.nexusapp.chat). Pas de navigate router (le router de la
      // landing ne couvre pas /login).
      window.location.href = APP_LOGIN_URL;
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

// ─── Showcase : parcours utilisateur en 5 étapes empilées ────────────────────

interface ShowcaseStep {
  id: string;
  step: string; // "01", "02", ...
  icon: PhIconName;
  color: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  /** Composant mockup à afficher pour cette étape. */
  mockup: () => React.ReactNode;
  /** Si true : mockup à gauche, texte à droite. Sinon inverse. */
  reverse?: boolean;
}

const SHOWCASE_STEPS: ShowcaseStep[] = [
  {
    id: 'connect',
    step: '01',
    icon: 'link',
    color: NX.featChat,
    eyebrow: 'Étape 1 — Connecte',
    title: 'Tes messageries en 30 secondes.',
    description:
      "Discord, WhatsApp, Messenger : un clic, tu te connectes avec ton compte habituel. Pas de bot à configurer, pas de bridge auto-hébergé. nexus utilise l'authentification officielle de chaque plateforme — tes conversations restent les tiennes.",
    bullets: [
      'Discord : OAuth officiel, scopes minimaux',
      'WhatsApp : QR code mobile-tied (comme WhatsApp Web)',
      'Messenger : login Meta sécurisé',
    ],
    mockup: () => <MockupConnect />,
  },
  {
    id: 'unified-chat',
    step: '02',
    icon: 'chatCircle',
    color: NX.featChat,
    eyebrow: 'Étape 2 — Discute',
    title: 'Une seule app pour toutes tes convs.',
    description:
      'Plus de jonglage entre 3 onglets. Tu vois tes serveurs Discord, tes groupes WhatsApp et tes conversations Messenger côte à côte. Tu réponds depuis nexus, le message arrive dans la bonne plateforme — comme par magie.',
    bullets: [
      'Toutes tes messageries dans une seule fenêtre',
      'Notifications unifiées, pas de double-ping',
      'Recherche cross-platform : tu trouves un message en 2 sec',
    ],
    mockup: () => <MockupUnifiedDashboard />,
    reverse: true,
  },
  {
    id: 'organize',
    step: '03',
    icon: 'sparkle',
    color: NX.primaryText,
    eyebrow: 'Étape 3 — Organise',
    title: "L'app détecte les intentions de ta bande.",
    description:
      "« On fait ça samedi ? » → un événement créé en 1 clic. « Pizza ou sushi ? » → un sondage en cours. « Je dois 20 € à Léa » → une dépense ajoutée au Tricount du groupe. nexus comprend ce qui se dit et te suggère l'action — tu valides, c'est fait.",
    bullets: [
      "Détection d'intention via Claude (proposition d'événement, sondage, dépense, todo)",
      'Tu acceptes en 1 clic, jamais imposé',
      'Tout reste dans le contexte de la conversation',
    ],
    mockup: () => <MockupGroupHome />,
  },
  {
    id: 'share',
    step: '04',
    icon: 'paperPlaneRight',
    color: NX.featEvents,
    eyebrow: 'Étape 4 — Partage',
    title: 'Tes amis répondent sans créer de compte.',
    description:
      "Chaque événement, sondage, dépense ou liste a un lien public. Tu colles le lien dans WhatsApp, Discord, Slack — n'importe où. Ceux qui ouvrent le lien voient une page propre, votent ou répondent en 1 clic. Pas de friction, pas d'inscription forcée.",
    bullets: [
      'Lien public propre (cf. nexusapp.chat/e/anniv-lea)',
      'Vote / RSVP / réponse sans compte',
      'Open Graph image dynamique pour le partage',
    ],
    mockup: () => <MockupShareLink />,
    reverse: true,
  },
  {
    id: 'sync',
    step: '05',
    icon: 'desktop',
    color: NX.featPolls,
    eyebrow: 'Étape 5 — Sync',
    title: 'Sur tous tes écrans, tout le temps.',
    description:
      "Desktop pour bosser, mobile dans la rue, web depuis n'importe quel ordi : tes conversations, tes events et tes notifications te suivent partout, en temps réel. Notifications push natives, badges synchronisés, lecture cross-device.",
    bullets: [
      'Desktop natif Tauri (Windows, macOS, Linux)',
      'Mobile natif iOS + Android (bientôt)',
      "Web sur n'importe quel navigateur",
    ],
    mockup: () => <MockupMultiDevice />,
  },
];

function Showcase() {
  return (
    <section
      style={{
        position: 'relative',
        background: NX.bg,
        paddingTop: 'clamp(80px, 12vw, 140px)',
        paddingBottom: 'clamp(40px, 8vw, 80px)',
      }}
    >
      {/* Intro */}
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto clamp(60px, 10vw, 120px)',
          padding: '0 24px',
          textAlign: 'center',
        }}
      >
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
            Comment ça marche
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
            5 étapes, et ta bande
            <br />
            est mieux organisée.
          </h2>
          <p
            style={{
              fontSize: 'clamp(15px, 1.8vw, 18px)',
              color: NX.fgMuted,
              lineHeight: 1.6,
              maxWidth: 560,
              margin: '0 auto',
            }}
          >
            De la première connexion au week-end planifié sans accroc — voici le parcours que chacun
            de tes amis fera en utilisant nexus.
          </p>
        </Reveal>
      </div>

      {/* 5 steps empilés */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(60px, 10vw, 100px)' }}>
        {SHOWCASE_STEPS.map((step, i) => (
          <Step key={step.id} step={step} isLast={i === SHOWCASE_STEPS.length - 1} />
        ))}
      </div>
    </section>
  );
}

function Step({ step, isLast }: { step: ShowcaseStep; isLast: boolean }) {
  return (
    <section
      style={{
        position: 'relative',
        minHeight: '70vh',
        padding: '0 clamp(24px, 5vw, 60px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: step.reverse ? 'auto' : '5%',
          right: step.reverse ? '5%' : 'auto',
          transform: 'translateY(-50%)',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${step.color}1a 0%, ${step.color}05 40%, transparent 70%)`,
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 'clamp(40px, 6vw, 80px)',
          alignItems: 'center',
          width: '100%',
          maxWidth: 1200,
          flexDirection: step.reverse ? 'row-reverse' : 'row',
        }}
      >
        <Reveal>
          <StepText step={step} />
        </Reveal>
        <Reveal delay={0.1}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              order: step.reverse ? -1 : 0,
            }}
          >
            {step.mockup()}
          </div>
        </Reveal>
      </div>

      {/* Connecteur vertical entre steps (sauf dernier) */}
      {!isLast && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: 'clamp(-50px, -5vw, -40px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 2,
            height: 'clamp(40px, 5vw, 60px)',
            background: `linear-gradient(to bottom, ${NX.border}, transparent)`,
          }}
        />
      )}
    </section>
  );
}

function StepText({ step }: { step: ShowcaseStep }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 24,
        }}
      >
        {/* Step number badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            borderRadius: 14,
            background: `${step.color}1f`,
            border: `1px solid ${step.color}33`,
            fontSize: 18,
            fontWeight: 800,
            color: step.color,
            letterSpacing: '-0.02em',
          }}
        >
          {step.step}
        </div>
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: step.color,
              fontWeight: 700,
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <PhIcon name={step.icon} size={14} color={step.color} />
            {step.eyebrow}
          </div>
        </div>
      </div>
      <h3
        style={{
          fontSize: 'clamp(28px, 3.4vw, 40px)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1.15,
          marginBottom: 20,
          color: NX.fg,
        }}
      >
        {step.title}
      </h3>
      <p
        style={{
          fontSize: 'clamp(15px, 1.6vw, 17px)',
          color: NX.fgMuted,
          lineHeight: 1.7,
          marginBottom: 28,
        }}
      >
        {step.description}
      </p>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 0 }}>
        {step.bullets.map((b) => (
          <li
            key={b}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              listStyle: 'none',
              fontSize: 14,
              color: NX.fg,
              lineHeight: 1.55,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: `${step.color}1f`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 2,
              }}
            >
              <PhIcon name="check" size={12} color={step.color} />
            </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Mockups réalistes (frame device + variants par étape/feature) ───────────

/** Frame style "device" — bezel arrondi, ombre prononcée, header macOS. */
function DeviceFrame({
  accent,
  wide,
  children,
}: {
  accent: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: wide ? 'min(560px, 100%)' : 'min(440px, 100%)',
        background: NX.elevated,
        borderRadius: 24,
        border: `1px solid ${NX.glassBorder}`,
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

// ─── Mockups parcours utilisateur (Connect, Unified, GroupHome, Share, Sync) ──

/** Étape 1 : 3 messageries connectées avec status. */
function MockupConnect() {
  const accent = NX.featChat;
  return (
    <DeviceFrame accent={accent}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
          fontSize: 13,
          color: NX.fgMuted,
          fontWeight: 600,
        }}
      >
        <PhIcon name="link" size={14} color={accent} />
        Comptes messagerie connectés
      </div>

      {[
        {
          name: 'Discord',
          status: 'Connecté',
          color: NX.discord,
          handle: '@manu#4242',
          unread: 12,
        },
        {
          name: 'WhatsApp',
          status: 'Connecté',
          color: NX.whatsapp,
          handle: '+33 6 12 34 56 78',
          unread: 3,
        },
        {
          name: 'Messenger',
          status: 'Connecté',
          color: NX.messenger,
          handle: 'manu.auricoste',
          unread: 1,
        },
      ].map((s) => (
        <div
          key={s.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            marginBottom: 10,
            borderRadius: 12,
            background: NX.bg,
            border: `1px solid ${s.color}33`,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `${s.color}1f`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: s.color,
              fontSize: 16,
              fontWeight: 800,
            }}
          >
            {s.name[0]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: NX.fg,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {s.name}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#28c840',
                  display: 'inline-block',
                }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: NX.fgMuted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.handle}
            </div>
          </div>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: NX.radiusPill,
              background: `${s.color}1f`,
              color: s.color,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {s.unread} non lus
          </span>
        </div>
      ))}

      <button
        type="button"
        style={{
          marginTop: 8,
          width: '100%',
          padding: '12px',
          borderRadius: 12,
          background: 'transparent',
          color: accent,
          fontSize: 13,
          fontWeight: 700,
          border: `1.5px dashed ${accent}66`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <PhIcon name="plus" size={14} color={accent} />
        Connecter une autre messagerie
      </button>
    </DeviceFrame>
  );
}

/** Étape 2 : dashboard messageries unifié (sidebar + thread). */
function MockupUnifiedDashboard() {
  const accent = NX.featChat;
  return (
    <DeviceFrame accent={accent} wide>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '52px 1fr',
          gap: 0,
          height: 360,
          marginInline: -20,
          marginBottom: -20,
        }}
      >
        {/* Sidebar messageries */}
        <div
          style={{
            background: NX.glassBg,
            borderRight: `1px solid ${NX.border}`,
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'center',
          }}
        >
          {[
            { letter: 'D', color: NX.discord, active: true },
            { letter: 'W', color: NX.whatsapp, active: false, badge: 3 },
            { letter: 'M', color: NX.messenger, active: false },
          ].map((p) => (
            <div
              key={p.letter}
              style={{
                position: 'relative',
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${p.color}29`,
                color: p.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 800,
                border: p.active ? `2px solid ${p.color}` : '2px solid transparent',
              }}
            >
              {p.letter}
              {p.badge && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: p.color,
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `2px solid ${NX.elevated}`,
                  }}
                >
                  {p.badge}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Thread */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: NX.bg,
          }}
        >
          {/* Header thread */}
          <div
            style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${NX.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Avatar initial="L" color={NX.discord} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: NX.fg }}>#la-bande</div>
              <div style={{ fontSize: 10, color: NX.fgMuted }}>Discord · 7 membres en ligne</div>
            </div>
            <PhIcon name="magnifyingGlass" size={14} color={NX.fgMuted} />
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              fontSize: 12,
            }}
          >
            {[
              { who: 'Léa', color: NX.featEvents, text: 'On fait ça samedi ?', mine: false },
              { who: 'Tom', color: NX.featPolls, text: 'Yep, chez Manu ?', mine: false },
              { who: 'Manu', color: NX.featExpenses, text: "OK 19h, j'amène le vin", mine: true },
              {
                who: 'Léa',
                color: NX.featEvents,
                text: 'Pizza ou sushi pour ce soir ?',
                mine: false,
              },
            ].map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 8,
                  flexDirection: m.mine ? 'row-reverse' : 'row',
                }}
              >
                {!m.mine && <Avatar initial={m.who[0] ?? '?'} color={m.color} size={22} />}
                <div
                  style={{
                    maxWidth: '70%',
                    padding: '7px 11px',
                    borderRadius: 12,
                    background: m.mine ? accent : NX.elevated,
                    color: m.mine ? '#fff' : NX.fg,
                    border: m.mine ? 'none' : `1px solid ${NX.border}`,
                    fontWeight: 500,
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {/* Suggestion IA */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: `${NX.primaryText}14`,
                border: `1px dashed ${NX.primaryText}66`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 11,
              }}
            >
              <PhIcon name="sparkle" size={14} color={NX.primaryText} />
              <span style={{ flex: 1, color: NX.fg, fontWeight: 600 }}>
                Créer un sondage « Pizza ou sushi ? » ?
              </span>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: NX.radiusPill,
                  background: NX.primary,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                Oui
              </span>
            </div>
          </div>

          {/* Composer */}
          <div
            style={{
              padding: '10px 14px',
              borderTop: `1px solid ${NX.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: NX.radiusPill,
                background: NX.elevated,
                border: `1px solid ${NX.border}`,
                color: NX.fgMuted,
                fontSize: 11,
              }}
            >
              Écris à #la-bande…
            </div>
            <PhIcon name="paperPlaneRight" size={16} color={accent} />
          </div>
        </div>
      </div>
    </DeviceFrame>
  );
}

/** Étape 3 : Group Home avec event + poll + expense + todo en grid. */
function MockupGroupHome() {
  const accent = NX.primaryText;
  return (
    <DeviceFrame accent={accent} wide>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
          fontSize: 13,
          color: NX.fg,
          fontWeight: 700,
        }}
      >
        <Avatar initial="B" color={accent} size={26} />
        La bande · 4 membres
        <span style={{ marginLeft: 'auto', fontSize: 11, color: NX.fgMuted }}>Cette semaine</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Mini Event */}
        <div
          style={{
            background: NX.bg,
            border: `1px solid ${NX.featEvents}33`,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: NX.featEvents,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <PhIcon name="calendarBlank" size={11} color={NX.featEvents} />
            Sam. 19h
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: NX.fg, marginBottom: 6 }}>
            Anniv Léa
          </div>
          <div style={{ display: 'flex', gap: -4, marginBottom: 4 }}>
            {['L', 'T', 'M', 'A'].map((a, i) => (
              <span
                key={a}
                style={{
                  marginLeft: i === 0 ? 0 : -6,
                  border: `1.5px solid ${NX.elevated}`,
                  borderRadius: '50%',
                }}
              >
                <Avatar initial={a} color={NX.featEvents} size={20} />
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, color: NX.fgMuted }}>4 oui</div>
        </div>

        {/* Mini Poll */}
        <div
          style={{
            background: NX.bg,
            border: `1px solid ${NX.featPolls}33`,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: NX.featPolls,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <PhIcon name="chartBar" size={11} color={NX.featPolls} />
            Sondage
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: NX.fg, marginBottom: 8 }}>
            Pizza ou sushi ?
          </div>
          {[
            { l: 'Pizza', pct: 71 },
            { l: 'Sushi', pct: 29 },
          ].map((o) => (
            <div key={o.l} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: NX.fg, marginBottom: 2, fontWeight: 600 }}>
                {o.l}
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: NX.border,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${o.pct}%`,
                    height: '100%',
                    background: NX.featPolls,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Mini Expense */}
        <div
          style={{
            background: NX.bg,
            border: `1px solid ${NX.featExpenses}33`,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: NX.featExpenses,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <PhIcon name="currencyDollar" size={11} color={NX.featExpenses} />
            Tu dois
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: NX.featExpenses,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              marginBottom: 6,
            }}
          >
            47,30 €
          </div>
          <div style={{ fontSize: 10, color: NX.fgMuted }}>à Léa et Tom</div>
        </div>

        {/* Mini Todo */}
        <div
          style={{
            background: NX.bg,
            border: `1px solid ${NX.featTodo}33`,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: NX.featTodo,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <PhIcon name="listChecks" size={11} color={NX.featTodo} />
            Qui amène quoi
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: NX.fg, marginBottom: 8 }}>
            2 / 5 fait
          </div>
          <div style={{ height: 4, borderRadius: 2, background: NX.border, overflow: 'hidden' }}>
            <div
              style={{
                width: '40%',
                height: '100%',
                background: NX.featTodo,
              }}
            />
          </div>
        </div>
      </div>

      {/* Suggestion IA en bas */}
      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          borderRadius: 12,
          background: `${accent}14`,
          border: `1px dashed ${accent}66`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11,
        }}
      >
        <PhIcon name="sparkle" size={14} color={accent} />
        <span style={{ flex: 1, color: NX.fg, fontWeight: 600 }}>
          Créer une liste « courses anniv » ?
        </span>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: NX.radiusPill,
            background: accent,
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          Oui
        </span>
      </div>
    </DeviceFrame>
  );
}

/** Étape 4 : page publique RSVP (depuis un lien partagé). */
function MockupShareLink() {
  const accent = NX.featEvents;
  return (
    <DeviceFrame accent={accent}>
      <div
        style={{
          textAlign: 'center',
          padding: '12px 8px 20px',
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: NX.fgMuted,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <PhIcon name="link" size={12} color={NX.fgMuted} />
          nexusapp.chat/e/anniv-lea
        </div>

        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            background: `linear-gradient(135deg, ${accent} 0%, ${NX.primary} 100%)`,
            margin: '0 auto 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 10px 30px ${accent}40`,
          }}
        >
          <PhIcon name="calendarBlank" size={30} color="#fff" />
        </div>

        <div
          style={{
            fontSize: 11,
            color: accent,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: 8,
          }}
        >
          Sam. 15 nov · 19h00
        </div>
        <h4
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: NX.fg,
            margin: '0 0 8px',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}
        >
          Anniv Léa · chez Tom
        </h4>
        <div
          style={{
            fontSize: 12,
            color: NX.fgMuted,
            marginBottom: 4,
          }}
        >
          12 rue des Lilas, 75011 Paris
        </div>
        <div
          style={{
            fontSize: 11,
            color: NX.fgMuted,
            marginBottom: 22,
          }}
        >
          Organisé par <span style={{ color: NX.fg, fontWeight: 600 }}>Tom</span>
        </div>

        {/* Avatars qui ont déjà répondu */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 4,
          }}
        >
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
              <Avatar initial={a.i} color={a.c} size={28} />
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: NX.fgMuted, marginBottom: 22 }}>4 ont déjà dit oui</div>

        {/* Boutons RSVP */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 12,
              background: accent,
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              boxShadow: `0 4px 16px ${accent}40`,
            }}
          >
            J'y serai 🎉
          </button>
          <button
            type="button"
            style={{
              padding: '12px 16px',
              borderRadius: 12,
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
            fontSize: 10,
            color: NX.fgMuted,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <PhIcon name="link" size={10} color={NX.fgMuted} />
          Pas besoin de compte nexus pour répondre
        </div>
      </div>
    </DeviceFrame>
  );
}

/** Étape 5 : 3 devices (desktop, tablet, phone) avec la même conversation. */
function MockupMultiDevice() {
  const accent = NX.featPolls;
  return (
    <div
      style={{
        position: 'relative',
        width: 'min(440px, 100%)',
        height: 360,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Desktop (au fond) */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 0,
          right: 0,
          width: '100%',
          height: 220,
          background: NX.elevated,
          borderRadius: 14,
          border: `1px solid ${NX.border}`,
          boxShadow: `0 30px 60px -20px ${accent}40, 0 6px 20px rgba(0,0,0,0.18)`,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#febc2e' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#28c840' }} />
        </div>
        <div style={{ fontSize: 11, color: NX.fgMuted, fontWeight: 600 }}>nexus · desktop</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {[NX.discord, NX.whatsapp, NX.messenger, accent].map((c, i) => (
            <div
              key={i}
              style={{
                height: 8,
                borderRadius: 4,
                background: `${c}33`,
                width: `${85 - i * 12}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Tablet (au milieu) */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 200,
          height: 240,
          background: NX.elevated,
          borderRadius: 16,
          border: `1px solid ${NX.border}`,
          boxShadow: `0 20px 50px -15px ${accent}50, 0 4px 16px rgba(0,0,0,0.22)`,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <Avatar initial="L" color={NX.featEvents} size={20} />
          <div style={{ fontSize: 10, color: NX.fg, fontWeight: 700 }}>La bande</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {['On fait ça samedi ?', 'Yep, chez Manu', 'Pizza ou sushi ?'].map((m, i) => (
            <div
              key={i}
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: i === 1 ? accent : NX.bg,
                color: i === 1 ? '#fff' : NX.fg,
                fontSize: 9,
                fontWeight: 500,
                alignSelf: i === 1 ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
              }}
            >
              {m}
            </div>
          ))}
        </div>
      </div>

      {/* Phone (devant) */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 12,
          width: 110,
          height: 220,
          background: NX.elevated,
          borderRadius: 18,
          border: `2px solid ${NX.border}`,
          boxShadow: `0 12px 40px -10px ${accent}66, 0 2px 12px rgba(0,0,0,0.28)`,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            width: 30,
            height: 4,
            borderRadius: 2,
            background: NX.border,
            margin: '4px auto',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px',
            borderRadius: 8,
            background: `${accent}1a`,
            border: `1px solid ${accent}33`,
          }}
        >
          <Avatar initial="L" color={accent} size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 8,
                fontWeight: 700,
                color: NX.fg,
                marginBottom: 1,
              }}
            >
              Léa
            </div>
            <div
              style={{
                fontSize: 7,
                color: NX.fgMuted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Pizza ou sushi ?
            </div>
          </div>
        </div>
        {[
          { c: NX.discord, l: 'D' },
          { c: NX.whatsapp, l: 'W' },
          { c: NX.messenger, l: 'M' },
        ].map((p) => (
          <div
            key={p.l}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 6px',
              borderRadius: 6,
              background: NX.bg,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: `${p.c}29`,
                color: p.c,
                fontSize: 8,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {p.l}
            </span>
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: NX.border,
              }}
            />
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
