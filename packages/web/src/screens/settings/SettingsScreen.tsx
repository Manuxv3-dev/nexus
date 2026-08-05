import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';

import {
  Avatar,
  BrandIcon,
  Logo,
  PhIcon,
  Toggle,
  type BrandKey,
  type PhIconName,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth, type LandingPreference } from '@/lib/auth';
import { subscribeBridgeConnected } from '@/lib/oauth-bus';
import { replayOnboardingTour } from '@/lib/onboardingTour';
import {
  getPushSubscriptionStatus,
  isPushSupported,
  readPushPreview,
  setPushPreview,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSubscriptionStatus,
} from '@/lib/push';
import {
  useConnectWebviewProvider,
  useDeleteMessagingSession,
  useGroups,
  useMessagingSessions,
  useNotificationPrefs,
  useUpdateNotificationPrefs,
  type NotificationPrefKey,
  type NotificationPrefs,
} from '@/lib/queries';
import { isTauri } from '@/lib/tauri';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { NX, sourceBg, sourceColor } from '@/lib/tokens';

import { GroupsSection } from './GroupsSection';
import { Card, Divider, SectionTitle } from './primitives';

type Section = 'profile' | 'notifications' | 'connections' | 'security' | 'groups';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { user, initializing, logout } = useAuth();
  const [section, setSection] = useState<Section>('profile');

  useEffect(() => {
    if (!initializing && !user) void navigate({ to: '/login' });
  }, [initializing, user, navigate]);

  const groupsQ = useGroups();

  if (initializing || !user) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: NX.bg,
        }}
      >
        <span style={{ animation: 'spinSlow 1s linear infinite', color: NX.primary }}>⟳</span>
      </div>
    );
  }

  const groupsForConnections = groupsQ.data ?? [];

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: NX.bg,
        color: NX.fg,
      }}
    >
      <aside
        style={{
          width: 240,
          background: NX.surface,
          borderRight: `1px solid ${NX.border}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 12px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => void navigate({ to: '/app' })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 6px 16px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <PhIcon name="caretLeft" size={16} color={NX.fgDim} />
          <Logo size={22} />
          <span style={{ fontSize: 14, fontWeight: 700, color: NX.fg, letterSpacing: '-0.04em' }}>
            nexus
          </span>
        </button>
        <SidebarLink
          icon="users"
          label="Profil"
          active={section === 'profile'}
          onClick={() => setSection('profile')}
        />
        {/* Toujours visible, quel que soit le rôle du viewer dans ses
            groupes — aucune condition de gating sur cet onglet (MAN-192,
            point de spec explicite). */}
        <SidebarLink
          icon="usersThree"
          label="Groupes"
          active={section === 'groups'}
          onClick={() => setSection('groups')}
        />
        <SidebarLink
          icon="bell"
          label="Notifications"
          active={section === 'notifications'}
          onClick={() => setSection('notifications')}
        />
        <SidebarLink
          icon="link"
          label="Connexions messageries"
          active={section === 'connections'}
          onClick={() => setSection('connections')}
        />
        <SidebarLink
          icon="gear"
          label="Sécurité"
          active={section === 'security'}
          onClick={() => setSection('security')}
        />
      </aside>

      <main style={{ flex: 1, overflow: 'auto' }}>
        {section === 'profile' && <ProfileSection user={user} onLogout={() => void logout()} />}
        {section === 'groups' && <GroupsSection />}
        {section === 'notifications' && (
          <NotificationsSection groupNames={groupsForConnections.map((g) => g.name)} />
        )}
        {section === 'connections' && <ConnectionsSection />}
        {section === 'security' && <SecuritySection />}
      </main>
    </div>
  );
}

function SidebarLink({
  icon,
  label,
  active,
  onClick,
}: {
  icon: PhIconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        marginBottom: 2,
        borderRadius: NX.radiusXs,
        background: active ? NX.primaryMuted : 'transparent',
        color: active ? NX.fg : NX.fgMuted,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        textAlign: 'left',
        width: '100%',
      }}
    >
      <PhIcon name={icon} size={16} color={active ? NX.primaryText : NX.fgDim} />
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: NX.fgGhost,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        padding: '16px 24px 6px',
      }}
    >
      {children}
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  desc,
  descId,
  right,
  onClick,
  danger,
}: {
  icon?: PhIconName;
  label: string;
  desc?: string;
  /** `id` posé sur la `desc`, pour qu'un contrôle de `right` la référence
   * en `aria-describedby` (cf. `Toggle`). */
  descId?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  // Si la row a un onClick → bouton plein. Sinon → div (sinon les boutons
  // dans `right` seraient imbriqués dans un <button> parent, ce qui est
  // invalide HTML et casse les clics enfants).
  const sharedStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'background 0.15s',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    width: '100%',
    color: 'inherit',
  };
  const inner = (
    <>
      {icon && <PhIcon name={icon} size={18} color={danger ? NX.error : NX.fgDim} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: danger ? NX.error : NX.fg }}>
          {label}
        </div>
        {desc && (
          <div id={descId} style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>
            {desc}
          </div>
        )}
      </div>
      {right ?? (onClick && <PhIcon name="caretRight" size={14} color={NX.fgGhost} />)}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={sharedStyle}>
        {inner}
      </button>
    );
  }
  return <div style={sharedStyle}>{inner}</div>;
}

/**
 * Sélecteur thème — connecté au store zustand `useTheme` (cf. lib/theme.ts).
 * Auto = suit prefers-color-scheme du système.
 */
function ThemeRow() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const options: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Sombre' },
    { value: 'light', label: 'Clair' },
    { value: 'auto', label: 'Auto' },
  ];
  const desc = mode === 'auto' ? 'Suit le système' : mode === 'light' ? 'Clair' : 'Sombre';
  return (
    <SettingsRow
      label="Thème"
      desc={desc}
      right={
        <div style={{ display: 'flex', gap: 4 }}>
          {options.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                style={{
                  padding: '4px 10px',
                  borderRadius: NX.radiusPill,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: active ? NX.primaryMuted : 'transparent',
                  color: active ? NX.primaryText : NX.fgDim,
                  border: 'none',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      }
    />
  );
}

// ───────── Sections ─────────

type ProfileModal = 'name' | 'email' | 'password' | 'delete' | null;

function ProfileSection({
  user,
  onLogout,
}: {
  user: { displayName: string; email: string };
  onLogout: () => void;
}) {
  const [modal, setModal] = useState<ProfileModal>(null);
  return (
    <>
      <SectionTitle title="Profil" />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px 16px 20px',
        }}
      >
        <div style={{ position: 'relative' }}>
          <Avatar name={user.displayName} size={72} />
          <div
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 24,
              height: 24,
              borderRadius: 8,
              background: NX.elevated,
              border: `2px solid ${NX.bg}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <PhIcon name="plus" size={12} color={NX.fgMuted} />
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: NX.fg, marginTop: 12 }}>
          {user.displayName}
        </div>
        <div style={{ fontSize: 12, color: NX.fgDim }}>{user.email}</div>
      </div>

      <Card>
        <SettingsRow
          icon="users"
          label="Nom d'affichage"
          desc={user.displayName}
          onClick={() => setModal('name')}
        />
        <Divider />
        <SettingsRow
          icon="chatCircle"
          label="Email"
          desc={user.email}
          onClick={() => setModal('email')}
        />
        <Divider />
        <SettingsRow
          icon="gear"
          label="Mot de passe"
          desc="Modifier"
          onClick={() => setModal('password')}
        />
      </Card>

      <SectionLabel>Apparence</SectionLabel>
      <Card>
        <ThemeRow />
      </Card>

      <SectionLabel>Démarrage</SectionLabel>
      <Card>
        <LandingPreferenceRow />
      </Card>

      <SectionLabel>Compte</SectionLabel>
      <div style={{ padding: '0 12px 24px' }}>
        <div
          style={{
            background: NX.elevated,
            borderRadius: NX.radius,
            border: `1px solid ${NX.border}`,
            overflow: 'hidden',
          }}
        >
          <SettingsRow icon="signOut" label="Se déconnecter" onClick={onLogout} />
          <Divider />
          <SettingsRow
            icon="x"
            label="Supprimer mon compte"
            danger
            onClick={() => setModal('delete')}
          />
        </div>
      </div>

      {modal === 'name' && (
        <EditNameModal current={user.displayName} onClose={() => setModal(null)} />
      )}
      {modal === 'email' && <EditEmailModal current={user.email} onClose={() => setModal(null)} />}
      {modal === 'password' && <ChangePasswordModal onClose={() => setModal(null)} />}
      {modal === 'delete' && (
        <DeleteAccountModal email={user.email} onClose={() => setModal(null)} />
      )}
    </>
  );
}

