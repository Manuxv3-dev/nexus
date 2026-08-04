import type { CSSProperties } from 'react';
import { useState } from 'react';

import { Reveal } from '../components/Reveal';
import { SectionHeader } from '../components/SectionHeader';
import { TiltCard } from '../components/TiltCard';
import { cascadeDelay } from '../hooks/useReveal';
import { useViewport } from '../hooks/useViewport';
import { LX, LX_MODULE } from '../tokens';

/**
 * #nx-produit — bento des 4 modules d'orga. Cf. README §3.
 * <1200px : 1 colonne (cf. README §Responsive).
 *
 * MAN-150 : les 4 cartes sont interactives (état local `useState` par
 * composant, aucune persistance — un reload remet tout à zéro). Cf. le
 * ticket Linear pour la spec complète ; les règles non triviales sont
 * résumées au-dessus du code qui les porte (`useExclusiveChoice`,
 * `toggleTodo`, `toggleSettled`, `addExpense`).
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

/**
 * Compteurs d'un choix exclusif (RSVP, sondage) : le visiteur n'a qu'une
 * voix, la poser ailleurs la *déplace* au lieu de la dupliquer. Recliquer le
 * choix déjà actif est un no-op plutôt qu'un retrait (décision actée dans
 * MAN-150) : un double-clic accidentel ne doit pas faire disparaître le vote
 * sans explication.
 *
 * Factorisé entre EventsCard et PollsCard : même mécanique, deux jeux de clés.
 */
function useExclusiveChoice<K extends string>(initialCounts: Record<K, number>) {
  const [counts, setCounts] = useState<Record<K, number>>(initialCounts);
  const [choice, setChoice] = useState<K | null>(null);

  const select = (next: K) => {
    if (choice === next) return;
    setCounts((prev) => {
      const updated = { ...prev };
      if (choice) updated[choice] -= 1;
      updated[next] += 1;
      return updated;
    });
    setChoice(next);
  };

  return { counts, choice, select };
}

type RsvpChoice = 'yes' | 'maybe' | 'no';

const RSVP_LABELS: Record<RsvpChoice, string> = {
  yes: 'Oui',
  maybe: 'Peut-être',
  no: 'Non',
};

/** Compteurs de départ plausibles pour un événement déjà partagé au groupe. */
const INITIAL_RSVP_COUNTS: Record<RsvpChoice, number> = { yes: 8, maybe: 2, no: 0 };

function EventsCard() {
  const m = LX_MODULE.events;
  const {
    counts,
    choice: myChoice,
    select: handleRsvp,
  } = useExclusiveChoice<RsvpChoice>(INITIAL_RSVP_COUNTS);

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
          <RsvpButton
            choice="yes"
            active={myChoice === 'yes'}
            count={counts.yes}
            onSelect={handleRsvp}
          />
          <RsvpButton
            choice="maybe"
            active={myChoice === 'maybe'}
            count={counts.maybe}
            onSelect={handleRsvp}
          />
          <RsvpButton
            choice="no"
            active={myChoice === 'no'}
            count={counts.no}
            onSelect={handleRsvp}
          />
        </div>
      </div>
    </TiltCard>
  );
}

const RSVP_VARIANTS: Record<RsvpChoice, (active: boolean) => CSSProperties> = {
  yes: (active) => ({
    background: '#34C759',
    color: '#06280f',
    fontWeight: 800,
    boxShadow: active ? '0 0 0 2px rgba(255,255,255,.9)' : 'none',
  }),
  maybe: (active) => ({
    background: active ? 'rgba(245,158,11,.32)' : 'transparent',
    border: '1px solid rgba(245,158,11,.5)',
    color: '#ffc978',
    fontWeight: 700,
  }),
  no: (active) => ({
    background: active ? 'rgba(255,90,90,.28)' : 'transparent',
    border: '1px solid rgba(255,90,90,.4)',
    color: '#ff8f8f',
    fontWeight: 700,
  }),
};

function RsvpButton({
  choice,
  active,
  count,
  onSelect,
}: {
  choice: RsvpChoice;
  active: boolean;
  count: number;
  onSelect: (choice: RsvpChoice) => void;
}) {
  return (
    <button
      type="button"
      className="nx-card-btn nx-rsvp-btn"
      aria-pressed={active}
      onClick={() => onSelect(choice)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        border: 'none',
        borderRadius: 999,
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: 'pointer',
        ...RSVP_VARIANTS[choice](active),
      }}
    >
      {RSVP_LABELS[choice]}
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, opacity: 0.85 }}>
        {count}
      </span>
    </button>
  );
}

type PollKey = 'clement' | 'parc' | 'annule';

interface PollOption {
  key: PollKey;
  label: string;
}

const POLL_OPTIONS: PollOption[] = [
  { key: 'clement', label: 'Chez Clément' },
  { key: 'parc', label: 'Au parc' },
  { key: 'annule', label: 'On annule' },
];

