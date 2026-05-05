/**
 * Templates Satori pour les images Open Graph (1200×630).
 *
 * On utilise l'API objet de Satori (JSX-like { type, props }) plutôt que du
 * vrai JSX, pour ne pas avoir à ajouter React + JSX runtime au backend.
 *
 * Subset CSS supporté par Satori (cf. https://github.com/vercel/satori) :
 *  - flexbox uniquement (pas de grid, pas de block)
 *  - subset des propriétés (pas de gap, pas de calc, pas de clamp)
 *  - `display: 'flex'` est implicite, on doit l'expliciter sur chaque div
 *
 * Palette Nexus (Neon Dusk dark) — cf. ADR-016 :
 *  - bg     #0B0F1A
 *  - surface #111827
 *  - elevated #1F2937
 *  - border #2A3344
 *  - fg     #F3F4F6
 *  - fgMuted #9CA3AF
 *  - primary #7C5CFF
 */

// Node Satori-compatible : { type, props: { children, style?, ... } }
// On laisse les `style` typés `Record<string, unknown>` pour rester simple ;
// Satori les valide à runtime.
export interface OgNode {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: OgNode | string | (OgNode | string)[];
    [key: string]: unknown;
  };
}

export type OgTemplate = OgNode;

const colors = {
  bg: '#0B0F1A',
  surface: '#111827',
  elevated: '#1F2937',
  border: '#2A3344',
  fg: '#F3F4F6',
  fgMuted: '#9CA3AF',
  fgDim: '#6B7280',
  primary: '#7C5CFF',
  primaryText: '#FFFFFF',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
} as const;

// ───────────────────────────── Helpers ───────────────────────────────────

function div(style: Record<string, unknown>, children?: OgNode['props']['children']): OgNode {
  const props: OgNode['props'] = { style: { display: 'flex', ...style } };
  if (children !== undefined) props.children = children;
  return { type: 'div', props };
}

function txt(text: string, style?: Record<string, unknown>): OgNode {
  return {
    type: 'span',
    props: { style: { display: 'flex', ...(style ?? {}) }, children: text },
  };
}

/**
 * Wrapper standard : background sombre + padding + flex column. Tout
 * template part de là pour garantir une silhouette cohérente.
 */
function shell(children: OgNode[]): OgTemplate {
  return div(
    {
      width: '100%',
      height: '100%',
      backgroundColor: colors.bg,
      flexDirection: 'column',
      padding: 60,
      fontFamily: 'Inter',
      color: colors.fg,
      position: 'relative',
    },
    [
      ...children,
      // Petit footer Nexus en bas à droite
      div(
        {
          position: 'absolute',
          bottom: 32,
          right: 60,
          flexDirection: 'row',
          alignItems: 'center',
        },
        [
          div(
            {
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: colors.primary,
              marginRight: 12,
              alignItems: 'center',
              justifyContent: 'center',
            },
            txt('N', { color: colors.primaryText, fontSize: 18, fontWeight: 700 }),
          ),
          txt('nexus', { color: colors.fgMuted, fontSize: 22, fontWeight: 700 }),
          txt('app.chat', { color: colors.fgDim, fontSize: 22 }),
        ],
      ),
    ],
  );
}

function badge(label: string, color: string, bg: string): OgNode {
  return div(
    {
      paddingTop: 8,
      paddingBottom: 8,
      paddingLeft: 16,
      paddingRight: 16,
      borderRadius: 999,
      backgroundColor: bg,
      alignItems: 'center',
      alignSelf: 'flex-start',
    },
    txt(label, { color, fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }),
  );
}

// ───────────────────────────── Templates ─────────────────────────────────

export interface EventTemplateInput {
  title: string;
  startsAt: string; // ISO
  location: string | null;
  rsvpCounts: { yes: number; maybe: number; no: number };
}

