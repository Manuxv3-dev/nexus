import { BrandIcon, type BrandKey } from '@/components/ui';

import { brandTint } from '../components/brandTint';
import { OrbitLogo } from '../components/OrbitLogo';
import { TiltCard } from '../components/TiltCard';
import { LX, LX_MODULE } from '../tokens';

/**
 * Mockup de l'app dans la scène du hero — reprise fidèle de l'app réelle
 * (cf. README §1 Hero, "Contenu du mockup"). Volontairement en arrière-plan
 * (voile + flou + fondu bas posés par le parent `Hero`) : demande répétée
 * du client de ne jamais le remonter au premier plan.
 */

const SIDEBAR_CONVERSATIONS: { brand: BrandKey; label: string; unread?: number }[] = [
  { brand: 'discord', label: 'Discord', unread: 3 },
  { brand: 'whatsapp', label: 'WhatsApp', unread: 7 },
  { brand: 'teams', label: 'Teams' },
  { brand: 'messenger', label: 'Messenger' },
  { brand: 'telegram', label: 'Telegram' },
  { brand: 'instagram', label: 'Instagram' },
];

const SHORTCUTS = [
  { key: 'events' as const },
  { key: 'polls' as const },
  { key: 'expenses' as const },
  { key: 'todos' as const },
];

