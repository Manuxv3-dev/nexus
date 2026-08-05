/**
 * Envoi d'email transactionnel via Resend (MAN-171 phase 1, MAN-166
 * « mot de passe oublié — reset complet »).
 *
 * Pas d'infra email pré-existante dans le repo avant MAN-171 : ce module en
 * pose la première brique, volontairement minimale (un seul type d'email).
 * Le client Resend est instancié PAR APPEL (lazy) plutôt qu'au chargement du
 * module : `RESEND_API_KEY` peut être absente de l'env (cf. `loadEnv`) et on
 * ne veut pas planter au chargement du module dans les environnements sans
 * email configuré (mêmes tests unitaires, workers) — seul un appel réel doit
 * échouer.
 *
 * Contrairement à `sendPushToUsers` (best-effort, erreur avalée + loguée),
 * un échec d'envoi d'email de reset ne doit JAMAIS être silencieux :
 * l'utilisateur qui a demandé un reset doit savoir que l'email n'est pas
 * parti (la route appelante doit répercuter l'échec, pas répondre 200 dans
 * le vide). L'erreur est donc à la fois loguée en warning ET relancée.
 */
import { Resend } from 'resend';

import { loadEnv } from './env.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

/**
 * Construit le corps HTML de l'email de reset de mot de passe.
 * Volontairement minimal (MVP) : pas de template engine, pas de branding
 * poussé — un lien cliquable suffit pour ce flow.
 */
function buildResetHtml(resetUrl: string): string {
  return `
    <p>Tu as demandé la réinitialisation de ton mot de passe Nexus.</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>Si tu n'es pas à l'origine de cette demande, ignore cet email : ton
    mot de passe reste inchangé.</p>
  `.trim();
}

/**
 * Envoie l'email "mot de passe oublié" à `to`, avec le lien de reset
 * `resetUrl` (généré par l'appelant — cette fonction ne connaît ni le token
 * ni son TTL, cf. `routes/auth`).
 *
 * Lève une `AppError('INTERNAL_ERROR')` — sans `details`, celles-ci étant
 * renvoyées telles quelles au client par `error-handler.ts` — si :
 * - `RESEND_API_KEY` ou `EMAIL_FROM` sont absents de l'env (config manquante,
 *   même pattern que `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` dans
 *   `routes/push/index.ts`) — le SDK Resend n'est même pas instancié dans ce
 *   cas ;
 * - Resend répond avec une erreur applicative (`{ error }` — la forme que
 *   prend le SDK pour toute erreur HTTP renvoyée par son API, clé invalide,
 *   domaine non vérifié, etc. : il ne throw PAS dans ce cas, cf. doc Resend).
 *
 * Toute erreur réseau/inattendue lancée par le SDK lui-même (fetch qui
 * échoue, DNS, timeout) remonte telle quelle à l'appelant — pas de
 * best-effort ici, contrairement au push : l'appelant (route reset) doit
 * pouvoir réagir à l'échec (retry, message d'erreur utilisateur, etc.).
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = loadEnv();
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    logger.warn(
      { reason: 'email_config_missing' },
      'email: RESEND_API_KEY or EMAIL_FROM missing — cannot send password reset email',
    );
    // Pas de `details` : `error-handler.ts` les sérialise TELLES QUELLES dans
    // le corps de la réponse HTTP. Un appelant anonyme n'a pas à apprendre
    // l'état de configuration de notre infra email. Le motif reste dans le
    // log ci-dessus, côté serveur.
    throw new AppError('INTERNAL_ERROR');
  }

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: 'Réinitialise ton mot de passe Nexus',
    html: buildResetHtml(resetUrl),
  });

  if (error) {
    // `to` n'est pas logué : c'est une donnée personnelle, et le repo évite
    // déjà de faire fuiter les emails dans les logs applicatifs (cf.
    // `emailLogHash`, routes/waitlist/index.ts). L'appelant logue l'identité
    // du compte concerné (`userId`) s'il en a besoin.
    logger.warn({ err: error }, 'email: password reset send failed');
    // `cause` passe par le 3e paramètre (options), pas par `details` : mis en
    // `details`, l'objet d'erreur Resend brut partait dans la réponse HTTP.
    throw new AppError('INTERNAL_ERROR', null, { cause: error });
  }
}
