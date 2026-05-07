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
    title: 'Tes 12 messageries en 30 secondes.',
    description:
      'Discord, WhatsApp, Messenger, Microsoft Teams, Instagram, Snapchat, TikTok, Reddit, X, LinkedIn, Slack, Telegram. Un clic, tu te connectes avec ton compte habituel — auth officielle de chaque service, pas de bot à configurer ni de bridge auto-hébergé. Tes conversations restent les tiennes.',
    bullets: [
      '12 services supportés en V1, plus à venir',
      'Auth officielle (OAuth, QR code, login natif)',
      'Plusieurs comptes du même service possibles',
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
      'Plus de jonglage entre dix onglets. Le groupe « Les potes » organise un padel sur Messenger pendant que la famille planifie les vacances sur WhatsApp ? Tu vois tout côte à côte. Tu réponds depuis nexus, le message arrive dans la bonne plateforme — comme par magie.',
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
    title: "L'app détecte les intentions de ton groupe.",
    description:
      "Que ce soit la bande de potes qui hésite sur le resto ou la famille qui planifie les vacances en Bretagne : nexus repère les intentions dans tes messages et propose la bonne action. « On fait ça samedi ? » → un événement. « Pizza ou sushi ? » → un sondage. « Je dois 127 € à Maman » → une dépense. Tu valides en 1 clic, c'est fait.",
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

/**
 * Catalogue des providers messageries supportés par nexus.
 * Couleurs alignées avec les marques officielles. Les "logos" affichés
 * sont des représentations génériques (carré arrondi + initiale) qui
 * identifient le service sans reproduire les logos déposés.
 */
const PROVIDERS_LIST: {
  id: string;
  name: string;
  initial: string;
  color: string;
  textColor: string;
  gradient?: string;
}[] = [
  { id: 'messenger', name: 'Messenger', initial: 'M', color: '#0084FF', textColor: '#fff' },
  { id: 'whatsapp', name: 'WhatsApp', initial: 'W', color: '#25D366', textColor: '#fff' },
  { id: 'discord', name: 'Discord', initial: 'D', color: '#5865F2', textColor: '#fff' },
  { id: 'teams', name: 'Microsoft Teams', initial: 'T', color: '#6264A7', textColor: '#fff' },
  {
    id: 'instagram',
    name: 'Instagram',
    initial: 'I',
    color: '#E4405F',
    textColor: '#fff',
    gradient:
      'linear-gradient(135deg, #FEDA75 0%, #FA7E1E 25%, #D62976 55%, #962FBF 75%, #4F5BD5 100%)',
  },
  { id: 'snapchat', name: 'Snapchat', initial: 'S', color: '#FFFC00', textColor: '#000' },
  { id: 'tiktok', name: 'TikTok', initial: 'T', color: '#111', textColor: '#fff' },
  { id: 'reddit', name: 'Reddit', initial: 'R', color: '#FF4500', textColor: '#fff' },
  { id: 'x', name: 'X', initial: 'X', color: '#000', textColor: '#fff' },
  { id: 'linkedin', name: 'LinkedIn', initial: 'in', color: '#0A66C2', textColor: '#fff' },
  { id: 'slack', name: 'Slack', initial: 'S', color: '#4A154B', textColor: '#fff' },
  { id: 'telegram', name: 'Telegram', initial: 'T', color: '#229ED9', textColor: '#fff' },
];

type Provider = (typeof PROVIDERS_LIST)[number];

/** Carré arrondi coloré + initiale, taille paramétrable. */
function ProviderIcon({ provider, size = 24 }: { provider: Provider; size?: number }) {
  return (
    <span
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: size <= 20 ? 5 : size <= 32 ? 7 : 9,
        background: provider.gradient ?? provider.color,
        color: provider.textColor,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: provider.initial.length > 1 ? size * 0.42 : size * 0.5,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        lineHeight: 1,
      }}
    >
      {provider.initial}
    </span>
  );
}

