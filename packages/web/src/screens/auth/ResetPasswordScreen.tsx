/**
 * ResetPasswordScreen — finalise le parcours « mot de passe oublié »
 * (MAN-166, Phase 1 Task 6 de MAN-171).
 *
 * Atterrit ici via le lien envoyé par `ForgotPasswordScreen`
 * (`/reset-password?token=...`). Le token est lu directement dans l'URL
 * (comme `?invite=` dans `RegisterScreen`/`LoginScreen`) plutôt que via un
 * schéma de recherche TanStack Router : cette route n'a pas besoin de
 * typer ses query params ailleurs, et ça évite d'étendre le contrat de
 * route pour un seul champ.
 *
 * Le backend ne distingue pas token invalide / expiré / déjà utilisé (un
 * seul code `AUTH_RESET_TOKEN_INVALID` pour l'instant, cf. MAN-166 — décision
 * de sécurité délibérée, pas un manque : distinguer les sous-catégories
 * réintroduirait un oracle d'énumération) — le message reste donc générique.
 * Sur ce code précis, Phase 3 (MAN-173) ajoute un CTA direct vers
 * `/forgot-password` : plutôt qu'un renvoi générique vers la connexion, on
 * raccourcit le chemin pour redemander un lien.
 */
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button, Input, Logo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NX } from '@/lib/tokens';

import { AUTH_LINK_BUTTON_CLASS, AuthShell } from './AuthShell';

const GENERIC_ERROR = "Ce lien n'est plus valable";

export function ResetPasswordScreen() {
  const navigate = useNavigate();
  const resetPassword = useAuth((s) => s.resetPassword);
  const token =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<{
    password?: string | undefined;
    confirmPassword?: string | undefined;
    form?: string | undefined;
  }>({});
  const [loading, setLoading] = useState(false);
  // Distingue le cas « lien inutilisable » (message générique + CTA de
  // redemande, MAN-173) des autres échecs (message générique seul). Remis à
  // zéro à chaque soumission : un échec de validation locale (mot de passe
  // trop court) ou une panne serveur ne doivent pas hériter du CTA laissé par
  // une tentative précédente — le problème n'est alors plus le lien.
  const [tokenInvalid, setTokenInvalid] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenInvalid(false);
    const errs: typeof errors = {};
    if (!password) errs.password = 'Mot de passe requis';
    else if (password.length < 12) errs.password = 'Minimum 12 caractères';
    if (!confirmPassword) errs.confirmPassword = 'Confirmation requise';
    else if (confirmPassword !== password) {
      errs.confirmPassword = 'Les mots de passe ne correspondent pas';
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    if (!token) {
      // Lien tronqué/mal copié : pas de `?token=` du tout. C'est bien un
      // problème de lien → même message générique et même CTA que le jeton
      // rejeté par le backend (aucune information supplémentaire divulguée).
      setTokenInvalid(true);
      setErrors({ form: GENERIC_ERROR });
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      void navigate({ to: '/login', search: { reset: 'success' } as never });
    } catch (err) {
      setTokenInvalid(err instanceof ApiError && err.code === 'AUTH_RESET_TOKEN_INVALID');
      setErrors({ form: GENERIC_ERROR });
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
          Nouveau mot de passe
        </h1>
        <p style={{ fontSize: 14, color: NX.fgMuted, marginTop: 6 }}>
          Choisis un nouveau mot de passe pour ton compte
        </p>
      </div>

      <form
        onSubmit={(e) => void submit(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <Input
          label="Nouveau mot de passe"
          type="password"
          name="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((p) => ({ ...p, password: undefined, form: undefined }));
          }}
          error={errors.password}
          placeholder="Minimum 12 caractères"
          autoFocus
          autoComplete="new-password"
        />
        <Input
          label="Confirmer le mot de passe"
          type="password"
          name="confirmPassword"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setErrors((p) => ({ ...p, confirmPassword: undefined, form: undefined }));
          }}
          error={errors.confirmPassword}
          placeholder="Retape le mot de passe"
          autoComplete="new-password"
        />

        {errors.form && (
          <div style={{ fontSize: 12, color: NX.error, textAlign: 'center' }}>{errors.form}</div>
        )}

        {/*
          Adossé à `errors.form` : le CTA naît et meurt avec le message qui
          l'explique (les `onChange` des deux champs effacent `form`).
        */}
        {errors.form && tokenInvalid && (
          <div style={{ textAlign: 'center' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate({ to: '/forgot-password' })}
              className={`${AUTH_LINK_BUTTON_CLASS} text-[13px] font-semibold`}
            >
              Demander un nouveau lien
            </Button>
          </div>
        )}

        <Button type="submit" loading={loading} fullWidth size="lg">
          Réinitialiser le mot de passe
        </Button>
      </form>
    </AuthShell>
  );
}