// ───────── Modal générique + champs (gestion de compte, ADR-033) ─────────

const modalFieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: NX.radiusSm,
  border: `1px solid ${NX.border}`,
  background: NX.bg,
  color: NX.fg,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: NX.elevated,
          border: `1px solid ${NX.border}`,
          borderRadius: NX.radius,
          width: '100%',
          maxWidth: 380,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: NX.fg }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: NX.fgDim,
            }}
          >
            <PhIcon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  onConfirm,
  confirmLabel,
  busy,
  danger,
  disabled,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{
          padding: '8px 14px',
          borderRadius: NX.radiusPill,
          border: `1px solid ${NX.border}`,
          background: 'transparent',
          color: NX.fgDim,
          fontSize: 12,
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        Annuler
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || disabled}
        style={{
          padding: '8px 14px',
          borderRadius: NX.radiusPill,
          border: 'none',
          background: danger ? NX.error : NX.primary,
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: busy || disabled ? 'default' : 'pointer',
          opacity: busy || disabled ? 0.6 : 1,
        }}
      >
        {busy ? '…' : confirmLabel}
      </button>
    </div>
  );
}

function ModalError({ message }: { message: string }) {
  return <div style={{ fontSize: 12, color: NX.error }}>{message}</div>;
}

function EditNameModal({ current, onClose }: { current: string; onClose: () => void }) {
  const updateProfile = useAuth((s) => s.updateProfile);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const v = value.trim();
    if (v.length < 1) {
      setErr('Le nom ne peut pas être vide.');
      return;
    }
    setBusy(true);
    setErr(null);
    void updateProfile({ displayName: v })
      .then(onClose)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Échec de la mise à jour.'))
      .finally(() => setBusy(false));
  };
  return (
    <Modal title="Nom d'affichage" onClose={onClose}>
      <input
        autoFocus
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={modalFieldStyle}
      />
      {err && <ModalError message={err} />}
      <ModalActions onCancel={onClose} onConfirm={save} confirmLabel="Enregistrer" busy={busy} />
    </Modal>
  );
}