export function eventTemplate(input: EventTemplateInput): OgTemplate {
  const date = new Date(input.startsAt);
  const dateLabel = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeLabel = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return shell([
    badge('ÉVÉNEMENT', colors.primaryText, colors.primary),
    div({ marginTop: 24 }, txt(input.title, { fontSize: 64, fontWeight: 700, lineHeight: 1.1 })),
    div(
      {
        marginTop: 28,
        flexDirection: 'row',
        alignItems: 'center',
      },
      [
        txt('📅 ', { fontSize: 32 }),
        txt(`${dateLabel} · ${timeLabel}`, { fontSize: 30, color: colors.fgMuted }),
      ],
    ),
    input.location
      ? div(
          {
            marginTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
          },
          [
            txt('📍 ', { fontSize: 28 }),
            txt(input.location, { fontSize: 26, color: colors.fgMuted }),
          ],
        )
      : div({}, []),
    div(
      {
        marginTop: 40,
        flexDirection: 'row',
        alignItems: 'center',
      },
      [
        rsvpPill('oui', input.rsvpCounts.yes, colors.success),
        rsvpPill('peut-être', input.rsvpCounts.maybe, colors.warning),
        rsvpPill('non', input.rsvpCounts.no, colors.error),
      ],
    ),
  ]);
}

function rsvpPill(label: string, count: number, color: string): OgNode {
  return div(
    {
      marginRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 20,
      paddingRight: 20,
      borderRadius: 16,
      backgroundColor: colors.elevated,
      borderWidth: 2,
      borderColor: color,
      borderStyle: 'solid',
      flexDirection: 'row',
      alignItems: 'center',
    },
    [
      txt(String(count), { fontSize: 28, fontWeight: 700, color }),
      txt(` ${label}`, { fontSize: 22, color: colors.fgMuted, marginLeft: 8 }),
    ],
  );
}

export interface PollTemplateInput {
  question: string;
  multi: boolean;
  options: { label: string; voteCount: number }[];
  totalVotes: number;
  closesAt: string | null;
}

