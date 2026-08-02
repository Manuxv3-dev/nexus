/**
 * Page d'arrivée d'un lien d'invitation `/invite/:slug`.
 *
 * Comportement :
 *  - Si user authentifié → POST /invitations/:slug/accept, redirige vers /app
 *    une fois le user ajouté au groupe.
 *  - Si user pas authentifié → redirige vers /register avec query
 *    `?invite=<slug>` (l'OnboardingScreen pré-remplit le code).
 *  - Erreur (slug invalide, expiré, déjà utilisé max) → message + bouton
 *    "Retour" vers /app ou /login.
 */
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { Button, Logo } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useAcceptInvitation } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { AuthShell } from './AuthShell';

type Status = 'pending' | 'accepting' | 'success' | 'error';

export function InviteRedirectScreen() {
  const { slug } = useParams({ from: '/invite/$slug' });
  const navigate = useNavigate();
  const { user, initializing } = useAuth();
  const accept = useAcceptInvitation();
  const [status, setStatus] = useState<Status>('pending');
  const [error, setError] = useState<string | null>(null);
  const triedRef = useRef(false);

  useEffect(() => {
    if (initializing || triedRef.current) return;
    if (!user) {
      // Stocke le slug en query et redirige vers register pour onboarding.
      triedRef.current = true;
      void navigate({ to: '/register', search: { invite: slug } as never });
      return;
    }
    triedRef.current = true;
    setStatus('accepting');
    accept
      .mutateAsync(slug)
      .then(() => {
        setStatus('success');
        window.setTimeout(() => void navigate({ to: '/app' }), 800);
      })
      .catch((err: unknown) => {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Invitation invalide ou expirée');
      });
  }, [initializing, user, slug, accept, navigate]);

  return (
    <AuthShell>
      <div style={{ color: NX.fg, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', marginBottom: 18 }}>
          <Logo size={32} />
        </div>
        {status === 'pending' || status === 'accepting' ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 500 }}>Vérification de l'invitation…</div>
            <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6 }}>
              Tu vas rejoindre le groupe dans un instant.
            </div>
          </>
        ) : status === 'success' ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 500, color: NX.success }}>
              Bienvenue dans le groupe.
            </div>
            <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6 }}>Redirection…</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, fontWeight: 500, color: NX.error }}>
              Impossible de rejoindre
            </div>
            <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6, lineHeight: 1.5 }}>
              {error ?? 'Le lien est peut-être expiré ou révoqué.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
              <Button onClick={() => void navigate({ to: '/app' })} variant="primary" size="sm">
                Retour à l'app
              </Button>
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}