function EditEmailModal({ current, onClose }: { current: string; onClose: () => void }) {
  const updateProfile = useAuth((s) => s.updateProfile);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const v = value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      setErr('Email invalide.');
      return;
    }
    setBusy(true);
    setErr(null);
    void updateProfile({ email: v })
      .then(onClose)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'AUTH_EMAIL_TAKEN') {
          setErr('Cet email est déjà utilisé.');
        } else {
          setErr(e instanceof Error ? e.message : 'Échec de la mise à jour.');
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <Modal title="Email" onClose={onClose}>
      <input
        autoFocus
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={modalFieldStyle}
      />
      {err && <ModalError message={err} />}
      <ModalActions onCancel={onClose} onConfirm={save} confirmLabel="Enregistrer" busy={busy} />
    </Modal>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const changePassword = useAuth((s) => s.changePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    if (next.length < 12) {
      setErr('Le nouveau mot de passe doit faire au moins 12 caractères.');
      return;
    }
    if (next !== confirm) {
      setErr('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setErr(null);
    void changePassword(current, next)
      .then(onClose)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          setErr('Mot de passe actuel incorrect.');
        } else {
          setErr(e instanceof Error ? e.message : 'Échec du changement.');
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <Modal title="Changer le mot de passe" onClose={onClose}>
      <input
        autoFocus
        type="password"
        placeholder="Mot de passe actuel"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        style={modalFieldStyle}
      />
      <input
        type="password"
        placeholder="Nouveau mot de passe (12+ caractères)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        style={modalFieldStyle}
      />
      <input
        type="password"
        placeholder="Confirmer le nouveau mot de passe"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={modalFieldStyle}
      />
      <div style={{ fontSize: 11, color: NX.fgDim }}>Les autres sessions seront déconnectées.</div>
      {err && <ModalError message={err} />}
      <ModalActions onCancel={onClose} onConfirm={save} confirmLabel="Changer" busy={busy} />
    </Modal>
  );
}

function DeleteAccountModal({ email, onClose }: { email: string; onClose: () => void }) {
  const deleteAccount = useAuth((s) => s.deleteAccount);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remove = () => {
    setBusy(true);
    setErr(null);
    // deleteAccount vide l'état auth → l'app redirige vers /login (gate).
    void deleteAccount().catch((e: unknown) => {
      setErr(e instanceof Error ? e.message : 'Échec de la suppression.');
      setBusy(false);
    });
  };
  return (
    <Modal title="Supprimer mon compte" onClose={onClose}>
      <div style={{ fontSize: 13, color: NX.fg, lineHeight: 1.5 }}>
        Cette action est <strong>irréversible</strong>. Tes groupes seront transférés au plus ancien
        autre membre, ou supprimés si tu en es le seul membre. Pour confirmer, saisis ton
        email&nbsp;:
      </div>
      <input
        autoFocus
        placeholder={email}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        style={modalFieldStyle}
      />
      {err && <ModalError message={err} />}
      <ModalActions
        onCancel={onClose}
        onConfirm={remove}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        danger
        disabled={confirm.trim().toLowerCase() !== email.toLowerCase()}
      />
    </Modal>
  );
}

/**
 * Sélecteur "Page d'arrivée" — où on atterrit après login (cf. ADR-024).
 *
 * 4 choix radio (un seul actif). Au switch on déclenche
 * `useAuth.setLandingPreference` qui PATCH /auth/me en optimiste + rollback
 * silencieux si le backend échoue.
 *
 * Note : la sémantique de chaque option est appliquée au moment du login
 * (cf. LoginScreen → resolveLandingDestination). Ici on ne fait que stocker
 * le choix.
 */
function LandingPreferenceRow() {
  const user = useAuth((s) => s.user);
  const setLandingPreference = useAuth((s) => s.setLandingPreference);
  const current: LandingPreference = user?.landingPreference ?? 'home';

  const options: { value: LandingPreference; label: string; desc: string }[] = [
    { value: 'home', label: 'Home nexus', desc: 'Feed personnel trans-groupes (défaut)' },
    { value: 'last_channel', label: 'Dernier canal', desc: 'Le dernier endroit consulté' },
    {
      value: 'last_group_first_channel',
      label: '1er canal du dernier groupe',
      desc: 'Discussions avant tout',
    },
    {
      value: 'last_group_first_feature',
      label: '1re feature du dernier groupe',
      desc: 'Direct sur les events',
    },
  ];

  const handleChange = (next: LandingPreference) => {
    if (next === current) return;
    void setLandingPreference(next).catch((err) => {
      // Rollback déjà géré dans le store ; on log juste pour debug.
      console.warn('[settings] setLandingPreference failed', err);
    });
  };

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: NX.fg, marginBottom: 4 }}>
        Page d'arrivée
      </div>
      <div style={{ fontSize: 11, color: NX.fgDim, marginBottom: 6 }}>
        Où nexus s'ouvre après ta connexion.
      </div>
      {options.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleChange(opt.value)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 10px',
              borderRadius: NX.radiusSm,
              cursor: 'pointer',
              background: active ? NX.primaryMuted : 'transparent',
              border: `1px solid ${active ? 'transparent' : NX.border}`,
              textAlign: 'left',
              transition: 'all 150ms',
            }}
          >
            <span
              aria-hidden
              style={{
                marginTop: 4,
                width: 14,
                height: 14,
                borderRadius: 7,
                border: `2px solid ${active ? NX.primary : NX.fgGhost}`,
                background: active ? NX.primary : 'transparent',
                flexShrink: 0,
                position: 'relative',
              }}
            >
              {active ? (
                <span
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    background: '#fff',
                  }}
                />
              ) : null}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: NX.fg }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 2 }}>{opt.desc}</div>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Types de notifications Nexus respectés côté serveur (cf. ADR-034).
 * Un toggle par `kind` → PATCH /notifications/preferences (optimiste). Un kind
 * désactivé ne produit plus ni notif persistée ni push WS pour ce user.
 */