export function pollTemplate(input: PollTemplateInput): OgTemplate {
  const top = input.options.slice(0, 3);
  return shell([
    badge('SONDAGE', colors.primaryText, colors.accent),
    div(
      { marginTop: 24 },
      txt(input.question, { fontSize: 56, fontWeight: 700, lineHeight: 1.15 }),
    ),
    div(
      { marginTop: 28, flexDirection: 'column' },
      top.map((opt) => {
        const pct =
          input.totalVotes === 0 ? 0 : Math.round((opt.voteCount / input.totalVotes) * 100);
        return div(
          {
            marginBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
          },
          [
            div(
              {
                width: 460,
                height: 36,
                backgroundColor: colors.elevated,
                borderRadius: 8,
                marginRight: 16,
                position: 'relative',
              },
              div(
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${Math.max(pct, 2)}%`,
                  height: '100%',
                  backgroundColor: colors.accent,
                  borderRadius: 8,
                  opacity: 0.7,
                },
                [],
              ),
            ),
            txt(opt.label, { fontSize: 26, color: colors.fg, marginRight: 12 }),
            txt(`${pct}%`, { fontSize: 26, color: colors.fgMuted, fontWeight: 700 }),
          ],
        );
      }),
    ),
    div({ marginTop: 16, flexDirection: 'row', alignItems: 'center' }, [
      txt(`${input.totalVotes} vote${input.totalVotes > 1 ? 's' : ''}`, {
        fontSize: 22,
        color: colors.fgMuted,
      }),
      input.multi
        ? txt(' · choix multiples', { fontSize: 22, color: colors.fgMuted })
        : txt('', {}),
      input.closesAt
        ? txt(` · clôture ${formatShortDate(input.closesAt)}`, {
            fontSize: 22,
            color: colors.fgMuted,
          })
        : txt('', {}),
    ]),
  ]);
}

export interface ExpenseTemplateInput {
  description: string;
  amountCents: number;
  currency: string;
  paidByName: string;
  participantCount: number;
}

export function expenseTemplate(input: ExpenseTemplateInput): OgTemplate {
  const amount = (input.amountCents / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const perHead =
    input.participantCount === 0
      ? amount
      : (input.amountCents / 100 / input.participantCount).toLocaleString('fr-FR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return shell([
    badge('DÉPENSE PARTAGÉE', colors.primaryText, colors.warning),
    div(
      { marginTop: 24 },
      txt(input.description, { fontSize: 56, fontWeight: 700, lineHeight: 1.15 }),
    ),
    div({ marginTop: 32, flexDirection: 'row', alignItems: 'baseline' }, [
      txt(`${amount} ${input.currency}`, { fontSize: 84, fontWeight: 700, color: colors.warning }),
    ]),
    div({ marginTop: 16, flexDirection: 'row', alignItems: 'center' }, [
      txt(`payé par ${input.paidByName}`, { fontSize: 26, color: colors.fgMuted }),
      txt(` · ${perHead} ${input.currency}/personne`, {
        fontSize: 26,
        color: colors.fgMuted,
      }),
    ]),
  ]);
}

export interface TodoTemplateInput {
  title: string;
  itemsTotal: number;
  itemsDone: number;
}

export function todoTemplate(input: TodoTemplateInput): OgTemplate {
  const pct = input.itemsTotal === 0 ? 0 : Math.round((input.itemsDone / input.itemsTotal) * 100);
  return shell([
    badge('TODO', colors.primaryText, colors.success),
    div({ marginTop: 24 }, txt(input.title, { fontSize: 64, fontWeight: 700, lineHeight: 1.1 })),
    div({ marginTop: 40, flexDirection: 'column' }, [
      div(
        {
          width: 1080,
          height: 28,
          backgroundColor: colors.elevated,
          borderRadius: 14,
          marginBottom: 16,
          position: 'relative',
        },
        div(
          {
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${Math.max(pct, 2)}%`,
            height: '100%',
            backgroundColor: colors.success,
            borderRadius: 14,
          },
          [],
        ),
      ),
      div({ flexDirection: 'row', alignItems: 'center' }, [
        txt(`${input.itemsDone} / ${input.itemsTotal}`, {
          fontSize: 32,
          fontWeight: 700,
          color: colors.fg,
        }),
        txt(' tâches terminées', { fontSize: 28, color: colors.fgMuted, marginLeft: 12 }),
        txt(`  ·  ${pct}%`, {
          fontSize: 28,
          color: colors.success,
          marginLeft: 12,
          fontWeight: 700,
        }),
      ]),
    ]),
  ]);
}

// list = même rendu visuel qu'un todo, juste un autre badge
export function listTemplate(input: TodoTemplateInput): OgTemplate {
  const pct = input.itemsTotal === 0 ? 0 : Math.round((input.itemsDone / input.itemsTotal) * 100);
  return shell([
    badge('LISTE', colors.primaryText, colors.primary),
    div({ marginTop: 24 }, txt(input.title, { fontSize: 64, fontWeight: 700, lineHeight: 1.1 })),
    div({ marginTop: 40, flexDirection: 'column' }, [
      div(
        {
          width: 1080,
          height: 28,
          backgroundColor: colors.elevated,
          borderRadius: 14,
          marginBottom: 16,
          position: 'relative',
        },
        div(
          {
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${Math.max(pct, 2)}%`,
            height: '100%',
            backgroundColor: colors.primary,
            borderRadius: 14,
          },
          [],
        ),
      ),
      div({ flexDirection: 'row', alignItems: 'center' }, [
        txt(`${input.itemsDone} / ${input.itemsTotal}`, {
          fontSize: 32,
          fontWeight: 700,
          color: colors.fg,
        }),
        txt(' éléments', { fontSize: 28, color: colors.fgMuted, marginLeft: 12 }),
      ]),
    ]),
  ]);
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
