import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button, Input, Logo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NX } from '@/lib/tokens';

import { AuthShell } from './AuthShell';

export function LoginScreen() {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    email?: string | undefined;
    password?: string | undefined;
    form?: string | undefined;
  }>({});
  const [loading, setLoading] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!email) errs.email = 'Email requis';
    else if (!email.includes('@')) errs.email = 'Email invalide';
    if (!password) errs.password = 'Mot de passe requis';
    if (Object.keys(errs).length) {
      setErrors(errs);
      setShakeKey((k) => k + 1);
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      // Si arrivé via lien d'invitation (?invite=<slug>), redirige vers
      // /invite/<slug> pour accepter l'invitation côté backend.
      const inviteSlug =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('invite')
          : null;
      if (inviteSlug) {
        void navigate({ to: '/invite/$slug', params: { slug: inviteSlug } });
      } else {
        void navigate({ to: '/app' });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_INVALID_CREDENTIALS') {
        setErrors({ form: 'Email ou mot de passe invalide' });
      } else {
        setErrors({ form: 'Connexion impossible. Réessaie dans un instant.' });
      }
      setShakeKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div
        style={{
          marginBottom: 32,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          color: NX.fg,
        }}
      >
        <Logo hd size={96} />
        <span
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            color: NX.fg,
          }}
        >
          nexus
        </span>
      </div>

      <form
        key={shakeKey}
        onSubmit={(e) => void submit(e)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          animation: shakeKey > 0 ? 'shake 0.3s ease' : undefined,
        }}
      >
        <Input
          label="Email"
          type="email"
          name="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((p) => ({ ...p, email: undefined }));
          }}
          error={errors.email}
          placeholder="ton@email.com"
          autoFocus
          autoComplete="email"
        />
        <Input
          label="Mot de passe"
          type="password"
          name="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((p) => ({ ...p, password: undefined }));
          }}
          error={errors.password}
          placeholder="••••••••••"
          autoComplete="current-password"
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" defaultChecked style={{ accentColor: NX.primary }} />
            <span style={{ fontSize: 12, color: NX.fgDim }}>Se souvenir de moi</span>
          </label>
          <button
            type="button"
            onClick={() => void navigate({ to: '/forgot-password' })}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 12,
              color: NX.primaryText,
              cursor: 'pointer',
            }}
          >
            Mot de passe oublié
          </button>
        </div>

        {errors.form && (
          <div style={{ fontSize: 12, color: NX.error, textAlign: 'center' }}>{errors.form}</div>
        )}

        <Button type="submit" loading={loading} fullWidth size="lg" style={{ marginTop: 4 }}>
          Se connecter
        </Button>
      </form>

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: NX.fgDim }}>
        Pas encore de compte ?{' '}
        <button
          type="button"
          onClick={() => void navigate({ to: '/register' })}
          style={{
            background: 'none',
            border: 'none',
            color: NX.primaryText,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Créer un compte
        </button>
      </div>
    </AuthShell>
  );
}
