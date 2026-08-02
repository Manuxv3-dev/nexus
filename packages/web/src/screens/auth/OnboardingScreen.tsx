import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAcceptInvitation, useCreateGroup } from '@/lib/queries';
import { NX } from '@/lib/tokens';

import { AuthShell } from './AuthShell';

type Choice = 'create' | 'join' | null;

export function OnboardingScreen() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const createGroup = useCreateGroup();
  const acceptInvitation = useAcceptInvitation();

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const userName = user?.displayName ?? 'toi';

  const handleAvatarFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setAvatarPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const submitChoice = async () => {
    setError('');
    if (choice === 'create' && !groupName.trim()) return;
    if (choice === 'join' && !joinCode.trim()) return;
    if (!choice) return;
    setBusy(true);
    try {
      if (choice === 'create') {
        await createGroup.mutateAsync({ name: groupName.trim() });
      } else {
        // Accepte le slug brut OU une URL d'invitation type https://nexusapp.chat/invite/<slug>
        const slug = joinCode.trim().split('/').filter(Boolean).pop() ?? joinCode.trim();
        await acceptInvitation.mutateAsync(slug);
      }
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Une erreur est survenue. Réessaie.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      {/* Progression */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 28 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: i === step ? 24 : 8,
              height: 8,
              borderRadius: 4,
              background: i <= step ? NX.primary : NX.border,
              transition: 'all 0.3s',
            }}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: NX.fg,
              }}
            >
              Bienvenue, {userName} !
            </h2>
            <p style={{ fontSize: 14, color: NX.fgMuted, marginTop: 6 }}>
              Encore 2 petites étapes et c'est parti.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              marginBottom: 28,
            }}
          >
            <label
              style={{
                width: 80,
                height: 80,
                borderRadius: 20,
                background: avatarPreview ? `url(${avatarPreview}) center/cover` : NX.primaryMuted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: avatarPreview ? 0 : 32,
                fontWeight: 800,
                color: NX.primaryText,
                border: `2px dashed ${NX.borderHover}`,
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              {!avatarPreview && userName.charAt(0).toUpperCase()}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarFile(f);
                }}
              />
            </label>
            <div style={{ fontSize: 12, color: NX.primaryText, fontWeight: 500 }}>
              Ajouter une photo
            </div>
            <div style={{ fontSize: 11, color: NX.fgDim }}>
              Optionnel — tu pourras changer plus tard
            </div>
          </div>

          <Button onClick={() => setStep(1)} fullWidth size="lg">
            Continuer
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: NX.fg,
              }}
            >
              Ton premier groupe
            </h2>
            <p style={{ fontSize: 14, color: NX.fgMuted, marginTop: 6 }}>
              Un groupe = ta bande. Tu peux en créer plusieurs.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <ChoiceCard
              icon="🚀"
              title="Créer un groupe"
              subtitle="Invite tes amis avec un lien"
              selected={choice === 'create'}
              onClick={() => setChoice('create')}
              tone="primary"
            >
              {choice === 'create' && (
                <div style={{ marginTop: 14 }}>
                  <Input
                    label="Nom du groupe"
                    name="groupName"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="La Bande du 11e"
                    autoFocus
                  />
                </div>
              )}
            </ChoiceCard>

            <ChoiceCard
              icon="🔗"
              title="Rejoindre un groupe"
              subtitle="J'ai un lien d'invitation"
              selected={choice === 'join'}
              onClick={() => setChoice('join')}
              tone="info"
            >
              {choice === 'join' && (
                <div style={{ marginTop: 14 }}>
                  <Input
                    label="Lien ou code d'invitation"
                    name="joinCode"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="nexusapp.chat/invite/..."
                    autoFocus
                  />
                </div>
              )}
            </ChoiceCard>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: NX.error, textAlign: 'center', marginBottom: 8 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setStep(0)}>
              ←
            </Button>
            <Button
              fullWidth
              size="lg"
              loading={busy}
              disabled={
                !choice ||
                (choice === 'create' && !groupName.trim()) ||
                (choice === 'join' && !joinCode.trim())
              }
              onClick={() => void submitChoice()}
            >
              {choice === 'create'
                ? 'Créer le groupe'
                : choice === 'join'
                  ? 'Rejoindre'
                  : 'Choisir une option'}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ textAlign: 'center' }}
        >
          <div
            className="animate-check-pop"
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: 'rgba(52,211,153,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke={NX.success}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: NX.fg,
            }}
          >
            C'est parti !
          </h2>
          <p
            style={{
              fontSize: 14,
              color: NX.fgMuted,
              marginTop: 8,
              lineHeight: 1.6,
              maxWidth: 320,
              margin: '8px auto 0',
            }}
          >
            {choice === 'create'
              ? `Ton groupe "${groupName}" est prêt. Partage le lien d'invitation à ta bande.`
              : 'Tu as rejoint le groupe. Tes conversations arrivent.'}
          </p>

          <div style={{ marginTop: 28 }}>
            <Button onClick={() => void navigate({ to: '/app' })} fullWidth size="lg">
              Ouvrir nexus
            </Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

interface ChoiceCardProps {
  icon: string;
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
  tone: 'primary' | 'info';
  children?: React.ReactNode;
}

function ChoiceCard({ icon, title, subtitle, selected, onClick, tone, children }: ChoiceCardProps) {
  const accent = tone === 'primary' ? NX.primaryMuted : 'rgba(96,165,250,0.1)';
  return (
    <div
      onClick={onClick}
      style={{
        padding: 18,
        borderRadius: NX.radius,
        cursor: 'pointer',
        transition: 'all 0.2s',
        background: selected ? NX.primaryMuted : NX.elevated,
        border: `1px solid ${selected ? `${NX.primary}44` : NX.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>{title}</div>
          <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
