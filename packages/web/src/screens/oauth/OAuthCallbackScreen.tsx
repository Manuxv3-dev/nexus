/**
 * OAuthCallbackScreen — page de retour OAuth pour les bridges messageries.
 *
 * Atterrit ici après que le backend a fini son boulot (échange du code,
 * création de session). Cette page :
 *  1. Lit `provider`, `sessionId`, `groupId` depuis les query params
 *  2. Si elle est ouverte en popup (`window.opener` non nul), envoie un
 *     `postMessage` au parent puis se ferme automatiquement
 *  3. Sinon (ouverte directement / popup blocker), affiche un message de
 *     succès avec un lien vers Settings
 *
 * Cette route n'utilise PAS `useAuth` parce que la popup a sa propre
 * session navigateur et peut ne pas avoir l'access token en mémoire (le
 * cookie `nexus_refresh` est partagé mais hydrater le store Zustand juste
 * pour fermer l'onglet est inutile).
 */
import { useEffect, useMemo, useState } from 'react';

import { Logo } from '@/components/ui';
import { publishBridgeConnected } from '@/lib/oauth-bus';
import { NX } from '@/lib/tokens';

export function OAuthCallbackScreen() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const provider = params.get('provider') ?? 'discord';
  const sessionId = params.get('sessionId');
  const groupId = params.get('groupId');
  const error = params.get('error');

  const [status, setStatus] = useState<'sending' | 'closed' | 'standalone' | 'error'>(
    error ? 'error' : 'sending',
  );

  useEffect(() => {
    if (error || !sessionId || !groupId) {
      setStatus('error');
      return;
    }

    // 1. Diffuse l'event sur le BroadcastChannel — tous les onglets de la
    //    même origin reçoivent, peu importe que window.opener soit null.
    publishBridgeConnected({ provider, sessionId, groupId });

    // 2. Détection mobile (no popup, full-page redirect au lieu de close).
    const isMobile = window.matchMedia('(max-width: 767.98px)').matches;
    if (isMobile) {
      // Sur mobile, l'OAuth a été lancé par window.location.href : le
      // retour est dans le même onglet. On laisse 600 ms pour que le
      // BroadcastChannel ait le temps d'être consommé par les autres
      // onglets éventuellement ouverts (App PWA en arrière-plan), puis on
      // navigue vers Settings pour fermer la boucle UX.
      const timer = window.setTimeout(() => {
        window.location.replace('/settings');
      }, 600);
      return () => window.clearTimeout(timer);
    }

    // 3. Desktop : tente de fermer la popup. Si window.close() est
    //    silencieusement rejeté (cas COOP cross-origin), on bascule en
    //    mode "standalone" pour proposer un retour manuel.
    const t = window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* noop */
      }
      window.setTimeout(() => {
        if (!window.closed) setStatus('standalone');
      }, 100);
    }, 200);
    return () => window.clearTimeout(t);
  }, [provider, sessionId, groupId, error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: NX.bg,
        color: NX.fg,
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <Logo size={40} />
        {status === 'sending' && (
          <>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 700,
                marginTop: 16,
                color: NX.fg,
              }}
            >
              Connexion {provider} confirmée
            </h1>
            <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 8, lineHeight: 1.5 }}>
              Tu peux fermer cet onglet — Nexus rafraîchit la liste des sessions tout seul.
            </p>
          </>
        )}
        {status === 'closed' && (
          <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 16 }}>
            Tu peux fermer cet onglet.
          </p>
        )}
        {status === 'standalone' && (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, marginTop: 16 }}>
              {provider.charAt(0).toUpperCase() + provider.slice(1)} connecté
            </h1>
            <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 8, lineHeight: 1.5 }}>
              Retourne sur l'onglet Nexus déjà ouvert — la liste des messageries
              s'est mise à jour toute seule. Tu peux fermer cet onglet quand tu
              veux.
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  window.close();
                } catch {
                  /* noop */
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 20,
                padding: '8px 18px',
                borderRadius: NX.radiusPill,
                background: NX.elevated,
                color: NX.fg,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${NX.border}`,
              }}
            >
              Fermer cet onglet
            </button>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, marginTop: 16, color: NX.error }}>
              Connexion impossible
            </h1>
            <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 8, lineHeight: 1.5 }}>
              {error ?? "Le retour OAuth n'a pas fourni les bons paramètres."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
