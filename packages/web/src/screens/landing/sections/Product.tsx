import { Reveal } from '../components/Reveal';
import { SectionHeader } from '../components/SectionHeader';
import { TiltCard } from '../components/TiltCard';
import { cascadeDelay } from '../hooks/useReveal';
import { useViewport } from '../hooks/useViewport';
import { LX, LX_MODULE } from '../tokens';

/**
 * #nx-produit — bento des 4 modules d'orga. Cf. README §3.
 * <1200px : 1 colonne (cf. README §Responsive).
 */
export function Product() {
  const tier = useViewport();
  const isMobile = tier === 'mobile';

  return (
    <div
      id="nx-produit"
      style={{
        position: 'relative',
        padding: isMobile ? '72px 20px 0' : '104px 44px 0',
        scrollMarginTop: 24,
      }}
    >
      <div style={{ maxWidth: LX.maxWidth, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="01 — PRODUIT"
          title="Quatre outils. Zéro app en plus."
          titleMaxWidth={640}
          description="Tout ce que vous faisiez dans quatre applis différentes vit maintenant dans la conversation du groupe."
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: tier === 'desktop' ? '1.35fr 1fr' : '1fr',
            gap: 16,
            marginTop: 44,
          }}
        >
          <Reveal delay={cascadeDelay(0)}>
            <EventsCard />
          </Reveal>
          <Reveal delay={cascadeDelay(1)}>
            <PollsCard />
          </Reveal>
          <Reveal delay={cascadeDelay(2)}>
            <TodosCard />
          </Reveal>
          <Reveal delay={cascadeDelay(3)}>
            <ExpensesCard />
          </Reveal>
        </div>
      </div>
    </div>
  );
}

function Eyebrow({ color, dotBg, children }: { color: string; dotBg: string; children: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10.5,
        letterSpacing: '.11em',
        color,
      }}
    >
      <span style={{ width: 16, height: 16, borderRadius: 5, background: dotBg }} />
      {children}
    </div>
  );
}

function EventsCard() {
  const m = LX_MODULE.events;
  return (
    <TiltCard
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 340,
        padding: 28,
        borderRadius: 22,
        background: 'linear-gradient(150deg, rgba(0,122,255,.16), rgba(255,255,255,.02))',
        border: `1px solid ${m.border}`,
        overflow: 'hidden',
      }}
      hoverBorderColor="rgba(0,122,255,.5)"
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -90,
          top: -90,
          width: 320,
          height: 320,
          borderRadius: 99,
          background: 'radial-gradient(circle, rgba(0,122,255,.35), transparent 66%)',
          filter: 'blur(28px)',
        }}
      />
      <div style={{ position: 'relative' }}>
        <Eyebrow color={m.text} dotBg="rgba(0,122,255,.45)">
          ÉVÉNEMENTS
        </Eyebrow>
        <div
          style={{
            marginTop: 14,
            maxWidth: 400,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-.035em',
            lineHeight: 1.15,
            color: LX.text,
          }}
        >
          Un lien, une date, tout le monde répond
        </div>
        <p
          style={{
            margin: '12px 0 0',
            maxWidth: 400,
            fontSize: 14.5,
            lineHeight: 1.6,
            color: LX.text3,
          }}
        >
          RSVP oui / peut-être / non, compte à rebours, rappel automatique la veille. Partageable
          même à ceux qui n&apos;ont pas Nexus.
        </p>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginTop: 26,
          padding: 18,
          borderRadius: 16,
          background: 'rgba(10,10,15,.5)',
          border: `1px solid ${LX.border}`,
        }}
      >
        <div
          style={{
            flex: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'rgba(0,122,255,.22)',
            border: '1px solid rgba(0,122,255,.4)',
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              letterSpacing: '.08em',
              color: m.text,
            }}
          >
            FÉV
          </span>
          <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.05, color: LX.text }}>
            14
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.015em', color: LX.text }}>
            Semi-Marathon de Barcelone 2027
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 4,
              marginTop: 6,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 800, color: LX.text }}>195</span>
            <span style={{ fontSize: 10.5, color: LX.text4 }}>J</span>
            <span style={{ fontSize: 17, fontWeight: 800, marginLeft: 7, color: LX.text }}>21</span>
            <span style={{ fontSize: 10.5, color: LX.text4 }}>H</span>
            <span style={{ fontSize: 17, fontWeight: 800, marginLeft: 7, color: LX.text }}>12</span>
            <span style={{ fontSize: 10.5, color: LX.text4 }}>M</span>
          </div>
        </div>
        <div style={{ flex: 'none', display: 'flex', gap: 7 }}>
          <span
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              background: '#34C759',
              color: '#06280f',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'transform .2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = '';
            }}
          >
            Oui
          </span>
          <span
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              border: '1px solid rgba(245,158,11,.5)',
              color: '#ffc978',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background .2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(245,158,11,.14)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Peut-être
          </span>
          <span
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              border: '1px solid rgba(255,90,90,.4)',
              color: '#ff8f8f',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background .2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,90,90,.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Non
          </span>
        </div>
      </div>
    </TiltCard>
  );
}

