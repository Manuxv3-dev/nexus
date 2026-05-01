/**
 * Bus cross-tab pour les retours OAuth bridge (Discord, Messenger, WhatsApp).
 *
 * Pourquoi BroadcastChannel plutôt que window.opener.postMessage ?
 *
 * Quand on ouvre une popup vers un domaine externe (Discord), les navigateurs
 * modernes (Chrome 88+, Firefox 79+, Safari 14+) appliquent une politique
 * Cross-Origin-Opener-Policy (COOP) "same-origin-allow-popups". Au retour
 * vers notre domaine, `window.opener` est mis à `null` pour empêcher la
 * popup de manipuler son parent. Du coup `window.opener.postMessage(...)`
 * ne fait rien et l'onglet d'origine n'est jamais notifié.
 *
 * BroadcastChannel contourne ce problème : tous les onglets/popups d'une
 * même origin partagent le même canal, indépendamment de leur relation
 * parent/enfant. Compatible Chrome 54+, Firefox 38+, Safari 15.4+, Edge 79+.
 */

const CHANNEL_NAME = 'nexus-oauth';

export interface BridgeConnectedEvent {
  type: 'nexus:bridge-connected';
  provider: string;
  sessionId: string;
  groupId: string;
}

let publishingChannel: BroadcastChannel | null = null;

/**
 * Émet un évènement de connexion bridge sur le canal partagé.
 *
 * Appelé depuis la page /oauth/callback après confirmation backend.
 * Le canal est gardé ouvert quelques centaines de millisecondes pour
 * laisser le temps aux autres onglets de recevoir, puis fermé.
 */
export function publishBridgeConnected(payload: Omit<BridgeConnectedEvent, 'type'>) {
  if (typeof BroadcastChannel === 'undefined') {
    // Fallback ancien navigateur : on tente window.opener qui peut marcher
    // dans certains cas (popup même-origine sans saut cross-origin).
    if (window.opener) {
      try {
        window.opener.postMessage(
          { type: 'nexus:bridge-connected', ...payload },
          window.location.origin,
        );
      } catch {
        /* noop */
      }
    }
    return;
  }
  publishingChannel ??= new BroadcastChannel(CHANNEL_NAME);
  const event: BridgeConnectedEvent = { type: 'nexus:bridge-connected', ...payload };
  publishingChannel.postMessage(event);
}

/**
 * S'abonne aux évènements de connexion bridge.
 *
 * Renvoie une fonction de désabonnement à appeler dans le cleanup
 * d'un useEffect.
 */
export function subscribeBridgeConnected(
  handler: (event: BridgeConnectedEvent) => void,
): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as BridgeConnectedEvent | undefined;
      if (data?.type === 'nexus:bridge-connected') handler(data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e) => {
    const data = e.data as BridgeConnectedEvent | undefined;
    if (data?.type === 'nexus:bridge-connected') handler(data);
  };

  // Garde aussi le listener message classique en filet de sécurité
  // (cas où une popup même-origine arrive à atteindre window.opener).
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const data = e.data as BridgeConnectedEvent | undefined;
    if (data?.type === 'nexus:bridge-connected') handler(data);
  };
  window.addEventListener('message', onMessage);

  return () => {
    channel.close();
    window.removeEventListener('message', onMessage);
  };
}
