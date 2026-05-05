/**
 * Stockage in-memory pour les killer features (events/polls/expenses/todos).
 *
 * ⚠️ STUB J4b — Pas de persistance, pas de propagation WS, pas d'invitations
 * publiques. Sera remplacé en J5 par les vraies tables Drizzle + workers
 * BullMQ pour les rappels d'événements (cf. roadmap.md).
 *
 * Indexé par groupId. Clé éphémère, perdue au redémarrage. Sert uniquement
 * à donner au front un contrat d'API cohérent.
 *
 * Cf. .agent/backlog.md → "J5 — remplacer le store in-memory killer features"
 */
import { nanoid } from 'nanoid';

// ----- Types ---------------------------------------------------------------

export type RsvpValue = 'yes' | 'maybe' | 'no';

export interface EventRecord {
  id: string;
  slug: string;
  groupId: string;
  title: string;
  description: string | null;
  startsAt: string;
  location: string | null;
  createdBy: string;
  createdAt: string;
  rsvps: Record<string, RsvpValue | null>;
}

export interface PollOption {
  id: string;
  label: string;
  voters: string[];
}

export interface PollRecord {
  id: string;
  slug: string;
  groupId: string;
  question: string;
  multi: boolean;
  closesAt: string | null;
  options: PollOption[];
  createdBy: string;
  createdAt: string;
}

export interface ExpenseRecord {
  id: string;
  slug: string;
  groupId: string;
  description: string;
  amountCents: number;
  currency: string;
  paidBy: string;
  participants: string[];
  createdAt: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  assigneeId: string | null;
}

export interface TodoListRecord {
  id: string;
  slug: string;
  groupId: string;
  title: string;
  items: TodoItem[];
  createdAt: string;
}

// ----- Indexes -------------------------------------------------------------

const eventsByGroup = new Map<string, EventRecord[]>();
const pollsByGroup = new Map<string, PollRecord[]>();
const expensesByGroup = new Map<string, ExpenseRecord[]>();
const todosByGroup = new Map<string, TodoListRecord[]>();

const eventsBySlug = new Map<string, EventRecord>();
const pollsBySlug = new Map<string, PollRecord>();
const expensesBySlug = new Map<string, ExpenseRecord>();
const todosBySlug = new Map<string, TodoListRecord>();

function ensureSeed(groupId: string): void {
  if (eventsByGroup.has(groupId)) return;
  // Seed démo aligné sur les prototypes design pour démo de bout en bout.
  const event: EventRecord = {
    id: nanoid(),
    slug: nanoid(12),
    groupId,
    title: 'Soirée chez Léa',
    description: "Amenez ce que vous voulez boire, j'ai de quoi manger pour tout le monde 🍕",
    startsAt: new Date(Date.now() + 86_400_000 * 5).toISOString(),
    location: '42 rue de la Roquette, Paris 11e',
    createdBy: 'Léa',
    createdAt: new Date().toISOString(),
    rsvps: {
      Sarah: 'yes',
      Théo: 'yes',
      Léa: 'yes',
      Manu: 'yes',
      Jules: 'maybe',
      Marie: 'no',
      Lucas: null,
      Emma: null,
    },
  };
  eventsByGroup.set(groupId, [event]);
  eventsBySlug.set(event.slug, event);

  const poll: PollRecord = {
    id: nanoid(),
    slug: nanoid(12),
    groupId,
    question: 'On mange quoi ce soir ?',
    multi: false,
    closesAt: new Date(Date.now() + 7_200_000).toISOString(),
    createdBy: 'Manu',
    createdAt: new Date().toISOString(),
    options: [
      { id: nanoid(), label: 'Pizza', voters: ['Sarah', 'Théo', 'Léa', 'Jules'] },
      { id: nanoid(), label: 'Sushi', voters: ['Manu', 'Marie'] },
      { id: nanoid(), label: 'Thaï', voters: ['Lucas'] },
      { id: nanoid(), label: 'Burger', voters: ['Emma'] },
    ],
  };
  pollsByGroup.set(groupId, [poll]);
  pollsBySlug.set(poll.slug, poll);

  const expenses: ExpenseRecord[] = [
    {
      id: nanoid(),
      slug: nanoid(12),
      groupId,
      description: 'Courses Monoprix',
      amountCents: 4850,
      currency: 'EUR',
      paidBy: 'Léa',
      participants: ['Sarah', 'Théo', 'Manu', 'Jules', 'Marie', 'Lucas', 'Emma'],
      createdAt: new Date().toISOString(),
    },
    {
      id: nanoid(),
      slug: nanoid(12),
      groupId,
      description: 'Bières + vin',
      amountCents: 3200,
      currency: 'EUR',
      paidBy: 'Manu',
      participants: ['Sarah', 'Théo', 'Léa', 'Jules'],
      createdAt: new Date().toISOString(),
    },
  ];
  expensesByGroup.set(groupId, expenses);
  for (const e of expenses) expensesBySlug.set(e.slug, e);

  const todoList: TodoListRecord = {
    id: nanoid(),
    slug: nanoid(12),
    groupId,
    title: 'Qui amène quoi samedi',
    createdAt: new Date().toISOString(),
    items: [
      { id: nanoid(), text: 'Acheter des chips', done: true, assigneeId: 'Manu' },
      { id: nanoid(), text: 'Ramener une enceinte', done: false, assigneeId: 'Théo' },
      { id: nanoid(), text: 'Préparer la playlist', done: false, assigneeId: 'Sarah' },
      { id: nanoid(), text: 'Acheter des serviettes', done: false, assigneeId: 'Jules' },
      { id: nanoid(), text: 'Vérifier la sono', done: false, assigneeId: null },
      { id: nanoid(), text: 'Prévenir les voisins', done: true, assigneeId: 'Léa' },
    ],
  };
  todosByGroup.set(groupId, [todoList]);
  todosBySlug.set(todoList.slug, todoList);
}