/** Étape 1 — sidebar de l'app avec groupe "Les potes" + les 12 messageries listées. */
function MockupConnect() {
  const accent = NX.featChat;
  return (
    <DeviceFrame accent={accent} wide>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 230px 1fr',
          height: 460,
          marginInline: -20,
          marginBottom: -20,
          background: NX.bg,
        }}
      >
        {/* Rail gauche : logo nexus + avatar groupe + bouton "+" */}
        <div
          style={{
            background: NX.elevated,
            borderRight: `1px solid ${NX.border}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0',
            gap: 14,
          }}
        >
          <Logo size={26} />
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: '#3399ff',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 800,
              border: `2px solid ${accent}`,
            }}
          >
            LP
          </div>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: `1.5px dashed ${NX.borderStrong}`,
              color: NX.fgMuted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name="plus" size={14} color={NX.fgMuted} />
          </div>
          <div style={{ flex: 1 }} />
          <Avatar initial="M" color={accent} size={28} />
        </div>

        {/* Blade : groupe Les potes + features + providers */}
        <div
          style={{
            background: NX.elevated,
            borderRight: `1px solid ${NX.border}`,
            padding: '14px 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: NX.fg,
                letterSpacing: '-0.02em',
              }}
            >
              Les potes
            </div>
            <div style={{ fontSize: 10, color: NX.fgMuted, marginTop: 2 }}>4 membres</div>
          </div>

          {/* Features pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {[
              { icon: 'calendarBlank' as const, c: NX.featEvents, active: true },
              { icon: 'chartBar' as const, c: NX.featPolls, active: false },
              { icon: 'currencyDollar' as const, c: NX.featExpenses, active: false },
              { icon: 'listChecks' as const, c: NX.featTodo, active: false },
            ].map((f) => (
              <div
                key={f.icon}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: f.active ? `${f.c}29` : NX.bg,
                  border: `1px solid ${f.active ? f.c : NX.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <PhIcon name={f.icon} size={14} color={f.c} />
              </div>
            ))}
          </div>

          {/* Section CONVERSATIONS */}
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: NX.fgMuted,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Conversations
          </div>

          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {PROVIDERS_LIST.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: i < 3 ? `${accent}10` : 'transparent',
                  fontSize: 11,
                  fontWeight: i < 3 ? 600 : 500,
                  color: i < 3 ? NX.fg : NX.fgMuted,
                }}
              >
                <ProviderIcon provider={p} size={18} />
                <span
                  style={{
                    flex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {p.name}
                </span>
                {i < 3 && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#28c840',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Panneau onboarding "Connecte ta première messagerie" */}
        <div
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            background: `radial-gradient(circle at 50% 30%, ${accent}14, transparent 70%)`,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `linear-gradient(135deg, ${accent} 0%, ${NX.primary} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 14px 30px ${accent}40`,
              marginBottom: 16,
            }}
          >
            <PhIcon name="link" size={28} color="#fff" />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: NX.fg,
              marginBottom: 6,
              letterSpacing: '-0.01em',
            }}
          >
            Connecte ta première messagerie
          </div>
          <div
            style={{
              fontSize: 11,
              color: NX.fgMuted,
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            Choisis un service à gauche.
            <br />
            Auth officielle, sans bridge.
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: NX.radiusPill,
              background: accent,
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            <PhIcon name="link" size={12} color="#fff" />
            Connecter Discord
          </div>
        </div>
      </div>
    </DeviceFrame>
  );
}