function PollsCard() {
  const m = LX_MODULE.polls;
  const options = [
    { label: 'Chez Clément', count: 5, width: 68, barOpacity: 0.32, textOpacity: 1 },
    { label: 'Au parc', count: 2, width: 28, barOpacity: 0.18, textOpacity: 0.75 },
    { label: 'On annule', count: 0, width: 0, barOpacity: 0.18, textOpacity: 0.75 },
  ];
  return (
    <TiltCard
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 340,
        padding: 28,
        borderRadius: 22,
        background: 'linear-gradient(150deg, rgba(168,85,247,.16), rgba(255,255,255,.02))',
        border: `1px solid ${m.border}`,
        overflow: 'hidden',
      }}
      hoverBorderColor="rgba(168,85,247,.5)"
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -90,
          bottom: -110,
          width: 300,
          height: 300,
          borderRadius: 99,
          background: 'radial-gradient(circle, rgba(168,85,247,.32), transparent 66%)',
          filter: 'blur(28px)',
        }}
      />
      <div style={{ position: 'relative' }}>
        <Eyebrow color={m.text} dotBg="rgba(168,85,247,.45)">
          SONDAGES
        </Eyebrow>
        <div
          style={{
            marginTop: 14,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-.035em',
            lineHeight: 1.15,
            color: LX.text,
          }}
        >
          Décidez en 30 secondes
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.6, color: LX.text3 }}>
          Une question, des options, un résultat en direct. Fini les 80 messages pour choisir un
          resto.
        </p>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          marginTop: 24,
          padding: 18,
          borderRadius: 16,
          background: 'rgba(10,10,15,.5)',
          border: `1px solid ${LX.border}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: LX.text }}>
          BBQ anniv Clément — on fait quoi ?
        </div>
        {options.map((o) => (
          <div
            key={o.label}
            style={{
              position: 'relative',
              padding: '9px 12px',
              borderRadius: 10,
              background: 'rgba(255,255,255,.05)',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${o.width}%`,
                background: `rgba(168,85,247,${o.barOpacity})`,
              }}
            />
            <span
              style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12.5,
                fontWeight: o.textOpacity === 1 ? 600 : 500,
                color: o.textOpacity === 1 ? LX.text : 'rgba(255,255,255,.75)',
              }}
            >
              <span>{o.label}</span>
              <span>{o.count}</span>
            </span>
          </div>
        ))}
      </div>
    </TiltCard>
  );
}