// ----- Accès ---------------------------------------------------------------

export function listEvents(groupId: string): EventRecord[] {
  ensureSeed(groupId);
  return eventsByGroup.get(groupId) ?? [];
}
export function listPolls(groupId: string): PollRecord[] {
  ensureSeed(groupId);
  return pollsByGroup.get(groupId) ?? [];
}
export function listExpenses(groupId: string): ExpenseRecord[] {
  ensureSeed(groupId);
  return expensesByGroup.get(groupId) ?? [];
}
export function listTodos(groupId: string): TodoListRecord[] {
  ensureSeed(groupId);
  return todosByGroup.get(groupId) ?? [];
}

export function getEventBySlug(slug: string): EventRecord | undefined {
  return eventsBySlug.get(slug);
}
export function getPollBySlug(slug: string): PollRecord | undefined {
  return pollsBySlug.get(slug);
}
export function getExpenseBySlug(slug: string): ExpenseRecord | undefined {
  return expensesBySlug.get(slug);
}
export function getTodoBySlug(slug: string): TodoListRecord | undefined {
  return todosBySlug.get(slug);
}

/**
 * Calcul des soldes — algo "minimum settlement" simplifié pour la démo.
 *
 * Prend l'ensemble des dépenses, calcule pour chacun le solde net (paid -
 * share), puis émet une liste de remboursements debtor → creditor en
 * appariant le plus gros débiteur avec le plus gros créditeur jusqu'à
 * équilibrage. Implémentation ramenée à O(n²) qui suffit pour < 50 personnes.
 *
 * À J5 : algo plus rigoureux + persistance + stratégies de simplification
 * Tricount-style.
 */
export function computeBalances(
  groupId: string,
): { from: string; to: string; amountCents: number }[] {
  const expenses = listExpenses(groupId);
  const balances = new Map<string, number>();

  for (const e of expenses) {
    if (e.participants.length === 0) continue;
    const share = Math.round(e.amountCents / e.participants.length);
    balances.set(e.paidBy, (balances.get(e.paidBy) ?? 0) + e.amountCents);
    for (const p of e.participants) {
      balances.set(p, (balances.get(p) ?? 0) - share);
    }
  }

  const settlements: { from: string; to: string; amountCents: number }[] = [];
  const entries = Array.from(balances.entries()).sort((a, b) => a[1] - b[1]);
  let i = 0;
  let j = entries.length - 1;
  while (i < j) {
    const debtor = entries[i]!;
    const creditor = entries[j]!;
    if (debtor[1] === 0) {
      i++;
      continue;
    }
    if (creditor[1] === 0) {
      j--;
      continue;
    }
    const amount = Math.min(-debtor[1], creditor[1]);
    if (amount > 0) {
      settlements.push({ from: debtor[0], to: creditor[0], amountCents: amount });
      debtor[1] += amount;
      creditor[1] -= amount;
    }
    if (debtor[1] === 0) i++;
    if (creditor[1] === 0) j--;
  }
  return settlements;
}
