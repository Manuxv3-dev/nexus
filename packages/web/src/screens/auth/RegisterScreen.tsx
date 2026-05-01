import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { Button, Input, Logo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NX } from '@/lib/tokens';

import { AuthShell } from './AuthShell';

interface PasswordStrength {
  level: 0 | 1 | 2 | 3;
  label: string;
  color: string;
}

function evaluatePassword(password: string): PasswordStrength {
  if (password.length === 0) return { level: 0, label: '', color: 'transparent' };
  if (password.length < 12) return { level: 1, label: 'Trop court (min. 12)', color: NX.error };
  if (password.length < 16) return { level: 2, label: 'Correct', color: NX.fgDim };
  return { level: 3, label: 'Fort', color: NX.success };
}

export function RegisterScreen() {
  const navigate = useNavigate();
  const register = useAuth((s) => s.register);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    form?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => evaluatePassword(password), [password]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Comment on t'appelle ?";
    if (!email) errs.email = 'Email requis';
    else if (!email.includes('@')) errs.email = 'Email invalide';
    if (!password) errs.password = 'Mot de passe requis';
    else if (password.length < 12) errs.password = 'Minimum 12 caractères';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name.trim());
      void navigate({ to: '/onboarding' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_EMAIL_TAKEN') {
        setErrors({ email: 'Un compte existe déjà avec cet email' });
      } else {
        setErrors({ form: 'Création impossible. Réessaie.' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Logo size={40} />
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            marginTop: 16,
            color: NX.fg,
          }}
        >
          Créer ton compte
        </h1>
        <p style={{ fontSize: 14, color: NX.fgMuted, marginTop: 6 }}>Rejoins ta bande sur Nexus</p>
      </div>

      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input
          label="Prénom ou pseudo"
          name="displayName"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((p) => ({ ...p, name: undefined }));
          }}
          error={errors.name}
          placeholder="Manu"
          autoFocus
          autoComplete="name"
        />
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
          autoComplete="email"
        />
        <div>
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
            placeholder="Minimum 12 caractères"
            autoComplete="new-password"
          />
          {password.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <div
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: NX.border,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(strength.level / 3) * 100}%`,
                    background: strength.color,
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <span style={{ fontSize: 10, color: strength.color, fontWeight: 500 }}>
                {strength.label}
              </span>
            </div>
          )}
        </div>

        {errors.form && (
          <div style={{ fontSize: 12, color: NX.error, textAlign: 'center' }}>{errors.form}</div>
        )}

        <Button type="submit" loading={loading} fullWidth size="lg" style={{ marginTop: 4 }}>
          Créer mon compte
        </Button>
      </form>

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: NX.fgDim }}>
        Déjà un compte ?{' '}
        <button
          type="button"
          onClick={() => void navigate({ to: '/login' })}
          style={{
            background: 'none',
            border: 'none',
            color: NX.primaryText,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Se connecter
        </button>
      </div>
    </AuthShell>
  );
}