function TodosCard() {
  const m = LX_MODULE.todos;
  const rows = [
    { label: 'Playlist de la route', meta: 'Léa', done: true },
    { label: 'Réserver le van', meta: 'Toi · vendredi', done: false },
    { label: 'Acheter les dossards', meta: 'Karim', done: false },
  ];
  return (
    <TiltCard
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 300,
        padding: 28,
        borderRadius: 22,
        background: 'linear-gradient(150deg, rgba(52,199,89,.14), rgba(255,255,255,.02))',
        border: `1px solid ${m.border}`,
        overflow: 'hidden',
      }}
      hoverBorderColor="rgba(52,199,89,.5)"
    >
      <div style={{ position: 'relative' }}>
        <Eyebrow color={m.text} dotBg="rgba(52,199,89,.45)">
          TODOS
        </Eyebrow>
        <div
          style={{
            marginTop: 14,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-.035em',
            lineHeight: 1.15,
            color: LX.text,
          }}
        >
          Qui fait quoi, sans relancer
        </div>
        <p
          style={{
            margin: '12px 0 0',
            maxWidth: 420,
            fontSize: 14.5,
            lineHeight: 1.6,
            color: LX.text3,
          }}
        >
          Assigne une tâche à quelqu&apos;un, il la voit dans sa messagerie habituelle.
        </p>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          marginTop: 24,
        }}
      >
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '11px 14px',
              borderRadius: 12,
              background: 'rgba(10,10,15,.5)',
              border: `1px solid ${LX.border}`,
              fontSize: 13.5,
              color: row.done ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.8)',
              textDecoration: row.done ? 'line-through' : 'none',
              cursor: row.done ? 'default' : 'pointer',
              transition: 'border-color .2s',
            }}
            onMouseEnter={(e) => {
              if (!row.done) e.currentTarget.style.borderColor = 'rgba(52,199,89,.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = LX.border;
            }}
          >
            {row.done ? (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 17,
                  height: 17,
                  borderRadius: 6,
                  background: '#34C759',
                  flexShrink: 0,
                }}
              >
                <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                  <path
                    d="M1 4l2.6 2.6L9 1.2"
                    stroke="#06280f"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : (
              <span
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: 6,
                  border: '1.6px solid rgba(52,199,89,.6)',
                  flexShrink: 0,
                }}
              />
            )}
            {row.label}
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: row.done ? undefined : 'rgba(255,255,255,.45)',
              }}
            >
              {row.meta}
            </span>
          </div>
        ))}
      </div>
    </TiltCard>
  );
}

function ExpensesCard() {
  const m = LX_MODULE.expenses;
  return (
    <TiltCard
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 300,
        padding: 28,
        borderRadius: 22,
        background: 'linear-gradient(150deg, rgba(245,158,11,.14), rgba(255,255,255,.02))',
        border: `1px solid ${m.border}`,
        overflow: 'hidden',
      }}
      hoverBorderColor="rgba(245,158,11,.5)"
    >
      <div style={{ position: 'relative' }}>
        <Eyebrow color={m.text} dotBg="rgba(245,158,11,.45)">
          DÉPENSES
        </Eyebrow>
        <div
          style={{
            marginTop: 14,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-.035em',
            lineHeight: 1.15,
            color: LX.text,
          }}
        >
          Split en 2 clics
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.6, color: LX.text3 }}>
          Resto, courses, billet de train. Nexus calcule qui doit combien à qui, et le rappelle.
        </p>
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: 24,
          padding: 18,
          borderRadius: 16,
          background: 'rgba(10,10,15,.5)',
          border: `1px solid ${LX.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.7)' }}>
            Van week-end
          </span>
          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.04em', color: LX.text }}>
            184,50 €
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginTop: 12,
            height: 7,
            borderRadius: 99,
            overflow: 'hidden',
            background: 'rgba(255,255,255,.07)',
          }}
        >
          <span style={{ flex: 2, background: '#F59E0B' }} />
          <span style={{ flex: 2, background: 'rgba(245,158,11,.6)' }} />
          <span style={{ flex: 1, background: 'rgba(245,158,11,.3)' }} />
          <span style={{ flex: 2, background: 'rgba(245,158,11,.15)' }} />
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            marginTop: 12,
            fontSize: 12,
            color: 'rgba(255,255,255,.55)',
          }}
        >
          <span>
            Karim te doit <b style={{ color: m.text }}>26,30 €</b>
          </span>
          <span>
            Léa te doit <b style={{ color: m.text }}>26,30 €</b>
          </span>
          <span>
            Thomas te doit <b style={{ color: m.text }}>13,15 €</b>
          </span>
        </div>
      </div>
    </TiltCard>
  );
}
