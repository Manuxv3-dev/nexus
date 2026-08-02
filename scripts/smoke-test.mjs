#!/usr/bin/env node
/**
 * Smoke test end-to-end de l'API Nexus en prod (cf. tâche #8).
 *
 * Exerce le happy-path complet des features killer sur un backend live :
 * health, auth, groups, events + RSVP, polls + vote, expenses + settle,
 * todos + check, et les 4 pages publiques. Chaque étape échoue bruyamment
 * (exit code 1) si le contrat n'est pas respecté.
 *
 * Usage :
 *   node scripts/smoke-test.mjs
 *   API_BASE=https://api.nexusapp.chat/api/v1 node scripts/smoke-test.mjs
 *   SMOKE_EMAIL=smoke@nexusapp.chat SMOKE_PASSWORD='...' node scripts/smoke-test.mjs
 *
 * Si SMOKE_EMAIL + SMOKE_PASSWORD sont fournis, le script LOGIN sur ce
 * compte dédié (recommandé en prod pour ne pas créer d'users jetables).
 * Sinon il REGISTER un user éphémère (laisse une trace en base — à éviter
 * en prod répété).
 *
 * Le groupe créé est supprimé en fin de run (cascade events/polls/expenses/
 * todos), que le run réussisse ou échoue, pour ne pas polluer la prod. Le
 * 2e user éphémère créé pour le test WS multi-user s'auto-supprime
 * (`DELETE /auth/me`) en fin d'étape, pour la même raison.
 *
 * Couvre aussi le push WebSocket multi-user (cf. MAN-17) : un 2e user
 * rejoint le groupe, ouvre une connexion WS, et doit recevoir en live le
 * RSVP changé par le 1er user.
 *
 * Ne couvre PAS (vérif manuelle requise, cf. MAN-17) :
 *   - desktop Windows : login, WS, webviews providers, banner updater
 *   - worker BullMQ rappels d'events (timing h24/h1 — couvert séparément
 *     par un test d'intégration, cf. packages/backend/src/workers)
 */

const API_BASE = (process.env.API_BASE ?? 'https://api.nexusapp.chat/api/v1').replace(/\/$/, '');
const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? null;
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? null;

let accessToken = null;
let createdGroupId = null;
let pass = 0;

// ─────────────────────────── HTTP helpers ────────────────────────────────

async function api(method, path, { body, auth = true, raw = false, token = null } = {}) {
  const headers = {};
  // Ne poser content-type QUE s'il y a un body — le backend rejette un body
  // vide avec content-type application/json (VALIDATION_ERROR).
  if (body !== undefined) headers['content-type'] = 'application/json';
  // `token` permet d'appeler l'API en tant qu'un autre user que le global
  // `accessToken` (cf. étape WS multi-user, qui jongle avec 2 users).
  const bearer = token ?? accessToken;
  if (auth && bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
  }
  return raw ? text : json;
}

function assert(cond, label) {
  if (!cond) throw new Error(`Assertion échouée : ${label}`);
  pass += 1;
  console.log(`  ✓ ${label}`);
}

function step(name) {
  console.log(`\n▸ ${name}`);
}

// ───────────────────────────── WS helpers ────────────────────────────────
// Node 22+ expose `WebSocket` en global (pas d'import du package `ws`).

function wsUrl(token) {
  const origin = API_BASE.replace(/\/api\/v1\/?$/, '');
  const wsOrigin = origin.replace(/^http/, 'ws');
  return `${wsOrigin}/ws?token=${encodeURIComponent(token)}`;
}

function waitForWsOpen(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout ouverture WS')), timeoutMs);
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('WS error à l’ouverture'));
      },
      { once: true },
    );
  });
}

function waitForWsMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout (${timeoutMs}ms) en attente du message WS attendu`));
    }, timeoutMs);
    function cleanup() {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    }
    function onMessage(ev) {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        cleanup();
        resolve(msg);
      }
    }
    // Sans ça, un socket qui se ferme prématurément (crash serveur, réseau)
    // brûle tout le timeout avant de faire échouer le test avec un message
    // trompeur ("timeout" au lieu de "socket fermé").
    function onClose(ev) {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`WS fermé avant réception du message attendu (code ${ev.code})`));
    }
    function onError() {
      clearTimeout(timer);
      cleanup();
      reject(new Error('WS error en attente du message'));
    }
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  });
}

// ─────────────────────────── Scénario ────────────────────────────────────

async function run() {
  console.log(`Nexus smoke test → ${API_BASE}`);

  step('Health');
  const health = await api('GET', '/health', { auth: false });
  assert(health != null, 'GET /health répond');

  step('Auth');
  let me;
  if (SMOKE_EMAIL && SMOKE_PASSWORD) {
    const login = await api('POST', '/auth/login', {
      auth: false,
      body: { email: SMOKE_EMAIL, password: SMOKE_PASSWORD, deviceId: 'smoke-test' },
    });
    accessToken = login.accessToken;
    me = login.user;
    assert(accessToken && me?.id, `login OK (${me.email})`);
  } else {
    const email = `smoke+${Date.now()}@nexus-smoke.test`;
    const password = `Sm0ke-${Date.now()}-pwd!`;
    const reg = await api('POST', '/auth/register', {
      auth: false,
      body: { email, password, displayName: 'Smoke Test' },
    });
    accessToken = reg.accessToken;
    me = reg.user;
    assert(accessToken && me?.id, `register éphémère OK (${email})`);
  }
  const userId = me.id;

  step('Groups');
  const grp = await api('POST', '/groups', { body: { name: `Smoke ${Date.now()}` } });
  createdGroupId = grp.group.id;
  assert(createdGroupId, 'POST /groups crée un groupe');
  const groups = await api('GET', '/groups');
  assert(
    groups.groups.some((g) => g.id === createdGroupId),
    'GET /groups liste le nouveau groupe',
  );

  step('Events + RSVP');
  const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const ev = await api('POST', `/groups/${createdGroupId}/events`, {
    body: { title: 'Smoke event', startsAt, location: 'CI' },
  });
  const eventId = ev.event.id;
  const eventSlug = ev.event.slug;
  assert(eventId && eventSlug, 'POST event crée un event avec slug');
  await api('POST', `/events/${eventId}/rsvp`, { body: { value: 'yes' } });
  const evAfter = await api('GET', `/events/${eventId}`);
  assert(
    evAfter.event.rsvps.some((r) => r.userId === userId && r.value === 'yes'),
    'RSVP yes enregistré',
  );

  step('WS push multi-user');
  {
    // Un 2e user rejoint le groupe, ouvre une connexion WS, et doit
    // recevoir en live la mutation RSVP faite par le 1er user (cf. MAN-17 —
    // zone non couverte jusqu'ici par le smoke test). C'est aussi le garde-
    // fou de non-régression pour `invalidateGroup()` (ws/membership-cache.ts) :
    // sans lui, le cache d'audience du relay WS (TTL 5 min) ne verrait pas
    // le nouveau membre et cette étape timeout.
    //
    // `token2` suit le token valide le plus récent pour user2, pour que la
    // suppression en `finally` marche même si le run échoue avant le refresh.
    let token2 = null;
    try {
      const email2 = `smoke2+${Date.now()}@nexus-smoke.test`;
      const password2 = `Sm0ke2-${Date.now()}-pwd!`;
      const reg2 = await api('POST', '/auth/register', {
        auth: false,
        body: { email: email2, password: password2, displayName: 'Smoke Test 2' },
      });
      assert(reg2.accessToken && reg2.user?.id, `register user2 éphémère OK (${email2})`);
      token2 = reg2.accessToken;

      // Scope au strict nécessaire (1 usage, 1 min) : c'est un lien
      // d'invitation vivant contre la prod, autant limiter la casse si le
      // cleanup échoue derrière.
      const inv = await api('POST', `/groups/${createdGroupId}/invitations`, {
        body: { maxUses: 1, ttlMs: 60_000 },
      });
      assert(inv.invitation?.slug, 'POST invitation crée un lien (role member, 1 usage, 1 min)');

      await api('POST', `/invitations/${inv.invitation.slug}/accept`, { token: token2 });

      // La 1ère accessToken de user2 a été signée AVANT qu'il rejoigne le
      // groupe — pas strictement requis pour recevoir ce RSVP (le relay WS
      // résout l'audience via `getGroupMembers()`, pas via les `groupIds` du
      // JWT — seule `broadcastPresence` les lit), mais un client réel
      // rafraîchit son token après avoir rejoint un groupe, donc on
      // reproduit ce comportement ici plutôt que de s'appuyer sur un détail
      // d'implémentation du relay.
      const refreshed2 = await api('POST', '/auth/refresh', {
        auth: false,
        body: { refreshToken: reg2.refreshToken },
      });
      assert(
        refreshed2.accessToken,
        'refresh user2 renvoie un accessToken à jour (groupIds inclus)',
      );
      token2 = refreshed2.accessToken;

      const ws = new WebSocket(wsUrl(token2));
      try {
        await waitForWsOpen(ws);

        const pushPromise = waitForWsMessage(
          ws,
          (msg) => msg.type === 'event:rsvp' && msg.payload?.eventId === eventId,
        );
        // Mutation par user1 pendant que user2 écoute activement.
        await api('POST', `/events/${eventId}/rsvp`, { body: { value: 'maybe' } });
        const pushed = await pushPromise;
        assert(
          pushed.payload.userId === userId && pushed.payload.value === 'maybe',
          'user2 reçoit le RSVP de user1 en live via WS',
        );
      } finally {
        ws.close();
      }
    } finally {
      // Auto-suppression : évite de laisser un user éphémère orphelin en
      // prod à chaque run (le groupe, lui, est nettoyé par `cleanup()`).
      if (token2) {
        await api('DELETE', '/auth/me', { token: token2 }).catch((err) => {
          console.warn(`⚠ cleanup user2 échoué : ${err.message}`);
        });
      }
    }
  }

  step('Polls + vote');
  const poll = await api('POST', `/groups/${createdGroupId}/polls`, {
    body: { question: 'Smoke poll ?', options: ['A', 'B'] },
  });
  const pollId = poll.poll.id;
  const pollSlug = poll.poll.slug;
  const optionA = poll.poll.options[0].id;
  assert(pollId && optionA, 'POST poll crée un poll avec 2 options');
  await api('POST', `/polls/${pollId}/vote`, { body: { optionId: optionA, value: true } });
  const pollAfter = await api('GET', `/polls/${pollId}`);
  assert(
    pollAfter.poll.options.find((o) => o.id === optionA)?.voters.includes(userId),
    'vote enregistré sur option A',
  );

  step('Expenses + settle');
  const exp = await api('POST', `/groups/${createdGroupId}/expenses`, {
    body: {
      description: 'Smoke expense',
      amountCents: 1000,
      currency: 'EUR',
      paidBy: userId,
      shares: [{ userId, shareCents: 1000 }],
    },
  });
  const expenseId = exp.expense.id;
  const expenseSlug = exp.expense.slug;
  assert(expenseId, 'POST expense crée une dépense');
  await api('POST', `/expenses/${expenseId}/settle`, { body: { settled: true } });
  const expAfter = await api('GET', `/expenses/${expenseId}`);
  assert(
    expAfter.expense.shares.some((s) => s.userId === userId && s.isSettled === true),
    'part personnelle marquée settled',
  );

  step('Todos + check');
  const list = await api('POST', `/groups/${createdGroupId}/todo-lists`, {
    body: { title: 'Smoke list' },
  });
  const listId = list.todoList.id;
  const todoSlug = list.todoList.slug;
  assert(listId, 'POST todo-list crée une liste');
  const item = await api('POST', `/todo-lists/${listId}/items`, { body: { text: 'Smoke item' } });
  const itemId = item.todoItem.id;
  assert(itemId, 'POST item ajoute un item');
  const checked = await api('PATCH', `/todo-items/${itemId}`, { body: { done: true } });
  assert(checked.todoItem.done === true, 'item coché');

  step('Pages publiques');
  await api('GET', `/public/events/${eventSlug}`, { auth: false });
  assert(true, `GET /public/events/${eventSlug}`);
  await api('GET', `/public/polls/${pollSlug}`, { auth: false });
  assert(true, `GET /public/polls/${pollSlug}`);
  await api('GET', `/public/expenses/${expenseSlug}`, { auth: false });
  assert(true, `GET /public/expenses/${expenseSlug}`);
  await api('GET', `/public/todos/${todoSlug}`, { auth: false });
  assert(true, `GET /public/todos/${todoSlug}`);
}

async function cleanup() {
  if (!createdGroupId || !accessToken) return;
  try {
    await api('DELETE', `/groups/${createdGroupId}`);
    console.log(`\n🧹 Groupe ${createdGroupId} supprimé (cascade).`);
  } catch (err) {
    console.warn(`\n⚠ cleanup groupe échoué : ${err.message}`);
  }
}

run()
  .then(async () => {
    await cleanup();
    console.log(`\n✅ Smoke test OK — ${pass} assertions passées.`);
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n❌ Smoke test ÉCHEC :\n${err.message}`);
    await cleanup();
    process.exit(1);
  });