const NOTIF_KINDS: { key: NotificationPrefKey; label: string; desc: string }[] = [
  {
    key: 'eventReminder',
    label: "Rappels d'événements",
    desc: 'Avant un event auquel tu participes',
  },
  {
    key: 'eventRsvpRequested',
    label: 'Invitations à répondre',
    desc: 'Quand un nouvel event attend ta réponse',
  },
  {
    key: 'eventRsvpReceived',
    label: 'Réponses à mes événements',
    desc: 'Quand on répond à un event que tu as créé',
  },
  { key: 'expenseAdded', label: 'Nouvelles dépenses', desc: 'Quand une dépense te concerne' },
  { key: 'todoAssigned', label: 'Tâches assignées', desc: "Quand une tâche t'est attribuée" },
  {
    key: 'todoCompleted',
    label: 'Tâches cochées',
    desc: 'Quand une tâche de ta liste est terminée',
  },
];

function NotificationKindsCard() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id) ?? null;
  const prefsQ = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const prefs = prefsQ.data;

  const toggle = (key: NotificationPrefKey, v: boolean) => {
    // Optimiste : on patche le cache tout de suite, rollback (refetch) si KO.
    qc.setQueryData<NotificationPrefs>(['notification-prefs', userId], (old) =>
      old ? { ...old, [key]: v } : old,
    );
    update.mutate(
      { [key]: v },
      {
        onError: () => void qc.invalidateQueries({ queryKey: ['notification-prefs', userId] }),
      },
    );
  };

  return (
    <Card>
      {NOTIF_KINDS.map((k, i, arr) => (
        <div key={k.key}>
          <SettingsRow
            label={k.label}
            desc={k.desc}
            right={<Toggle on={prefs ? prefs[k.key] : true} onChange={(v) => toggle(k.key, v)} />}
          />
          {i < arr.length - 1 && <Divider />}
        </div>
      ))}
    </Card>
  );
}

/**
 * Message affiché quand le navigateur a refusé la permission de notification.
 * Volontairement actionnable : il dit OÙ aller (les réglages du site dans le
 * navigateur), pas seulement que c'est bloqué — Nexus ne peut pas rouvrir le
 * prompt lui-même une fois la permission refusée, seul l'utilisateur le peut.
 */
const PUSH_DENIED_MESSAGE =
  'Bloqué par ton navigateur — autorise les notifications pour ce site dans ses réglages.';

/**
 * Lit `Notification.permission` sans planter si l'API `Notification` n'existe
 * pas du tout (contextes qui ne l'implémentent pas — jsdom en test, certaines
 * webviews). Distinct de `isPushSupported()` (cf. `lib/push.ts`), qui checke
 * `serviceWorker`/`PushManager` : ici on checke un pré-requis en amont, la
 * permission de notif du navigateur, refusable indépendamment du support Push.
 */
function isNotificationPermissionDenied(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'denied';
}

/**
 * État d'abonnement push affiché par `NotificationsSection`. `status` reste
 * `null` tant que la première lecture (`getPushSubscriptionStatus`) n'a pas
 * résolu — distinct de `'not-subscribed'` pour ne pas afficher le toggle à
 * OFF avant de connaître le vrai statut navigateur.
 *
 * `permissionDenied` (MAN-144) est relu à deux moments, et deux seulement —
 * les deux où il peut avoir changé sans qu'on l'apprenne autrement :
 *  - **au montage** (initialiseur paresseux, pas dans l'effet : l'état bloqué
 *    est donc peint dès le premier rendu, sans passer par « Mise à jour… ») —
 *    l'utilisateur peut avoir débloqué les notifs depuis les réglages du
 *    navigateur entre deux visites de Settings ;
 *  - **après chaque (dés)abonnement**, parce que le chemin le plus courant
 *    vers `denied` est notre propre toggle : cliquer déclenche le prompt du
 *    navigateur, que l'utilisateur peut refuser. Sans cette relecture, la
 *    ligne repasserait OFF sans un mot.
 *
 * Il n'existe pas d'événement navigateur fiable et universel pour un
 * changement de permission (`navigator.permissions.query().onchange` n'est
 * pas supporté partout) : ces deux relectures couvrent les cas réels sans
 * polling.
 *
 * Quand la permission est refusée, aucun appel à `getPushSubscriptionStatus()`
 * n'est fait : un navigateur qui refuse la permission n'a de toute façon aucun
 * abonnement push utilisable. On distingue quand même le navigateur qui ne
 * supporte pas Push du tout (`isPushSupported()`) — cf. `NotificationsSection`
 * pour la priorité des messages.
 */
