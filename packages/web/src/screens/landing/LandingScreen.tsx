/**
 * Landing page Nexus — servie sur `/` (cf. ADR-014).
 *
 * Avant launch : nexusapp.chat sert ce composant. Après launch : redirige
 * vers l'app web ou affiche un layout réduit (à arbitrer en J9 launch).
 */
import { useEffect, useRef, useState } from 'react';

import { Logo, PhIcon, type PhIconName } from '@/components/ui';
import { api } from '@/lib/api';
import { NX } from '@/lib/tokens';

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

const FEATURES: { icon: PhIconName; title: string; desc: string; color: string }[] = [
  {
    icon: 'link',
    title: 'Toutes tes convs, un seul endroit',
    desc:
      'Nexus se connecte à Discord, WhatsApp et Messenger. Tu vois tout, tu réponds depuis un seul écran.',
    color: NX.featChat,
  },
  {
    icon: 'calendarBlank',
    title: 'Événements & RSVP',
    desc:
      "Crée un événement, partage le lien. Tes amis répondent en un clic, même sans compte Nexus.",
    color: NX.featEvents,
  },
  {
    icon: 'chartBar',
    title: 'Sondages rapides',
    desc:
      '"Pizza ou sushi ?" — un sondage en 10 secondes. Résultats en temps réel, vote en un tap.',
    color: NX.featPolls,
  },
  {
    icon: 'currencyDollar',
    title: 'Dépenses partagées',
    desc:
      "Qui a payé quoi, qui doit combien à qui. Plus d'excuses. Plus de tableur Google Sheets.",
    color: NX.featExpenses,
  },
  {
    icon: 'listChecks',
    title: 'Listes & todos',
    desc:
      '"Qui amène quoi samedi ?" — une liste partagée, cochable, assignable. Fini le scroll.',
    color: NX.featTodo,
  },
  {
    icon: 'sparkle',
    title: 'IA qui comprend le contexte',
    desc:
      'Nexus détecte les intentions dans tes messages et te suggère un événement, un sondage ou une liste.',
    color: NX.featChat,
  },
];

export function LandingScreen() {
  return (
    <div style={{ background: NX.bg, color: NX.fg, minHeight: '100vh' }}>
      <Nav />
      <Hero />
      <ProblemSection />
      <AppPreviewSection />
      <FeaturesSection />
      <ComparisonSection />
      <HowItWorksSection />
      <FAQSection />
      <WaitlistSection />
      <FooterSection />
    </div>
  );
}