export function HeroMockup() {
  return (
    <div
      style={{
        position: 'relative',
        height: 404,
        borderRadius: '16px 16px 0 0',
        border: `1px solid ${LX.borderFaint}`,
        borderBottom: 'none',
        background: LX.surface,
        boxShadow: '0 40px 110px rgba(0,0,0,.75)',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '160px minmax(0,1fr)',
      }}
    >
      {/* ─── Sidebar ─── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: `1px solid ${LX.borderFaint}`,
          background: LX.surfaceAlt,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '15px 14px 13px',
            borderBottom: `1px solid ${LX.borderFaint}`,
          }}
        >
          <OrbitLogo size={18} strokeWidth={3} dotR={9} durationS={20} />
          <span
            style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-.03em', color: LX.text }}
          >
            nexus
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 14px' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 10,
              background: LX_MODULE.events.accent,
              fontSize: 11,
              fontWeight: 800,
              color: LX.text,
            }}
          >
            LP
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 10,
              border: `1px dashed ${LX.borderStrong}`,
              color: LX.text4,
              fontSize: 15,
            }}
          >
            +
          </span>
        </div>

        <div style={{ padding: '4px 14px 11px', borderBottom: `1px solid ${LX.borderFaint}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: LX.text }}>Les potes</div>
          <div style={{ fontSize: 10.5, color: LX.text4, marginTop: 1 }}>7 membres</div>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginTop: 9 }}
          >
            {SHORTCUTS.map((s) => {
              const m = LX_MODULE[s.key];
              return (
                <span
                  key={s.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 25,
                    borderRadius: 7,
                    background: brandTint(m.accent, 0.16),
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: m.accent }} />
                </span>
              );
            })}
          </div>
        </div>

        <div
          style={{
            padding: '12px 14px 4px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9.5,
            letterSpacing: '.1em',
            color: LX.text4,
          }}
        >
          CONVERSATIONS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '4px 8px' }}>
          {SIDEBAR_CONVERSATIONS.map((c) => (
            <div
              key={c.brand}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '6px 8px',
                borderRadius: 8,
              }}
            >
              <BrandIcon brand={c.brand} size={15} style={{ borderRadius: 5, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,.8)' }}>
                {c.label}
              </span>
              {c.unread ? (
                <span
                  style={{
                    marginLeft: 'auto',
                    minWidth: 16,
                    textAlign: 'center',
                    padding: '1px 5px',
                    borderRadius: 999,
                    background: LX_MODULE.events.accent,
                    fontSize: 9.5,
                    fontWeight: 800,
                    color: LX.text,
                  }}
                >
                  {c.unread}
                </span>
              ) : null}
            </div>
          ))}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '6px 8px',
              color: LX.text4,
              fontSize: 12,
            }}
          >
            + 6 autres
          </div>
        </div>

        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '11px 14px',
            borderTop: `1px solid ${LX.borderFaint}`,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 8,
              background: '#f0a3c0',
              color: '#3a1226',
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            M
          </span>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: LX.text }}>Manu</div>
            <div style={{ fontSize: 9.5, color: LX.statusOnline }}>En ligne</div>
          </div>
        </div>
      </div>

      {/* ─── Panneau principal ─── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          background: '#101014',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 20px' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 11,
              background: 'linear-gradient(140deg,#f0a3c0,#e0759e)',
              color: '#3a1226',
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            L
          </span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', color: LX.text }}>
              Les potes
            </div>
            <div style={{ fontSize: 11, color: LX.text4 }}>7 membres · 4 messageries actives</div>
          </div>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: '4px 9px',
              borderRadius: 6,
              background: brandTint(LX_MODULE.todos.accent, 0.16),
              color: LX.statusOnline,
            }}
          >
            SYNC
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 11,
            padding: '4px 20px 0',
          }}
        >
          <ModuleCard moduleKey="events" eyebrow="ÉVÉNEMENTS" big="1" bigSuffix="à venir">
            <div style={{ fontSize: 12.5, fontWeight: 600, color: LX.text }}>
              Semi-Marathon de Barcelone 2027
            </div>
            <div style={{ fontSize: 10.5, color: LX.text4, marginTop: 2 }}>
              14 févr. · <span style={{ color: LX.statusOnline }}>5 oui</span>
            </div>
          </ModuleCard>

          <ModuleCard moduleKey="polls" eyebrow="SONDAGES" big="2" bigSuffix="en attente de toi">
            <div style={{ fontSize: 12.5, fontWeight: 600, color: LX.text }}>BBQ anniv Clément</div>
            <div
              style={{
                position: 'relative',
                height: 5,
                marginTop: 8,
                borderRadius: 999,
                background: 'rgba(255,255,255,.1)',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '68%',
                  borderRadius: 999,
                  background: LX_MODULE.polls.accent,
                }}
              />
            </div>
          </ModuleCard>

          <ModuleCard moduleKey="expenses" eyebrow="DÉPENSES" big="184,50 €" bigSuffix="ouvert">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: 11.5,
                color: LX.text3,
              }}
            >
              <span>
                Karim te doit <b style={{ color: LX_MODULE.expenses.text }}>26,30 €</b>
              </span>
              <span>
                Léa te doit <b style={{ color: LX_MODULE.expenses.text }}>26,30 €</b>
              </span>
            </div>
          </ModuleCard>

          <ModuleCard moduleKey="todos" eyebrow="MES TÂCHES" big="3" bigSuffix="assignées">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  color: 'rgba(255,255,255,.65)',
                }}
              >
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 4,
                    border: `1.5px solid ${brandTint(LX_MODULE.todos.accent, 0.6)}`,
                  }}
                />
                Réserver le van
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  color: 'rgba(255,255,255,.32)',
                  textDecoration: 'line-through',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 13,
                    height: 13,
                    borderRadius: 4,
                    background: LX_MODULE.todos.accent,
                  }}
                >
                  <svg width="7" height="6" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4l2.6 2.6L9 1.2"
                      stroke="#06280f"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                Playlist route
              </div>
            </div>
          </ModuleCard>
        </div>

        <div style={{ padding: '15px 20px 0' }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5,
              letterSpacing: '.1em',
              color: LX.text4,
            }}
          >
            ACTIVITÉ RÉCENTE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 11 }}>
            <ActivityRow initial="M" color="#f0a3c0" textColor="#3a1226" time="il y a 5 h">
              <b style={{ color: LX.text, fontWeight: 700 }}>Manu</b> a répondu oui à «
              Semi-Marathon de Barcelone 2027 »
            </ActivityRow>
            <ActivityRow initial="L" color="#a5c8f0" textColor="#12263a" time="26 juin">
              <b style={{ color: LX.text, fontWeight: 700 }}>Léa</b> a lancé le sondage « BBQ anniv
              Clément »
            </ActivityRow>
            <ActivityRow initial="K" color="#f0d0a3" textColor="#3a2812" time="24 juin">
              <b style={{ color: LX.text, fontWeight: 700 }}>Karim</b> a ajouté la dépense « Van
              week-end » · 184,50 €
            </ActivityRow>
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(10,10,15,.52)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 270,
          background: `linear-gradient(180deg, transparent, ${LX.bg} 80%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

function ModuleCard({
  moduleKey,
  eyebrow,
  big,
  bigSuffix,
  children,
}: {
  moduleKey: keyof typeof LX_MODULE;
  eyebrow: string;
  big: string;
  bigSuffix: string;
  children: React.ReactNode;
}) {
  const m = LX_MODULE[moduleKey];
  return (
    <TiltCard
      style={{
        padding: 15,
        borderRadius: 15,
        background: `linear-gradient(150deg, ${brandTint(m.accent, 0.16)}, ${brandTint(m.accent, 0.03)})`,
        border: `1px solid ${brandTint(m.accent, 0.22)}`,
      }}
      className="nx-landing-module-card"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9.5,
          letterSpacing: '.1em',
          color: m.text,
        }}
      >
        <span
          style={{ width: 14, height: 14, borderRadius: 5, background: brandTint(m.accent, 0.4) }}
        />
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 9,
          fontSize: 27,
          fontWeight: 800,
          letterSpacing: '-.03em',
          color: LX.text,
        }}
      >
        {big}{' '}
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,.45)' }}>
          {bigSuffix}
        </span>
      </div>
      <div
        style={{
          marginTop: 9,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'rgba(255,255,255,.06)',
        }}
      >
        {children}
      </div>
    </TiltCard>
  );
}

function ActivityRow({
  initial,
  color,
  textColor,
  time,
  children,
}: {
  initial: string;
  color: string;
  textColor: string;
  time: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        fontSize: 12,
        color: 'rgba(255,255,255,.62)',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 7,
          background: color,
          color: textColor,
          fontSize: 9,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {initial}
      </span>
      <span>{children}</span>
      <span style={{ marginLeft: 'auto', fontSize: 10.5, color: LX.text5, whiteSpace: 'nowrap' }}>
        {time}
      </span>
    </div>
  );
}