function usePushToggle() {
  const [permissionDenied, setPermissionDenied] = useState(isNotificationPermissionDenied);
  const [status, setStatus] = useState<PushSubscriptionStatus | null>(() =>
    permissionDenied ? (isPushSupported() ? 'not-subscribed' : 'unsupported') : null,
  );
  const [busy, setBusy] = useState(!permissionDenied);

  useEffect(() => {
    // Permission refusée : l'état initial ci-dessus est déjà définitif, rien à
    // interroger. (Dépendance listée pour l'exhaustivité : `permissionDenied`
    // ne peut que passer à `true` en cours de vie du composant — l'effet
    // relancé sort alors immédiatement.)
    if (permissionDenied) return;

    getPushSubscriptionStatus()
      .then(setStatus)
      .catch((err: unknown) => {
        console.warn('[settings] statut abonnement push indisponible', err);
        setStatus('unsupported');
      })
      .finally(() => setBusy(false));
  }, [permissionDenied]);

  const onChange = (next: boolean) => {
    if (permissionDenied) return; // le toggle est disabled ; garde-fou défensif.
    setBusy(true);
    (next ? subscribeToPush() : unsubscribeFromPush())
      .catch((err: unknown) => {
        console.warn('[settings] échec (dés)abonnement push', err);
      })
      .then(() => getPushSubscriptionStatus())
      .then(setStatus)
      .catch((err: unknown) => {
        console.warn('[settings] statut abonnement push indisponible', err);
        setStatus('unsupported');
      })
      .finally(() => {
        setPermissionDenied(isNotificationPermissionDenied());
        setBusy(false);
      });
  };

  return { status, busy, onChange, permissionDenied };
}

