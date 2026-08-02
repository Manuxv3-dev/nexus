import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button, Input, Logo } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { NX } from '@/lib/tokens';

import { AUTH_LINK_BUTTON_CLASS, AuthShell } from './AuthShell';

export function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const forgot = useAuth((s) => s.forgotPassword);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email?.includes('@')) {
      setError('Email invalide');
      return;
    }
    setLoading(true);
    await forgot(email);
    setLoading(false);
    setSent(true);
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

      {!sent ? (
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
      ) : (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>Email envoyé</div>
          <div style={{ fontSize: 13, color: NX.fgMuted, marginTop: 6 }}>
            Check <strong style={{ color: NX.fg }}>{email}</strong> — le lien est valable 1h.
          </div>
        </div>
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