function Nav() {
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
        borderBottom: `1px solid ${NX.border}`,
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
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <Logo size={26} />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.04em', color: NX.fg }}>
            nexus
          </span>
        </a>
        <a
          href="#waitlist"
          style={{
            padding: '8px 20px',
            borderRadius: NX.radiusPill,
            background: NX.primary,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Rejoindre la beta
        </a>
      </div>
    </nav>
  );
}

function Hero() {
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

      <div style={{ position: 'relative', marginBottom: 40, width: 120, height: 120 }}>
        <div style={{ position: 'absolute', inset: 0, animation: 'spinSlow 20s linear infinite' }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: 5, background: 'var(--nx-feat-events)' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 8, width: 16, height: 16, borderRadius: 5, background: 'var(--nx-feat-chat)' }} />
          <div style={{ position: 'absolute', bottom: 10, right: 8, width: 16, height: 16, borderRadius: 5, background: 'var(--nx-feat-todo)' }} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Logo size={48} />
        </div>
      </div>

      <Reveal>
        <h1
          style={{
            fontSize: 'clamp(36px, 6vw, 72px)',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            maxWidth: 700,
            marginBottom: 20,
            background: 'linear-gradient(135deg, var(--nx-fg) 0%, var(--nx-feat-chat) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Une app pour discuter, planifier et partager — sans jongler entre dix outils.
        </h1>
      </Reveal>

      <Reveal delay={0.1}>
        <p
          style={{
            fontSize: 'clamp(16px, 2.2vw, 20px)',
            color: NX.fgMuted,
            maxWidth: 520,
            lineHeight: 1.6,
            marginBottom: 36,
          }}
        >
          Discord, WhatsApp, Messenger — un seul endroit pour discuter et s'organiser avec ta bande. Sans changer les habitudes de personne.
        </p>
      </Reveal>

      <Reveal delay={0.2}>
        <a
          href="#waitlist"
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
          }}
        >
          Accès anticipé
          <PhIcon name="arrowRight" size={18} color="#fff" />
        </a>
      </Reveal>

      <Reveal delay={0.35}>
        <div
          style={{ marginTop: 48, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}
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

function ProblemSection() {
  return (
    <section style={{ padding: '80px 24px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 700, textAlign: 'center' }}>
        <Reveal>
          <div
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: NX.primaryText,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            Le problème
          </div>
          <h2
            style={{
              fontSize: 'clamp(24px, 4vw, 40px)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              marginBottom: 20,
            }}
          >
            « C'était dans quel groupe déjà&nbsp;? »
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p style={{ fontSize: 17, color: NX.fgMuted, lineHeight: 1.7 }}>
            Samedi soir, tu cherches le message « qui amène quoi ». Sauf qu'il est dans WhatsApp.
            Ou peut-être dans le Discord. Ou dans le Messenger de la coloc. Tu scrolles, tu ne
            trouves pas, tu abandonnes et tu achètes des chips.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <div style={{ marginTop: 40, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { msg: '« On fait ça samedi ? »', src: 'WhatsApp', color: NX.whatsapp, rotate: -3 },
              { msg: '« J\'amène des bières 🍺 »', src: 'Discord', color: NX.discord, rotate: 2 },
              { msg: "« C'est chez qui déjà ? »", src: 'Messenger', color: NX.messenger, rotate: -1 },
            ].map((m, i) => (
              <div
                key={i}
                style={{
                  background: NX.elevated,
                  border: `1px solid ${NX.border}`,
                  borderRadius: NX.radius,
                  padding: '14px 18px',
                  maxWidth: 200,
                  textAlign: 'left',
                  transform: `rotate(${m.rotate}deg)`,
                  animation: `float ${3 + i * 0.5}s ease-in-out infinite`,
                }}
              >
                <div style={{ fontSize: 13, color: NX.fg, marginBottom: 6 }}>{m.msg}</div>
                <div style={{ fontSize: 10, color: m.color, fontWeight: 600 }}>{m.src}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section style={{ padding: '80px 24px 100px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1000, width: '100%' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                color: NX.primaryText,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              Fonctionnalités
            </div>
            <h2 style={{ fontSize: 'clamp(24px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-0.03em' }}>
              Plus qu'un agrégateur
            </h2>
          </div>
        </Reveal>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <div
                style={{
                  background: NX.elevated,
                  border: `1px solid ${NX.border}`,
                  borderRadius: NX.radius,
                  padding: 28,
                  height: '100%',
                  transition: 'border-color 0.3s, transform 0.3s',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                    background: `${f.color}15`,
                  }}
                >
                  <PhIcon name={f.icon} size={22} color={f.color} />
                </div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 8,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {f.title}
                </h3>
                <p style={{ fontSize: 14, color: NX.fgMuted, lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section
      style={{
        padding: '80px 24px',
        display: 'flex',
        justifyContent: 'center',
        background: NX.surface,
      }}
    >
      <div style={{ maxWidth: 800, width: '100%' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                color: NX.primaryText,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              Comment ça marche
            </div>
            <h2 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 800, letterSpacing: '-0.03em' }}>
              3 étapes, 2 minutes
            </h2>
          </div>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {[
            { step: '1', title: 'Crée ton groupe', desc: 'Invite ta bande via un lien. Pas besoin que tout le monde installe quoi que ce soit.' },
            { step: '2', title: 'Connecte tes messageries', desc: 'Ajoute Discord, WhatsApp ou Messenger. Nexus synchronise tes conversations existantes.' },
            { step: '3', title: 'Organise-toi enfin', desc: 'Événements, sondages, dépenses, listes — tout est dans un seul endroit. Partage des liens vers tes amis restés sur les autres apps.' },
          ].map((s, i) => (
            <Reveal key={s.step} delay={i * 0.1}>
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    background: NX.primaryMuted,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    fontWeight: 800,
                    color: NX.primaryText,
                    flexShrink: 0,
                  }}
                >
                  {s.step}
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.01em' }}>
                    {s.title}
                  </h3>
                  <p style={{ fontSize: 15, color: NX.fgMuted, lineHeight: 1.6 }}>{s.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function WaitlistSection() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Entre une adresse email valide');
      return;
    }
    setBusy(true);
    try {
      await api({
        method: 'POST',
        path: '/waitlist',
        body: { email, source: 'landing' },
        unauthenticated: true,
      });
      setSubmitted(true);
      setError('');
    } catch {
      setError('Inscription impossible. Réessaie.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="waitlist"
      style={{
        padding: '100px 24px',
        display: 'flex',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-30%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(0,122,255,0.10) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center', position: 'relative' }}>
        <Reveal>
          <Logo size={40} />
          <h2
            style={{
              fontSize: 'clamp(24px, 4vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              marginTop: 20,
              marginBottom: 12,
            }}
          >
            Rejoins la beta privée
          </h2>
          <p style={{ fontSize: 16, color: NX.fgMuted, lineHeight: 1.6, marginBottom: 32 }}>
            On ouvre Nexus à un petit groupe de testeurs. Laisse ton email, on te prévient.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          {!submitted ? (
            <form
              onSubmit={(e) => void submit(e)}
              style={{ display: 'flex', gap: 8, maxWidth: 420, margin: '0 auto' }}
            >
              <input
                type="email"
                placeholder="ton@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                style={{
                  flex: 1,
                  padding: '14px 18px',
                  borderRadius: NX.radiusPill,
                  border: `1px solid ${error ? NX.error : NX.border}`,
                  background: NX.surface,
                  color: NX.fg,
                  fontSize: 15,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={busy}
                style={{
                  padding: '14px 28px',
                  borderRadius: NX.radiusPill,
                  background: NX.primary,
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  border: 'none',
                  cursor: busy ? 'wait' : 'pointer',
                  flexShrink: 0,
                }}
              >
                →
              </button>
            </form>
          ) : (
            <div
              style={{
                background: NX.elevated,
                borderRadius: NX.radius,
                padding: '24px 28px',
                border: `1px solid rgba(52,211,153,0.2)`,
                maxWidth: 420,
                margin: '0 auto',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: NX.fg }}>C'est noté !</div>
              <div style={{ fontSize: 14, color: NX.fgMuted, marginTop: 6 }}>
                On te contacte très vite à <strong style={{ color: NX.fg }}>{email}</strong>
              </div>
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: NX.error, marginTop: 8 }}>{error}</div>}
        </Reveal>

        <Reveal delay={0.2}>
          <p style={{ fontSize: 12, color: NX.fgDim, marginTop: 16 }}>
            Pas de spam, promis. Juste un email quand c'est prêt.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function FooterSection() {
  return (
    <footer
      style={{
        padding: '32px 24px',
        borderTop: `1px solid ${NX.border}`,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo size={18} />
          <span style={{ fontSize: 13, fontWeight: 700, color: NX.fgMuted, letterSpacing: '-0.02em' }}>
            nexus
          </span>
        </div>
        <div style={{ fontSize: 12, color: NX.fgDim }}>
          © 2026 Nexus · Made with friends in mind
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppPreviewSection — 4 mini-mockups stylisés des dashboards killer features
// (Events, Polls, Expenses, Todos), chacun avec sa couleur Apple system.
// Densifie visuellement la landing entre Problem et Features (cf. ADR-021).
// ─────────────────────────────────────────────────────────────────────────────

function AppPreviewSection() {
  return (
    <section
      style={{
        padding: '80px 24px',
        display: 'flex',
        justifyContent: 'center',
        background: NX.surface,
      }}
    >
      <div style={{ maxWidth: 1100, width: '100%' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                color: NX.featChat,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              Aperçu
            </div>
            <h2
              style={{
                fontSize: 'clamp(24px, 4vw, 40px)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                marginBottom: 12,
              }}
            >
              Les 4 outils qui changent tout
            </h2>
            <p
              style={{
                fontSize: 16,
                color: NX.fgMuted,
                maxWidth: 560,
                margin: '0 auto',
                lineHeight: 1.55,
              }}
            >
              Pensés pour les bandes d'amis qui s'organisent. Chaque outil
              partageable en un lien — même avec ceux restés sur les autres apps.
            </p>
          </div>
        </Reveal>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {/* ─── Events ─── */}
          <Reveal delay={0}>
            <PreviewCard
              accent={NX.featEvents}
              accentBg={NX.featEventsBg}
              icon="calendarBlank"
              kind="Events"
              title="Apéro chez Léa"
              meta="Vendredi · 20:00"
            >
              <PreviewRow color={NX.featEvents} text="✓ 4 ont répondu oui" />
              <PreviewRow color={NX.fgMuted} text="? 2 hésitent" />
              <PreviewRow color={NX.fgGhost} text="3 n'ont pas vu" />
            </PreviewCard>
          </Reveal>

          {/* ─── Polls ─── */}
          <Reveal delay={0.08}>
            <PreviewCard
              accent={NX.featPolls}
              accentBg={NX.featPollsBg}
              icon="chartBar"
              kind="Polls"
              title="On part où ?"
              meta="9 votants"
            >
              <PreviewBar color={NX.featPolls} label="Lisbonne" pct={56} />
              <PreviewBar color={NX.featPolls} label="Berlin" pct={33} opacity={0.55} />
              <PreviewBar color={NX.featPolls} label="Vienne" pct={11} opacity={0.35} />
            </PreviewCard>
          </Reveal>

          {/* ─── Expenses ─── */}
          <Reveal delay={0.16}>
            <PreviewCard
              accent={NX.featExpenses}
              accentBg={NX.featExpensesBg}
              icon="currencyDollar"
              kind="Dépenses"
              title="Week-end Lyon"
              meta="247,50 €"
            >
              <PreviewRow color={NX.success} text="+ 38 € on te doit" />
              <PreviewRow color={NX.fgMuted} text="− 22 € tu dois à Sam" />
              <PreviewRow color={NX.fgGhost} text="Réglé · 2 sur 5 parts" />
            </PreviewCard>
          </Reveal>

          {/* ─── Todos ─── */}
          <Reveal delay={0.24}>
            <PreviewCard
              accent={NX.featTodo}
              accentBg={NX.featTodoBg}
              icon="listChecks"
              kind="Listes"
              title="Courses anniversaire"
              meta="6 / 9 fait"
            >
              <PreviewCheck color={NX.featTodo} done text="Bougies (Léa)" />
              <PreviewCheck color={NX.featTodo} done text="Gâteau (Sam)" />
              <PreviewCheck color={NX.featTodo} text="Glace (à assigner)" />
            </PreviewCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function PreviewCard({
  accent,
  accentBg,
  icon,
  kind,
  title,
  meta,
  children,
}: {
  accent: string;
  accentBg: string;
  icon: PhIconName;
  kind: string;
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: NX.elevated,
        border: `0.5px solid ${NX.border}`,
        borderRadius: NX.radiusLg,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%',
        boxShadow: NX.shadowSm,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: accentBg,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PhIcon name={icon} size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: accent,
              marginBottom: 2,
            }}
          >
            {kind}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: NX.fg,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        </div>
        <div style={{ fontSize: 11, color: NX.fgDim, flexShrink: 0 }}>{meta}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function PreviewRow({ color, text }: { color: string; text: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        color,
        padding: '6px 10px',
        borderRadius: NX.radiusXs,
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
      }}
    >
      {text}
    </div>
  );
}

function PreviewBar({
  color,
  label,
  pct,
  opacity = 1,
}: {
  color: string;
  label: string;
  pct: number;
  opacity?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: NX.fg, opacity }}>{label}</span>
        <span style={{ color: NX.fgMuted }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: NX.surface, borderRadius: 999 }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            opacity,
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

function PreviewCheck({
  color,
  text,
  done,
}: {
  color: string;
  text: string;
  done?: boolean;
}) {
  return (
    <div
      style={{
        fontSize: 12,
        color: done ? NX.fgDim : NX.fg,
        textDecoration: done ? 'line-through' : 'none',
        padding: '6px 10px',
        borderRadius: NX.radiusXs,
        background: NX.surface,
        border: `0.5px solid ${NX.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          border: `1.5px solid ${done ? color : NX.borderHover}`,
          background: done ? color : 'transparent',
          flexShrink: 0,
        }}
      />
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComparisonSection — tableau "Avant Nexus / Avec Nexus" pour visualiser le
// gain produit. 4 lignes de pain points → solutions Nexus.
// ─────────────────────────────────────────────────────────────────────────────

function ComparisonSection() {
  const rows: { pain: string; nexus: string; icon: PhIconName; color: string }[] = [
    {
      pain: '« C\'était dans quel groupe déjà ? » — tu scrolles 4 apps',
      nexus: 'Tout dans un seul écran, recherche unifiée',
      icon: 'magnifyingGlass',
      color: NX.featChat,
    },
    {
      pain: '12 messages pour fixer une date qui change 3 fois',
      nexus: 'Un événement, RSVP en un clic, rappel auto',
      icon: 'calendarBlank',
      color: NX.featEvents,
    },
    {
      pain: '« Pizza ou sushi ? » — débat de 2h sans conclusion',
      nexus: 'Sondage en 10 secondes, résultat en temps réel',
      icon: 'chartBar',
      color: NX.featPolls,
    },
    {
      pain: 'Tableur Google Sheets pour les comptes du week-end',
      nexus: 'Splitwise intégré, soldes calculés tout seul',
      icon: 'currencyDollar',
      color: NX.featExpenses,
    },
  ];

  return (
    <section style={{ padding: '80px 24px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 960, width: '100%' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                color: NX.featChat,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              Le gain
            </div>
            <h2
              style={{
                fontSize: 'clamp(24px, 4vw, 40px)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                marginBottom: 12,
              }}
            >
              Avant Nexus / avec Nexus
            </h2>
          </div>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r, i) => (
            <Reveal key={i} delay={i * 0.06}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto 1fr',
                  gap: 16,
                  alignItems: 'center',
                  padding: '18px 20px',
                  background: NX.elevated,
                  border: `0.5px solid ${NX.border}`,
                  borderRadius: NX.radiusLg,
                }}
              >
                {/* Avant */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    color: NX.fgDim,
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: NX.errorBg,
                      color: NX.error,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <PhIcon name="x" size={14} />
                  </span>
                  <span style={{ textDecoration: 'line-through', textDecorationColor: NX.fgGhost }}>
                    {r.pain}
                  </span>
                </div>

                {/* Arrow */}
                <PhIcon name="arrowRight" size={18} color={NX.fgGhost} />

                {/* Avec Nexus */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    color: NX.fg,
                    fontSize: 14,
                    fontWeight: 500,
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: `${r.color}20`,
                      color: r.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <PhIcon name={r.icon} size={14} />
                  </span>
                  <span>{r.nexus}</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQSection — 6 questions courantes en accordéon (un ouvert par défaut).
// Réponses courtes, factuelles, pour rassurer avant le CTA waitlist.
// ─────────────────────────────────────────────────────────────────────────────

function FAQSection() {
  const faqs: { q: string; a: string }[] = [
    {
      q: 'Mes amis doivent-ils créer un compte Nexus ?',
      a: "Non. Tu partages un lien, ils répondent (RSVP, vote, voient la dépense) sans inscription. L'inscription est nécessaire seulement si eux veulent créer leurs propres événements ou organiser à leur tour.",
    },
    {
      q: 'Comment ça marche avec WhatsApp / Messenger / Discord ?',
      a: "Tu connectes ton compte une fois. Pour Discord, c'est l'API officielle. Pour WhatsApp et Messenger, on encapsule l'app web officielle (modèle Franz) dans Nexus — tes conversations restent chez Meta, on ne touche pas au contenu, on ajoute juste la couche d'organisation.",
    },
    {
      q: 'Mes messages sont-ils stockés sur vos serveurs ?',
      a: "Pour Discord, on cache les messages localement pour permettre la recherche et la pagination. Pour WhatsApp et Messenger, on ne touche pas au contenu — l'app web officielle s'affiche dans Nexus mais reste isolée chez Meta. Aucune intelligence artificielle ne lit tes messages WA / Messenger.",
    },
    {
      q: "C'est gratuit ?",
      a: "La beta est 100% gratuite. Le modèle final n'est pas encore figé, mais l'idée c'est gratuit pour les groupes d'amis et payant uniquement pour les groupes très gros / usages pro. Les early adopters auront un avantage.",
    },
    {
      q: 'Sur quelles plateformes ça tourne ?',
      a: "Web (nexusapp.chat) en priorité, app desktop Tauri (Windows / macOS / Linux) en parallèle. Mobile iOS / Android prévu pour la beta publique.",
    },
    {
      q: "Quand sort la version stable ?",
      a: "La beta privée commence dans les semaines à venir. Inscris-toi à la liste d'attente pour être prévenu·e dès le go.",
    },
  ];
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section
      style={{
        padding: '80px 24px',
        display: 'flex',
        justifyContent: 'center',
        background: NX.surface,
      }}
    >
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div
              style={{
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                color: NX.featChat,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              Questions
            </div>
            <h2
              style={{
                fontSize: 'clamp(24px, 4vw, 36px)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
              }}
            >
              Ce qu'on nous demande le plus
            </h2>
          </div>
        </Reveal>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {faqs.map((f, i) => {
            const open = openIdx === i;
            return (
              <Reveal key={i} delay={i * 0.04}>
                <div
                  style={{
                    background: NX.elevated,
                    border: `0.5px solid ${open ? NX.borderHover : NX.border}`,
                    borderRadius: NX.radiusLg,
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenIdx(open ? null : i)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '16px 20px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: NX.fg,
                      fontSize: 15,
                      fontWeight: 500,
                    }}
                    aria-expanded={open}
                  >
                    <span>{f.q}</span>
                    <PhIcon
                      name={open ? 'caretDown' : 'caretRight'}
                      size={16}
                      color={NX.fgMuted}
                    />
                  </button>
                  {open ? (
                    <div
                      style={{
                        padding: '0 20px 18px',
                        fontSize: 14,
                        color: NX.fgMuted,
                        lineHeight: 1.6,
                      }}
                    >
                      {f.a}
                    </div>
                  ) : null}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