function NotificationsSection({ groupNames }: { groupNames: string[] }) {
  const pushToggle = usePushToggle();
  const pushDescId = useId();
  const [sound, setSound] = useState(true);
  // Hydraté depuis le miroir local de la préférence de CET appareil (cf.
  // `readPushPreview`) et non `true` en dur : sinon le toggle repartirait à ON
  // à chaque rechargement pendant que le serveur continue d'envoyer du
  // contenu masqué — le même « mensonge silencieux » que celui qu'évite le
  // rollback de `subscribeToPush`.
  const [preview, setPreview] = useState(readPushPreview);
  const [groupPrefs, setGroupPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groupNames.map((g) => [g, true])),
  );

  const pushUnsupported = pushToggle.status === 'unsupported';
  const pushDenied = pushToggle.permissionDenied;
  // Un refus de permission force OFF quel que soit l'état d'abonnement lu côté
  // navigateur : un abonnement résiduel ne délivrera rien, l'afficher ON
  // serait un mensonge.
  const pushOn = !pushDenied && pushToggle.status === 'subscribed';

  // Préférence par APPAREIL (endpoint de la souscription push courante), pas
  // par compte — cf. `setPushPreview` (lib/push.ts). Le toggle reste
  // actionnable même si le push est OFF/non-supporté sur cet appareil : sans
  // souscription à patcher, `setPushPreview` mémorise le choix localement et
  // le prochain `subscribeToPush()` le posera sur la nouvelle souscription.
  //
  // En cas d'échec du PATCH, on REVIENT à l'état précédent : le serveur, lui,
  // n'a pas bougé, et laisser le toggle sur la nouvelle valeur ferait croire
  // que le contenu du push est masqué alors qu'il partira en clair.
  const handlePreviewChange = (next: boolean) => {
    setPreview(next);
    void setPushPreview(next).catch((err: unknown) => {
      console.warn('[settings] échec mise à jour préférence aperçu push', err);
      setPreview(!next);
    });
  };

  return (
    <>
      <SectionTitle
        title="Notifications"
        subtitle="Choisis les types de notifications Nexus que tu reçois."
      />
      <SectionLabel>Types de notifications</SectionLabel>
      <NotificationKindsCard />

      <SectionLabel>Cet appareil</SectionLabel>
      <Card>
        <SettingsRow
          icon="bell"
          label="Notifications push"
          descId={pushDescId}
          // Priorité volontaire : « non supporté » passe AVANT « bloqué ».
          // Sur un navigateur sans Push, dire « autorise les notifications
          // dans tes réglages » enverrait l'utilisateur faire une manip qui ne
          // débloquerait rien.
          desc={
            pushUnsupported
              ? 'Non supporté par ce navigateur'
              : pushDenied
                ? PUSH_DENIED_MESSAGE
                : pushToggle.busy
                  ? 'Mise à jour…'
                  : 'Recevoir des alertes pour les nouveaux messages'
          }
          right={
            <Toggle
              on={pushOn}
              onChange={pushToggle.onChange}
              ariaLabel="Notifications push"
              ariaDescribedBy={pushDescId}
              disabled={pushDenied || pushUnsupported || pushToggle.busy}
            />
          }
        />
        <Divider />
        <SettingsRow
          label="Son"
          desc="Jouer un son à la réception"
          right={<Toggle on={sound} onChange={setSound} />}
        />
        <Divider />
        <SettingsRow
          label="Aperçu du message"
          desc="Afficher le contenu dans la notification"
          right={
            <Toggle on={preview} onChange={handlePreviewChange} ariaLabel="Aperçu du message" />
          }
        />
      </Card>

      {groupNames.length > 0 && (
        <>
          <SectionLabel>Par groupe</SectionLabel>
          <div style={{ padding: '0 12px 24px' }}>
            <div
              style={{
                background: NX.elevated,
                borderRadius: NX.radius,
                border: `1px solid ${NX.border}`,
                overflow: 'hidden',
              }}
            >
              {groupNames.map((name, i, arr) => (
                <div key={name}>
                  <SettingsRow
                    label={name}
                    right={
                      <Toggle
                        on={groupPrefs[name] ?? true}
                        onChange={(v) => setGroupPrefs((p) => ({ ...p, [name]: v }))}
                      />
                    }
                  />
                  {i < arr.length - 1 && <Divider />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Liste ordonnée des 12 providers webview-encapsulés (cf. ADR-027).
 * Tous utilisent le même flow `handleConnectWebview` →
 * POST /messaging/webview-sessions. Discord a rejoint la liste depuis
 * ADR-027 (universalisation : plus d'OAuth bot, juste la webview).
 */
const WEBVIEW_PROVIDERS: {
  id:
    | 'discord'
    | 'whatsapp'
    | 'messenger'
    | 'telegram'
    | 'instagram'
    | 'slack'
    | 'teams'
    | 'linkedin'
    | 'twitter'
    | 'reddit'
    | 'tiktok'
    | 'snapchat';
  label: string;
}[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'slack', label: 'Slack' },
  { id: 'teams', label: 'Microsoft Teams' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'twitter', label: 'X' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'snapchat', label: 'Snapchat' },
];

function ConnectionsSection() {
  const qc = useQueryClient();
  // M1 (post-ADR-027) : sessions scopées USER. Plus de dépendance au groupe.
  const sessionsQ = useMessagingSessions();
  const sessions = sessionsQ.data ?? [];

  const connectWebviewMut = useConnectWebviewProvider();
  const deleteSessionMut = useDeleteMessagingSession();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<{
    sessionId: string;
    provider: string;
    // Polish P3 : passé à useDeleteMessagingSession pour cleanup de la
    // webview Tauri persistante associée à cette session.
    providerType: (typeof WEBVIEW_PROVIDERS)[number]['id'];
  } | null>(null);

  // Écoute les retours OAuth via BroadcastChannel cross-tab. Conservé pour
  // compat : si un onboarding tiers via popup OAuth ré-apparaît (ex : Slack
  // workspace install), le canal est déjà branché.
  useEffect(() => {
    return subscribeBridgeConnected((event) => {
      const provider = event.provider;
      setToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connecté avec succès.`);
      void qc.invalidateQueries({ queryKey: ['me-messaging-sessions'] });
      window.setTimeout(() => setToast(null), 5000);
    });
  }, [qc]);

  const handleDisconnect = async () => {
    if (!confirmDisconnect) return;
    setError(null);
    try {
      await deleteSessionMut.mutateAsync({
        sessionId: confirmDisconnect.sessionId,
        providerType: confirmDisconnect.providerType,
      });
      setToast(`${confirmDisconnect.provider} déconnecté.`);
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      console.error('[settings] disconnect', err);
      setError('Impossible de déconnecter la messagerie. Réessaie.');
    } finally {
      setConfirmDisconnect(null);
    }
  };

  const handleConnectWebview = async (providerType: (typeof WEBVIEW_PROVIDERS)[number]['id']) => {
    setError(null);
    try {
      await connectWebviewMut.mutateAsync({ providerType });
      const label = WEBVIEW_PROVIDERS.find((p) => p.id === providerType)?.label ?? providerType;
      setToast(`${label} connecté. Ouvre-le depuis la sidebar.`);
      window.setTimeout(() => setToast(null), 5000);
    } catch (err) {
      console.error('[settings] connect webview', err);
      setError('Impossible de connecter cette messagerie. Réessaie.');
    }
  };

  return (
    <>
      <SectionTitle
        title="Connexions messageries"
        subtitle="Gère les liens avec tes messageries existantes"
      />
      <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {WEBVIEW_PROVIDERS.map((p) => {
          const session = sessions.find((s) => s.providerType === p.id);
          // Spread conditionnel pour `onDisconnect` : `exactOptionalPropertyTypes`
          // refuse `undefined` explicite sur une prop optionnelle, on omet la
          // clé entièrement quand pas de session connectée.
          const onDisconnectProp = session
            ? {
                onDisconnect: () =>
                  setConfirmDisconnect({
                    sessionId: session.id,
                    provider: p.label,
                    providerType: p.id,
                  }),
              }
            : {};
          return (
            <ConnectionCard
              key={p.id}
              provider={p.label}
              brandKey={p.id}
              accent={sourceColor[p.id]}
              accentBg={sourceBg[p.id]}
              status={session?.status ?? 'idle'}
              statusDetail={session?.statusDetail ?? null}
              label={
                session?.displayName ??
                'Encapsulation web — placeholder en navigateur, vraie webview en desktop'
              }
              onConnect={() => void handleConnectWebview(p.id)}
              connectBusy={connectWebviewMut.isPending}
              {...onDisconnectProp}
              disconnectBusy={deleteSessionMut.isPending}
              available
            />
          );
        })}
      </div>
      {error && (
        <div
          style={{
            margin: '0 24px 16px',
            padding: '10px 14px',
            background: NX.errorBg,
            border: `1px solid rgba(248,113,113,0.2)`,
            borderRadius: NX.radiusSm,
            fontSize: 12,
            color: NX.error,
          }}
        >
          {error}
        </div>
      )}
      {toast && (
        <div
          style={{
            margin: '0 24px 16px',
            padding: '10px 14px',
            background: NX.successBg,
            border: `1px solid rgba(52,211,153,0.25)`,
            borderRadius: NX.radiusSm,
            fontSize: 12,
            color: NX.success,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PhIcon name="check" size={14} color={NX.success} />
          {toast}
        </div>
      )}
      {confirmDisconnect && (
        <ConfirmDisconnectModal
          provider={confirmDisconnect.provider}
          busy={deleteSessionMut.isPending}
          onCancel={() => setConfirmDisconnect(null)}
          onConfirm={() => void handleDisconnect()}
        />
      )}
    </>
  );
}

/**
 * Modal de confirmation pour déconnecter une messagerie. La déconnexion
 * supprime la session côté nexus mais NE déconnecte PAS la session côté
 * provider (cookies de la webview Tauri restent en place jusqu'à
 * destruction de la fenêtre desktop). cf. ADR-027.
 */
function ConfirmDisconnectModal({
  provider,
  busy,
  onCancel,
  onConfirm,
}: {
  provider: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: NX.glassBg,
          backdropFilter: NX.glassBlur,
          WebkitBackdropFilter: NX.glassBlur,
          borderRadius: NX.radius,
          padding: 24,
          maxWidth: 400,
          width: '100%',
          border: `1px solid ${NX.glassBorder}`,
          boxShadow: NX.glassShadow,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: NX.fg, margin: 0 }}>
          Déconnecter {provider} ?
        </h2>
        <p style={{ fontSize: 13, color: NX.fgMuted, marginTop: 10, lineHeight: 1.5 }}>
          La session sera supprimée côté nexus et tu ne verras plus les messages {provider} dans
          cette app. Le bot nexus reste dans ton serveur — pour l'enlever complètement, retire-le
          côté Discord.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 18px',
              borderRadius: NX.radiusPill,
              background: 'transparent',
              color: NX.fgMuted,
              border: `1px solid ${NX.border}`,
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 18px',
              borderRadius: NX.radiusPill,
              background: NX.error,
              color: '#fff',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Deconnexion...' : 'Deconnecter'}
          </button>
        </div>
      </div>
    </div>
  );
}

type ConnCardStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'idle';

function ConnectionCard({
  provider,
  accent,
  accentBg,
  brandKey,
  status,
  statusDetail,
  label,
  onConnect,
  connectBusy = false,
  onDisconnect,
  disconnectBusy = false,
  available = true,
}: {
  provider: string;
  accent: string;
  accentBg: string;
  /**
   * Polish post-ADR-027 : si fourni, render le logo officiel du provider via
   * `BrandIcon` au lieu de la première lettre du nom (qui causait des
   * collisions visuelles : « M » pour Messenger ET Microsoft Teams,
   * « S » pour Slack ET Snapchat, etc.).
   */
  brandKey?: BrandKey | undefined;
  status: ConnCardStatus;
  statusDetail?: string | null | undefined;
  label: string;
  onConnect?: (() => void) | undefined;
  connectBusy?: boolean | undefined;
  onDisconnect?: (() => void) | undefined;
  disconnectBusy?: boolean | undefined;
  available?: boolean | undefined;
}) {
  const linked =
    status === 'connecting' ||
    status === 'connected' ||
    status === 'error' ||
    status === 'disconnected';
  const statusLabel: Record<ConnCardStatus, string> = {
    idle: '',
    connecting: 'Connexion en cours...',
    connected: 'Connecte',
    disconnected: 'Deconnecte',
    error: 'Erreur',
  };
  const statusColor: Record<ConnCardStatus, string> = {
    idle: NX.fgDim,
    connecting: NX.warning,
    connected: NX.success,
    disconnected: NX.fgDim,
    error: NX.error,
  };
  return (
    <div
      style={{
        background: NX.elevated,
        borderRadius: NX.radius,
        border: linked ? `1px solid ${NX.border}` : `1px dashed ${NX.borderHover}`,
        padding: 16,
        opacity: available ? 1 : 0.7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: accentBg,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          {brandKey ? <BrandIcon brand={brandKey} size={22} colored={false} /> : provider.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: NX.fg }}>{provider}</div>
          <div style={{ fontSize: 11, color: NX.fgDim }}>{label}</div>
          {linked && statusDetail && (
            <div style={{ fontSize: 10, color: NX.fgGhost, marginTop: 2 }}>{statusDetail}</div>
          )}
        </div>
        {linked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: statusColor[status],
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 600, color: statusColor[status] }}>
                {statusLabel[status]}
              </span>
            </div>
            {onDisconnect && (
              <button
                type="button"
                onClick={onDisconnect}
                disabled={disconnectBusy}
                style={{
                  padding: '6px 12px',
                  borderRadius: NX.radiusPill,
                  background: NX.errorBg,
                  color: NX.error,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: disconnectBusy ? 'wait' : 'pointer',
                  opacity: disconnectBusy ? 0.6 : 1,
                }}
              >
                {disconnectBusy ? '...' : 'Deconnecter'}
              </button>
            )}
          </div>
        ) : available ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={connectBusy || !onConnect}
            style={{
              padding: '8px 18px',
              borderRadius: NX.radiusPill,
              background: NX.primary,
              color: '#fff',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: connectBusy ? 'wait' : 'pointer',
              opacity: connectBusy ? 0.6 : 1,
            }}
          >
            {connectBusy ? '...' : 'Connecter'}
          </button>
        ) : (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: NX.radiusPill,
              background: NX.raised,
              color: NX.fgDim,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Bientot
          </span>
        )}
      </div>
    </div>
  );
}

function SecuritySection() {
  const logoutAll = useAuth((s) => s.logoutAll);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleLogoutAll = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const revokedCount = await logoutAll();
      setFeedback(
        revokedCount === 0
          ? 'Aucune autre session active.'
          : revokedCount + ' autre(s) session(s) deconnectee(s).',
      );
    } catch (err) {
      console.error('[settings] logoutAll', err);
      setFeedback('La deconnexion globale a echoue. Reessaie.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle title="Securite" subtitle="Sessions actives, acces aux appareils" />
      <SectionLabel>Sessions</SectionLabel>
      <Card>
        <SettingsRow label="Session courante" desc="Ce navigateur" />
        <Divider />
        <SettingsRow
          icon="signOut"
          label={busy ? 'Deconnexion...' : 'Deconnecter tous les autres appareils'}
          desc="Ta session courante reste active."
          danger
          {...(busy ? {} : { onClick: () => void handleLogoutAll() })}
        />
      </Card>
      {feedback && (
        <div
          style={{
            margin: '12px 24px',
            padding: '10px 14px',
            background: NX.successBg,
            border: `1px solid rgba(52,211,153,0.2)`,
            borderRadius: NX.radiusSm,
            fontSize: 12,
            color: NX.success,
          }}
        >
          {feedback}
        </div>
      )}

      <AboutSection />
    </>
  );
}

/**
 * Section "À propos" — cf. MAN-133 (build web) et MAN-134 (version desktop).
 * Uniquement à des fins de support/debug, volontairement discrète (pas de
 * nouvel onglet dans la sidebar : le set d'icônes Phosphor du fichier n'a
 * pas d'icône "info" qui conviendrait).
 *
 * Desktop : `getVersion()` de `@tauri-apps/api/app` est appelée via import
 * dynamique dans un effect, même forme que `TitleBar.tsx` (`getCurrentWindow`
 * de `@tauri-apps/api/window`) — c'est la valeur réellement compilée dans le
 * binaire (`Cargo.toml`), jamais une copie qui pourrait diverger. Pas de
 * garde StrictMode (contrairement à `useUpdater.ts`) : lecture pure et
 * idempotente, un double appel en dev n'a aucun effet de bord à protéger.
 */
function AboutSection() {
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      const { getVersion } = await import('@tauri-apps/api/app');
      setDesktopVersion(await getVersion());
    })().catch((err: unknown) => {
      console.warn('[settings] Tauri app API indisponible', err);
      setDesktopVersion('version indisponible');
    });
  }, []);

  return (
    <>
      <SectionLabel>À propos</SectionLabel>
      <Card>
        {isTauri() ? (
          <SettingsRow label="Version" desc={desktopVersion ?? '…'} />
        ) : (
          <SettingsRow label="Build" desc={getWebBuildId()} />
        )}
      </Card>
      <ReplayOnboardingTourRow />
    </>
  );
}

/**
 * "Relancer le tutoriel" (MAN-217 Phase 1 / MAN-220 Task 4) — replay
 * volontaire du tutoriel de découverte : repose `onboardingStep` sur la
 * première étape et remet `onboardingCompletedAt` à null (cf.
 * `replayOnboardingTour`, `@/lib/onboardingTour`), puis renvoie vers `/app`
 * où `OnboardingTourBanner` s'affiche — la Card Settings elle-même ne montre
 * jamais le bandeau.
 *
 * Exporté (pas juste local à `AboutSection`) pour être monté isolément par
 * `onboardingTour.acceptance.test.tsx` (MAN-220 Task 5) : le test
 * d'acceptation du slice a besoin du VRAI contrôle "replay depuis les
 * Réglages", sans avoir à mocker toute la tuyauterie query/router dont le
 * reste de `SettingsScreen` dépend (groupes, sessions messageries, etc.) et
 * qui n'a aucun rapport avec le tutoriel.
 */
export function ReplayOnboardingTourRow() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReplay = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    replayOnboardingTour()
      .then(() => navigate({ to: '/app' }))
      .catch((err: unknown) => {
        console.warn('[settings] échec relance du tutoriel', err);
        setError('Impossible de relancer le tutoriel. Réessaie.');
        setBusy(false);
      });
  };

  return (
    <>
      <Card>
        <SettingsRow
          label="Relancer le tutoriel"
          desc={busy ? 'Redémarrage…' : 'Revoir les étapes de découverte de nexus'}
          onClick={handleReplay}
        />
      </Card>
      {error && <div style={{ margin: '0 12px 12px', fontSize: 12, color: NX.error }}>{error}</div>}
    </>
  );
}

/**
 * Identifiant de build web (SHA git court). Gravé dans le bundle au build
 * (`VITE_GIT_SHA`, injecté par `deploy.yml`), donc toujours exact vis-à-vis
 * de ce que le navigateur exécute réellement, jamais une valeur "live" qui
 * pourrait changer sous les pieds de l'utilisateur. Reflète le dernier build
 * *déployé*, pas forcément le HEAD de `main` (le job `build-frontend` de
 * `deploy.yml` est filtré par chemin, cf. `deploy.yml:12-25`).
 */
function getWebBuildId(): string {
  const sha = (import.meta.env.VITE_GIT_SHA as string | undefined)?.trim();
  // `||` et non `??` : une chaîne vide (mauvaise config CI, cf. revue MAN-133)
  // doit aussi déclencher le repli, pas seulement `undefined` — `??` ne
  // couvrirait pas ce cas.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return sha || 'build inconnu';
}
