import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button, Input, Logo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NX } from '@/lib/tokens';

import { AUTH_LINK_BUTTON_CLASS, AuthShell } from './AuthShell';

// Neutre à dessein (revue de code MAN-172) : le 429 peut venir du rate limit
// par IP (scope parent, ex. NAT partagé) autant que du rate limit par email —
// n'attribue la cause ni à l'utilisateur ni à une adresse précise.
const RATE_LIMIT_MESSAGE = 'Trop de demandes récentes, réessaie dans quelques minutes';

export function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const forgot = useAuth((s) => s.forgotPassword);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email?.includes('@')) {
      setError('Email invalide');
      return;
    }
    setLoading(true);
    try {
      await forgot(email);
      setSent(true);
    } catch (err) {
      // Seul le rate limit (429, MAN-172) remonte jusqu'ici : `forgotPassword`
      // masque déjà toute autre erreur pour préserver l'anti-énumération. Le
      // message reste générique (pas de mention de l'existence du compte) —
      // il ne fait qu'indiquer que le rythme des demandes a déclenché la limite.
      if (err instanceof ApiError && err.status === 429) {
        setRateLimited(true);
      } else {
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <Logo size={36} />
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            marginTop: 16,
            color: NX.fg,
          }}
        >
          Mot de passe oublié
        </h1>
        <p style={{ fontSize: 14, color: NX.fgMuted, marginTop: 6 }}>
          On t'envoie un lien de réinitialisation
        </p>
      </div>

      {sent ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>Email envoyé</div>
          <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6 }}>
            Check <strong style={{ color: NX.fg }}>{email}</strong> — le lien est valable 1h.
          </div>
        </div>
      ) : rateLimited ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>Trop de demandes</div>
          <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6 }}>{RATE_LIMIT_MESSAGE}</div>
        </div>
      ) : (
        <form
          onSubmit={(e) => void submit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <Input
            label="Email"
            type="email"
            name="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            error={error}
            placeholder="ton@email.com"
            autoFocus
          />
          <Button type="submit" loading={loading} fullWidth size="lg">
            Envoyer le lien
          </Button>
        </form>
      )}

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: NX.fgDim }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ to: '/login' })}
          className={`${AUTH_LINK_BUTTON_CLASS} text-[13px] font-semibold`}
        >
          ← Retour à la connexion
        </Button>
      </div>
    </AuthShell>
  );
}
