import type { FastifyInstance } from 'fastify';

/**
 * Un utilisateur enregistré via `POST /auth/register`, avec son access token
 * prêt à l'emploi pour `auth()`.
 */
export interface AuthedUser {
  id: string;
  email: string;
  accessToken: string;
}

/** Une notification telle que `GET /notifications` la renvoie. */
export interface NotificationSummary {
  id: string;
  kind: string;
  groupId: string | null;
  readAt: string | null;
}

/**
 * Header `Authorization` prêt à passer dans `headers` d'un `app.inject()`.
 *
 * Fonction pure — pas de dépendance à l'instance Fastify —, exportée à part
 * de {@link createHttpHelpers} pour les helpers de test définis hors du
 * `describe` (donc sans closure sur `app`) qui n'ont besoin que de ça.
 *
 * @example const res = await app.inject({ method: 'GET', url: '/...', headers: auth(alice) });
 */
export function auth(u: AuthedUser): { authorization: string } {
  return { authorization: `Bearer ${u.accessToken}` };
}

/**
 * Forme renvoyée par {@link createHttpHelpers} — un helper par aller-retour
 * HTTP courant des tests d'intégration. `auth` n'y figure pas : c'est une
 * fonction pure, importée directement comme export nommé (cf. plus haut) par
 * les helpers de test définis hors `describe`, sans passer par la fabrique.
 */
export interface HttpHelpers {
  /** cf. {@link createHttpHelpers} */
  registerUser: (email: string) => Promise<AuthedUser>;
  /** cf. {@link createHttpHelpers} */
  makeGroup: (owner: AuthedUser, name: string) => Promise<string>;
  /** cf. {@link createHttpHelpers} */
  joinGroup: (
    owner: AuthedUser,
    groupId: string,
    joiner: AuthedUser,
    role?: 'member' | 'admin',
  ) => Promise<void>;
  /** cf. {@link createHttpHelpers} */
  leaveGroup: (u: AuthedUser, groupId: string) => Promise<void>;
  /** cf. {@link createHttpHelpers} */
  listNotifs: (u: AuthedUser) => Promise<{
    notifications: NotificationSummary[];
    unreadCount: number;
  }>;
}

/**
 * Fabrique de helpers HTTP pour les tests d'intégration backend qui montent
 * un vrai serveur (`buildServer()` + `setupTestDb()`, cf. `test/db.ts`).
 *
 * Ces helpers recopiaient à l'identique `registerUser`/`auth`/`makeGroup`/
 * `joinGroup`/`leaveGroup` dans plusieurs fichiers (cf. ticket `b2bbb0cd`) ;
 * `createHttpHelpers(app)` centralise ces aller-retours `app.inject()` pour
 * qu'une évolution de l'API d'inscription ou d'invitation ne demande de
 * retoucher qu'un seul fichier.
 *
 * @example
 * let app: FastifyInstance;
 * let http: HttpHelpers;
 * beforeAll(async () => {
 *   // ... setupTestDb, buildServer ...
 *   http = createHttpHelpers(app);
 * });
 * const { registerUser, makeGroup, joinGroup } = http;
 * const alice = await registerUser('alice@ex.com');
 * const bob = await registerUser('bob@ex.com');
 * const groupId = await makeGroup(alice, 'Les copains');
 * await joinGroup(alice, groupId, bob);
 */
export function createHttpHelpers(app: FastifyInstance): HttpHelpers {
  /**
   * Inscrit un nouvel utilisateur (`POST /auth/register`) et renvoie son
   * access token.
   *
   * @example const alice = await registerUser('alice@ex.com');
   */
  async function registerUser(email: string): Promise<AuthedUser> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'a-very-long-password-x',
        displayName: email.split('@')[0] ?? 'user',
      },
    });
    if (res.statusCode !== 200) {
      throw new Error(`registerUser ${email}: ${res.statusCode} ${res.body}`);
    }
    const body = res.json<{ user: { id: string; email: string }; accessToken: string }>();
    return { id: body.user.id, email: body.user.email, accessToken: body.accessToken };
  }

  /**
   * Crée un groupe dont `owner` devient le créateur/owner.
   *
   * @example const groupId = await makeGroup(alice, 'Les copains');
   */
  async function makeGroup(owner: AuthedUser, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: auth(owner),
      payload: { name },
    });
    if (res.statusCode !== 200) throw new Error(`makeGroup: ${res.statusCode} ${res.body}`);
    return res.json<{ group: { id: string } }>().group.id;
  }

  /**
   * Fait rejoindre `joiner` à `groupId` : `owner` crée une invitation
   * (`role`, `member` par défaut) que `joiner` accepte aussitôt.
   *
   * @example await joinGroup(alice, groupId, bob); // member
   * @example await joinGroup(alice, groupId, bob, 'admin');
   */
  async function joinGroup(
    owner: AuthedUser,
    groupId: string,
    joiner: AuthedUser,
    role: 'member' | 'admin' = 'member',
  ): Promise<void> {
    const invRes = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/invitations`,
      headers: auth(owner),
      payload: { role },
    });
    if (invRes.statusCode !== 200) {
      throw new Error(`joinGroup (invitation): ${invRes.statusCode} ${invRes.body}`);
    }
    const inv = invRes.json<{ invitation: { slug: string } }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invitations/${inv.invitation.slug}/accept`,
      headers: auth(joiner),
    });
    if (res.statusCode !== 200) throw new Error(`joinGroup: ${res.statusCode} ${res.body}`);
  }

  /**
   * Fait quitter `groupId` à `u` (self-leave — le chemin le plus permissif,
   * ouvert à tout member inconditionnellement).
   *
   * @example await leaveGroup(bob, groupId);
   */
  async function leaveGroup(u: AuthedUser, groupId: string): Promise<void> {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}/members/${u.id}`,
      headers: auth(u),
    });
    if (res.statusCode !== 200) throw new Error(`leaveGroup: ${res.statusCode} ${res.body}`);
  }

  /**
   * Toutes les notifications de `u`, telles que la cloche les lit.
   *
   * @example const { notifications, unreadCount } = await listNotifs(bob);
   */
  async function listNotifs(
    u: AuthedUser,
  ): Promise<{ notifications: NotificationSummary[]; unreadCount: number }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: auth(u),
    });
    if (res.statusCode !== 200) throw new Error(`notifications: ${res.statusCode} ${res.body}`);
    return res.json<{ notifications: NotificationSummary[]; unreadCount: number }>();
  }

  return { registerUser, makeGroup, joinGroup, leaveGroup, listNotifs };
}