/** Étape 2 — Messenger embedded dans nexus (style screenshot Manu). */
function MockupUnifiedDashboard() {
  const accent = NX.featChat;
  const messenger = PROVIDERS_LIST[0]!;
  return (
    <DeviceFrame accent={accent} wide>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 200px 1fr',
          height: 460,
          marginInline: -20,
          marginBottom: -20,
          background: NX.bg,
        }}
      >
        {/* Rail nexus (groupes) */}
        <div
          style={{
            background: NX.elevated,
            borderRight: `1px solid ${NX.border}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0',
            gap: 12,
          }}
        >
          <Logo size={24} />
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: '#3399ff',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 800,
              border: `2px solid ${accent}`,
            }}
          >
            LP
          </div>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: `1.5px dashed ${NX.borderStrong}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PhIcon name="plus" size={12} color={NX.fgMuted} />
          </div>
        </div>

        {/* Liste discussions Messenger embedded */}
        <div
          style={{
            background: NX.bg,
            borderRight: `1px solid ${NX.border}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header avec logo Messenger */}
          <div
            style={{
              padding: '12px 12px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: `1px solid ${NX.border}`,
            }}
          >
            <ProviderIcon provider={messenger} size={22} />
            <span style={{ fontSize: 13, fontWeight: 800, color: NX.fg }}>Discussions</span>
          </div>

          {/* Search */}
          <div style={{ padding: '8px 10px' }}>
            <div
              style={{
                padding: '6px 10px',
                borderRadius: NX.radiusPill,
                background: NX.elevated,
                color: NX.fgMuted,
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <PhIcon name="magnifyingGlass" size={11} color={NX.fgMuted} />
              Rechercher
            </div>
          </div>

          {/* Discussions */}
          <div style={{ flex: 1, overflow: 'hidden', padding: '0 8px' }}>
            {[
              {
                name: 'Padel',
                preview: 'Robin : 👍',
                time: '2 min',
                color: '#34d399',
                active: true,
                unread: 2,
              },
              {
                name: 'Les potes',
                preview: 'Clément : ça arrive vite, j…',
                time: '2 h',
                color: NX.featEvents,
              },
              {
                name: 'Famille',
                preview: 'Maman : tu viens dimanche ?',
                time: '5 h',
                color: NX.featExpenses,
                unread: 1,
              },
              {
                name: 'Robin Gantner',
                preview: 'Donc je fais...',
                time: '8 h',
                color: NX.featPolls,
              },
              {
                name: 'Aurélien André',
                preview: 'Vous : Le dernier je c...',
                time: '22 h',
                color: NX.featTodo,
              },
              {
                name: 'Jérôme Galtier',
                preview: 'Négatif',
                time: '1 j',
                color: '#fb7185',
              },
              {
                name: 'Olivier, Fred',
                preview: 'Fred : Yo. Bon ben mon sc...',
                time: '1 j',
                color: NX.featChat,
              },
            ].map((d) => (
              <div
                key={d.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 8px',
                  borderRadius: 8,
                  background: d.active ? `${accent}1f` : 'transparent',
                  marginBottom: 2,
                }}
              >
                <Avatar initial={d.name[0] ?? '?'} color={d.color} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: NX.fg,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {d.name}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: NX.fgMuted,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {d.preview} · {d.time}
                  </div>
                </div>
                {d.unread && (
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: messenger.color,
                      color: '#fff',
                      fontSize: 8,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {d.unread}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Thread Padel */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
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
            <Avatar initial="P" color="#34d399" size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: NX.fg }}>Padel</div>
              <div
                style={{
                  fontSize: 9,
                  color: NX.fgMuted,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <ProviderIcon provider={messenger} size={11} />
                Messenger · 4 participants
              </div>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 11,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: NX.fgMuted,
                textAlign: 'center',
                marginBottom: 4,
              }}
            >
              Hier · 16:55
            </div>
            {[
              {
                who: 'Valentin',
                text: 'Ouai je suis chaud 🙂',
                mine: false,
                color: NX.featPolls,
              },
              { who: 'Clément', text: 'Je réserve !', mine: false, color: NX.featEvents },
              {
                who: 'Robin',
                text: 'Done 🥳',
                mine: false,
                color: NX.featExpenses,
              },
            ].map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 6,
                  flexDirection: m.mine ? 'row-reverse' : 'row',
                }}
              >
                {!m.mine && <Avatar initial={m.who[0] ?? '?'} color={m.color} size={20} />}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {!m.mine && (
                    <div
                      style={{
                        fontSize: 8,
                        color: NX.fgMuted,
                        marginBottom: 2,
                        marginLeft: 4,
                      }}
                    >
                      {m.who}
                    </div>
                  )}
                  <div
                    style={{
                      maxWidth: 240,
                      padding: '6px 10px',
                      borderRadius: 14,
                      background: m.mine ? messenger.color : NX.elevated,
                      color: m.mine ? '#fff' : NX.fg,
                      border: m.mine ? 'none' : `1px solid ${NX.border}`,
                      fontWeight: 500,
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            ))}

            <div
              style={{
                fontSize: 9,
                color: NX.fgMuted,
                textAlign: 'center',
                margin: '4px 0',
              }}
            >
              Aujourd'hui · 18:30
            </div>

            {/* Suggestion IA nexus */}
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                background: `${NX.primaryText}14`,
                border: `1px dashed ${NX.primaryText}66`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 10,
                marginTop: 4,
              }}
            >
              <PhIcon name="sparkle" size={12} color={NX.primaryText} />
              <span style={{ flex: 1, color: NX.fg, fontWeight: 600 }}>
                Créer un événement « Padel ce soir 18h30 » ?
              </span>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: NX.radiusPill,
                  background: NX.primary,
                  color: '#fff',
                  fontSize: 9,
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
              padding: '8px 12px',
              borderTop: `1px solid ${NX.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <div
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: NX.radiusPill,
                background: NX.elevated,
                border: `1px solid ${NX.border}`,
                color: NX.fgMuted,
                fontSize: 10,
              }}
            >
              Aa
            </div>
            <PhIcon name="paperPlaneRight" size={14} color={messenger.color} />
          </div>
        </div>
      </div>
    </DeviceFrame>
  );
}

/** Étape 3 — Home page du groupe "Famille" : 4 grandes cards + week calendar. */
function MockupGroupHome() {
  const accent = NX.primaryText;
  return (
    <DeviceFrame accent={accent} wide>
      <div
        style={{
          padding: '14px 16px 16px',
          background: NX.bg,
        }}
      >
        {/* Header groupe */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: '#f9a8d4',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            F
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: NX.fg, letterSpacing: '-0.02em' }}>
              Famille
            </div>
            <div style={{ fontSize: 10, color: NX.fgMuted }}>5 membres</div>
          </div>
        </div>

        {/* 4 grandes cards 2x2 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            marginBottom: 12,
          }}
        >
          {/* Événements */}
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${NX.featEvents}1f 0%, ${NX.featEvents}08 100%)`,
              border: `1px solid ${NX.featEvents}33`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: NX.featEvents,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PhIcon name="calendarBlank" size={11} color={NX.featEvents} />
              Événements
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: NX.fg,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                marginBottom: 4,
              }}
            >
              3
            </div>
            <div style={{ fontSize: 9, color: NX.fgMuted, marginBottom: 8 }}>à venir</div>
            <div
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: NX.bg,
                border: `1px solid ${NX.border}`,
                fontSize: 10,
              }}
            >
              <div style={{ fontWeight: 700, color: NX.fg, marginBottom: 1 }}>
                Vacances Bretagne
              </div>
              <div style={{ fontSize: 9, color: NX.fgMuted }}>14 juil</div>
            </div>
          </div>

          {/* Sondages */}
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${NX.featPolls}1f 0%, ${NX.featPolls}08 100%)`,
              border: `1px solid ${NX.featPolls}33`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: NX.featPolls,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PhIcon name="chartBar" size={11} color={NX.featPolls} />
              Sondages
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: NX.fg,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                marginBottom: 4,
              }}
            >
              1
            </div>
            <div style={{ fontSize: 9, color: NX.fgMuted, marginBottom: 8 }}>en attente de toi</div>
            <div
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: NX.bg,
                border: `1px solid ${NX.border}`,
                fontSize: 10,
              }}
            >
              <div style={{ fontWeight: 700, color: NX.fg, marginBottom: 2 }}>
                Cadeau anniv Papa
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: NX.border,
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: '60%', height: '100%', background: NX.featPolls }} />
              </div>
            </div>
          </div>

          {/* Dépenses */}
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${NX.featExpenses}1f 0%, ${NX.featExpenses}08 100%)`,
              border: `1px solid ${NX.featExpenses}33`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: NX.featExpenses,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PhIcon name="currencyDollar" size={11} color={NX.featExpenses} />
              Dépenses
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: NX.featExpenses,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                marginBottom: 4,
              }}
            >
              −127 €
            </div>
            <div style={{ fontSize: 9, color: NX.fgMuted, marginBottom: 8 }}>tu dois</div>
            <div
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: NX.bg,
                border: `1px solid ${NX.border}`,
                fontSize: 10,
              }}
            >
              <div style={{ fontWeight: 700, color: NX.fg, marginBottom: 1 }}>
                Billets train Maman
              </div>
              <div style={{ fontSize: 9, color: NX.fgMuted }}>2 dépenses ouvertes</div>
            </div>
          </div>

          {/* Mes tâches */}
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${NX.featTodo}1f 0%, ${NX.featTodo}08 100%)`,
              border: `1px solid ${NX.featTodo}33`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: NX.featTodo,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PhIcon name="listChecks" size={11} color={NX.featTodo} />
              Mes tâches
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: NX.fg,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                marginBottom: 4,
              }}
            >
              3
            </div>
            <div style={{ fontSize: 9, color: NX.fgMuted, marginBottom: 8 }}>à cocher</div>
            <div
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                background: NX.bg,
                border: `1px solid ${NX.border}`,
                fontSize: 10,
              }}
            >
              <div style={{ fontWeight: 700, color: NX.fg, marginBottom: 2 }}>
                Préparer les valises
              </div>
              <div style={{ fontSize: 9, color: NX.fgMuted }}>2/8 fait</div>
            </div>
          </div>
        </div>

        {/* Cette semaine — calendrier 7 jours */}
        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: NX.elevated,
            border: `1px solid ${NX.border}`,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: NX.fgMuted,
              fontWeight: 700,
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <PhIcon name="calendarBlank" size={11} color={NX.fgMuted} />
            Cette semaine
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {[
              { d: 'LUN', n: 4 },
              { d: 'MAR', n: 5 },
              { d: 'MER', n: 6 },
              { d: 'JEU', n: 7, today: true },
              { d: 'VEN', n: 8 },
              { d: 'SAM', n: 9, dot: NX.featEvents },
              { d: 'DIM', n: 10 },
            ].map((day) => (
              <div
                key={day.d}
                style={{
                  padding: '6px 0 4px',
                  borderRadius: 7,
                  background: day.today ? `${NX.featEvents}1f` : 'transparent',
                  border: day.today ? `1px solid ${NX.featEvents}66` : `1px solid transparent`,
                  textAlign: 'center',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    fontSize: 7,
                    color: day.today ? NX.featEvents : NX.fgMuted,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                  }}
                >
                  {day.d}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: day.today ? NX.featEvents : NX.fg,
                    fontWeight: 700,
                  }}
                >
                  {day.n}
                </div>
                {day.dot && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: day.dot,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Activité récente */}
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            background: NX.elevated,
            border: `1px solid ${NX.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PhIcon name="clock" size={11} color={NX.fgMuted} />
          <Avatar initial="P" color="#f9a8d4" size={20} />
          <span style={{ fontSize: 10, color: NX.fg, flex: 1 }}>
            <span style={{ fontWeight: 700 }}>Papa</span> a confirmé pour{' '}
            <span style={{ fontWeight: 600 }}>Vacances Bretagne</span>
          </span>
          <span style={{ fontSize: 9, color: NX.fgMuted }}>il y a 12 min</span>
        </div>
      </div>
    </DeviceFrame>
  );
}

/** Étape 4 — page publique RSVP (depuis un lien partagé). */
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
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
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
                fontSize: 'clamp(28px, 4vw, 44px)',
                fontWeight: 900,
                letterSpacing: '-0.04em',
                lineHeight: 1.1,
                marginBottom: 16,
                color: NX.fg,
              }}
            >
              nexus partout où tu en as besoin
            </h2>
            <p
              style={{
                fontSize: 'clamp(15px, 1.6vw, 17px)',
                color: NX.fgMuted,
                lineHeight: 1.6,
                maxWidth: 600,
                margin: '0 auto',
              }}
            >
              Application desktop native + navigateur dès maintenant. iOS et Android arrivent.
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
      </div>
    </section>
  );
}

function DownloadCardView({ card }: { card: DownloadCard }) {
  const [hover, setHover] = useState(false);
  const isClickable = card.available && card.href !== undefined;

  const inner = (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: '100%',
        padding: 28,
        borderRadius: NX.radiusLg,
        background: NX.glassBg,
        backdropFilter: NX.glassBlur,
        WebkitBackdropFilter: NX.glassBlur,
        border: `1px solid ${hover && isClickable ? NX.primary : NX.glassBorder}`,
        transition:
          'transform 200ms cubic-bezier(0.16,1,0.3,1), border-color 200ms ease, box-shadow 200ms ease',
        transform: hover && isClickable ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hover && isClickable ? '0 20px 48px rgba(0,122,255,0.18)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        opacity: card.available ? 1 : 0.8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: NX.elevated,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhIcon name={card.icon} size={22} color={NX.fg} />
        </div>
        {card.badge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: NX.radiusPill,
              background: NX.elevated,
              color: NX.fgMuted,
            }}
          >
            {card.badge}
          </span>
        )}
      </div>
      <div>
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
            lineHeight: 1.55,
            color: NX.fgMuted,
            margin: 0,
          }}
        >
          {card.description}
        </p>
      </div>
      {card.variants && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            paddingTop: 8,
            borderTop: `1px solid ${NX.border}`,
          }}
        >
          {card.variants.map((v) => (
            <li
              key={v.label}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                fontSize: 13,
              }}
            >
              <span style={{ color: NX.fg, fontWeight: 600 }}>{v.label}</span>
              <span style={{ color: NX.fgMuted, fontSize: 12 }}>{v.sub}</span>
            </li>
          ))}
        </ul>
      )}
      {isClickable && (
        <div
          style={{
            marginTop: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: NX.primaryText,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Télécharger
          <PhIcon name="downloadSimple" size={14} color={NX.primaryText} />
        </div>
      )}
    </div>
  );

  if (isClickable && card.href) {
    return (
      <a
        href={card.href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: 'none', display: 'block', height: '100%' }}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer({ onDownload }: { onDownload: () => void }) {
  return (
    <footer
      style={{
        padding: '64px 24px 40px',
        borderTop: `1px solid ${NX.border}`,
        background: NX.bg,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 40,
            marginBottom: 48,
          }}
        >
          <div>
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                textDecoration: 'none',
                marginBottom: 12,
              }}
            >
              <Logo size={26} />
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  color: NX.fg,
                }}
              >
                nexus
              </span>
            </a>
            <p
              style={{
                fontSize: 13,
                color: NX.fgMuted,
                lineHeight: 1.6,
                margin: 0,
                maxWidth: 240,
              }}
            >
              Toutes tes messageries en un seul endroit, plus une couche d'organisation conçue pour
              ta bande.
            </p>
          </div>
          <FooterColumn
            title="Produit"
            items={[
              { label: 'Se connecter', href: APP_LOGIN_URL },
              { label: 'Télécharger', onClick: onDownload },
              {
                label: 'Releases',
                href: 'https://github.com/Manuxv3-dev/nexus/releases',
                external: true,
              },
            ]}
          />
          <FooterColumn
            title="Ressources"
            items={[
              {
                label: 'GitHub',
                href: 'https://github.com/Manuxv3-dev/nexus',
                external: true,
              },
              {
                label: 'Issues',
                href: 'https://github.com/Manuxv3-dev/nexus/issues',
                external: true,
              },
            ]}
          />
          <FooterColumn
            title="Légal"
            items={[
              { label: 'Mentions légales', href: '/legal' },
              { label: 'Confidentialité', href: '/privacy' },
            ]}
          />
        </div>
        <div
          style={{
            paddingTop: 24,
            borderTop: `1px solid ${NX.border}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: NX.fgMuted,
          }}
        >
          <span>© {new Date().getFullYear()} nexus — Tous droits réservés.</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Fait avec
            <PhIcon name="heart" size={12} color={NX.primaryText} />
            entre potes.
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
  external?: boolean;
}

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: NX.fgMuted,
          fontWeight: 700,
          marginBottom: 16,
        }}
      >
        {title}
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {items.map((item) => (
          <li key={item.label}>
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 14,
                  color: NX.fg,
                  fontWeight: 500,
                  textAlign: 'left',
                }}
              >
                {item.label}
              </button>
            ) : (
              <a
                href={item.href}
                {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                style={{
                  textDecoration: 'none',
                  fontSize: 14,
                  color: NX.fg,
                  fontWeight: 500,
                }}
              >
                {item.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