const INITIAL_POLL_COUNTS: Record<PollKey, number> = { clement: 5, parc: 2, annule: 0 };

function PollsCard() {
  const m = LX_MODULE.polls;
  const {
    counts,
    choice: myVote,
    select: handleVote,
  } = useExclusiveChoice<PollKey>(INITIAL_POLL_COUNTS);

  const total = POLL_OPTIONS.reduce((sum, o) => sum + counts[o.key], 0);
  const maxCount = Math.max(...POLL_OPTIONS.map((o) => counts[o.key]));

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
        {POLL_OPTIONS.map((o) => {
          const count = counts[o.key];
          const width = total > 0 ? (count / total) * 100 : 0;
          const isLeading = total > 0 && count === maxCount;
          const active = myVote === o.key;
          return (
            <button
              key={o.key}
              type="button"
              className="nx-card-btn"
              aria-pressed={active}
              onClick={() => handleVote(o.key)}
              style={{
                position: 'relative',
                display: 'block',
                width: '100%',
                padding: '9px 12px',
                border: active ? '1px solid rgba(168,85,247,.6)' : '1px solid transparent',
                borderRadius: 10,
                background: 'rgba(255,255,255,.05)',
                overflow: 'hidden',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <span
                data-testid={`poll-bar-${o.key}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${width}%`,
                  background: `rgba(168,85,247,${isLeading ? 0.32 : 0.18})`,
                  transition: 'width .25s ease',
                }}
              />
              <span
                style={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12.5,
                  fontWeight: isLeading ? 600 : 500,
                  color: isLeading ? LX.text : 'rgba(255,255,255,.75)',
                }}
              >
                <span>{o.label}</span>
                <span>{count}</span>
              </span>
            </button>
          );
        })}
      </div>
    </TiltCard>
  );
}

interface TodoRow {
  id: string;
  label: string;
  meta: string;
  done: boolean;
}

const INITIAL_TODOS: TodoRow[] = [
  { id: 'playlist', label: 'Playlist de la route', meta: 'Léa', done: true },
  { id: 'van', label: 'Réserver le van', meta: 'Toi · vendredi', done: false },
  { id: 'dossards', label: 'Acheter les dossards', meta: 'Karim', done: false },
];

function TodosCard() {
  const m = LX_MODULE.todos;
  const [rows, setRows] = useState<TodoRow[]>(INITIAL_TODOS);

  /** Cocher/décocher est symétrique et rejouable à volonté dans les deux sens. */
  const toggleTodo = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));
  };

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
          <label
            key={row.id}
            className="nx-todo-row"
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
              cursor: 'pointer',
            }}
          >
            <span style={{ position: 'relative', width: 17, height: 17, flexShrink: 0 }}>
              <input
                type="checkbox"
                className="nx-todo-checkbox"
                checked={row.done}
                onChange={() => toggleTodo(row.id)}
              />
              <svg
                aria-hidden
                className="nx-todo-check-icon"
                width="9"
                height="7"
                viewBox="0 0 10 8"
                fill="none"
                style={{ position: 'absolute', left: 4, top: 5 }}
              >
                <path
                  d="M1 4l2.6 2.6L9 1.2"
                  stroke="#06280f"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
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
          </label>
        ))}
      </div>
    </TiltCard>
  );
}

type Debtor = 'Karim' | 'Léa' | 'Thomas';

interface DebtState {
  amount: number;
  settled: boolean;
}

const DEBTORS: Debtor[] = ['Karim', 'Léa', 'Thomas'];

/**
 * Le mockup statique affichait des montants asymétriques (26,30 / 26,30 /
 * 13,15 €) dont la somme — 65,75 € — ne tombait pas sur le total annoncé de
 * 184,50 €. Sur une image figée ça passait ; dès que la carte calcule
 * (régler une dette, ajouter une dépense) l'incohérence saute aux yeux. On
 * repart donc d'un modèle exact, à total d'affichage inchangé : van à 246 €
 * avancé par « Toi », partagé en 4 → 61,50 € par personne, dont 3 dus =
 * les 184,50 € d'origine.
 */
const INITIAL_DEBT_AMOUNT = 61.5;

const INITIAL_DEBTS: Record<Debtor, DebtState> = {
  Karim: { amount: INITIAL_DEBT_AMOUNT, settled: false },
  Léa: { amount: INITIAL_DEBT_AMOUNT, settled: false },
  Thomas: { amount: INITIAL_DEBT_AMOUNT, settled: false },
};

/** Dépense d'exemple insérée par le bouton d'ajout, partagée entre les débiteurs + Toi. */
const ADDED_EXPENSE = { label: 'Essence', amount: 42 };
const ADDED_EXPENSE_SHARE = ADDED_EXPENSE.amount / (DEBTORS.length + 1);

/** Dégradé d'ambre du mockup : une nuance par débiteur, la plus pâle pour « Toi ». */
const DEBTOR_SEGMENT_COLOR: Record<Debtor, string> = {
  Karim: '#F59E0B',
  Léa: 'rgba(245,158,11,.6)',
  Thomas: 'rgba(245,158,11,.3)',
};
const TOI_SEGMENT_COLOR = 'rgba(245,158,11,.15)';

function formatEuro(amount: number): string {
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function ExpensesCard() {
  const m = LX_MODULE.expenses;
  const [debts, setDebts] = useState<Record<Debtor, DebtState>>(INITIAL_DEBTS);
  /** Part de « Toi » dans le pot commun — jamais due, sert au 4e segment de la barre. */
  const [toiShare, setToiShare] = useState(INITIAL_DEBT_AMOUNT);
  /**
   * Déplié par défaut : le mockup statique montrait les trois lignes en
   * clair. Les cacher derrière un clic ferait perdre de l'information au
   * visiteur qui ne joue pas avec la carte — le cas majoritaire sur une
   * landing. Replier reste possible, mais ce n'est pas l'état de repos.
   */
  const [expanded, setExpanded] = useState(true);

  /** Régler/annuler est symétrique : le montant reste, seul le « dû » bouge. */
  const toggleSettled = (person: Debtor) => {
    setDebts((prev) => ({
      ...prev,
      [person]: { ...prev[person], settled: !prev[person].settled },
    }));
  };

  /**
   * Insère la dépense d'exemple, répartie entre les 3 débiteurs + Toi. Une
   * dette déjà réglée redevient active : une nouvelle charge est ajoutée,
   * elle n'est pas déjà payée.
   */
  const addExpense = () => {
    setDebts((prev) => {
      const next = { ...prev };
      for (const person of DEBTORS) {
        next[person] = { amount: next[person].amount + ADDED_EXPENSE_SHARE, settled: false };
      }
      return next;
    });
    setToiShare((prev) => prev + ADDED_EXPENSE_SHARE);
  };

  const totalDue = DEBTORS.reduce((sum, p) => sum + (debts[p].settled ? 0 : debts[p].amount), 0);

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
            {formatEuro(totalDue)}
          </span>
        </div>
        <button
          type="button"
          className="nx-card-btn"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? 'Masquer le détail de la répartition'
              : 'Afficher le détail de la répartition'
          }
          onClick={() => setExpanded((e) => !e)}
          style={{
            display: 'block',
            width: '100%',
            // Le rail ne fait que 7px de haut (design d'origine) : le padding
            // porte la cible de clic à 25px, au-dessus du plancher de 24px de
            // la SC 2.5.8 (WCAG 2.2). La marge compense d'autant pour ne pas
            // décaler le rythme vertical de la carte.
            margin: '3px 0 0',
            padding: '9px 0',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              display: 'flex',
              gap: 4,
              height: 7,
              borderRadius: 99,
              overflow: 'hidden',
              background: 'rgba(255,255,255,.07)',
            }}
          >
            {DEBTORS.map((person) => (
              <span
                key={person}
                style={{
                  flex: debts[person].amount,
                  background: DEBTOR_SEGMENT_COLOR[person],
                  // Une part réglée sort du total dû : elle doit s'effacer de
                  // la barre, sinon le montant change sans que la barre bouge.
                  opacity: debts[person].settled ? 0.2 : 1,
                  transition: 'opacity .2s ease',
                }}
              />
            ))}
            <span style={{ flex: toiShare, background: TOI_SEGMENT_COLOR }} />
          </span>
        </button>
        {expanded && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 14,
              marginTop: 3,
              fontSize: 12,
              color: 'rgba(255,255,255,.55)',
            }}
          >
            {DEBTORS.map((person) => {
              const { amount, settled } = debts[person];
              return (
                <button
                  key={person}
                  type="button"
                  className="nx-card-btn"
                  // Le barré et l'opacité ne disent « réglé » qu'à l'œil :
                  // `aria-pressed` porte le même état au lecteur d'écran, et
                  // `title` explique l'action à la souris (le texte seul ne
                  // laisse pas deviner qu'il est cliquable).
                  aria-pressed={settled}
                  title={settled ? 'Annuler le règlement' : 'Marquer comme réglé'}
                  onClick={() => toggleSettled(person)}
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    color: 'rgba(255,255,255,.55)',
                    textDecoration: settled ? 'line-through' : 'none',
                    opacity: settled ? 0.5 : 1,
                  }}
                >
                  {person} te doit <b style={{ color: m.text }}>{formatEuro(amount)}</b>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          className="nx-card-btn"
          onClick={addExpense}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
            padding: '6px 0 0',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
            fontWeight: 600,
            color: m.text,
          }}
        >
          + Ajouter {ADDED_EXPENSE.label} · {formatEuro(ADDED_EXPENSE.amount)}
        </button>
      </div>
    </TiltCard>
  );
}
