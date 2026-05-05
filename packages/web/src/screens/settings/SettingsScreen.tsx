import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import {
  Avatar,
  BrandIcon,
  Logo,
  PhIcon,
  Toggle,
  type BrandKey,
  type PhIconName,
} from '@/components/ui';
import { useAuth, type LandingPreference } from '@/lib/auth';
import { subscribeBridgeConnected } from '@/lib/oauth-bus';
import {
  useConnectWebviewProvider,
  useDeleteMessagingSession,
  useGroups,
  useMessagingSessions,
} from '@/lib/queries';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { NX, sourceBg, sourceColor } from '@/lib/tokens';

type Section = 'profile' | 'notifications' | 'connections' | 'security';

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
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: NX.bg }}>
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
        {section === 'notifications' && <NotificationsSection groupNames={groupsForConnections.map((g) => g.name)} />}
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

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ padding: '20px 24px', borderBottom: `1px solid ${NX.border}` }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: NX.fg }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: NX.fgDim, marginTop: 4 }}>{subtitle}</div>}
    </div>
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
  right,
  onClick,
  danger,
}: {
  icon?: PhIconName;
  label: string;
  desc?: string;
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
        <div style={{ fontSize: 13, fontWeight: 500, color: danger ? NX.error : NX.fg }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: NX.fgDim, marginTop: 1 }}>{desc}</div>}
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 12px' }}>
      <div
        style={{
          background: NX.elevated,
          borderRadius: NX.radius,
          border: `1px solid ${NX.border}`,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: NX.border, margin: '0 16px' }} />;
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
  const desc =
    mode === 'auto' ? 'Suit le système' : mode === 'light' ? 'Clair' : 'Sombre';
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

function ProfileSection({
  user,
  onLogout,
}: {
  user: { displayName: string; email: string };
  onLogout: () => void;
}) {
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
        <SettingsRow icon="users" label="Nom d'affichage" desc={user.displayName} right={<SoonBadge />} />
        <Divider />
        <SettingsRow icon="chatCircle" label="Email" desc={user.email} right={<SoonBadge />} />
        <Divider />
        <SettingsRow icon="gear" label="Mot de passe" desc="Modifier" right={<SoonBadge />} />
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
          <SettingsRow icon="x" label="Supprimer mon compte" danger right={<SoonBadge />} />
        </div>
      </div>
    </>
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
 * Pastille "Bientôt" affichée sur les actions de Réglages dont l'endpoint
 * backend n'existe pas encore (PATCH /users/me, POST /auth/change-password,
 * DELETE /users/me, GET/PATCH /users/me/notifications). Cf. backlog J1f
 * et J4b-bis.
 */
function SoonBadge() {
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: NX.radiusPill,
        background: NX.raised,
        color: NX.fgDim,
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      Bientôt
    </span>
  );
}

function NotificationsSection({ groupNames }: { groupNames: string[] }) {
  const [push, setPush] = useState(true);
  const [sound, setSound] = useState(true);
  const [preview, setPreview] = useState(true);
  const [groupPrefs, setGroupPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groupNames.map((g) => [g, true])),
  );

  return (
    <>
      <SectionTitle
        title="Notifications"
        subtitle="Préférences locales — la persistance serveur arrive avec la PWA Web Push (J4c)."
      />
      <SectionLabel>Général</SectionLabel>
      <Card>
        <SettingsRow
          icon="bell"
          label="Notifications push"
          desc="Recevoir des alertes pour les nouveaux messages"
          right={<Toggle on={push} onChange={setPush} />}
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
          right={<Toggle on={preview} onChange={setPreview} />}
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

  const handleConnectWebview = async (
    providerType: (typeof WEBVIEW_PROVIDERS)[number]['id'],
  ) => {
    setError(null);
    try {
      await connectWebviewMut.mutateAsync({ providerType });
      const label =
        WEBVIEW_PROVIDERS.find((p) => p.id === providerType)?.label ?? providerType;
      setToast(`${label} connecté. Ouvre-le depuis la sidebar.`);
      window.setTimeout(() => setToast(null), 5000);
    } catch (err) {
      console.error('[settings] connect webview', err);
      setError("Impossible de connecter cette messagerie. Réessaie.");
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
          La session sera supprimée côté nexus et tu ne verras plus les messages
          {' '}{provider} dans cette app. Le bot nexus reste dans ton serveur — pour
          l'enlever complètement, retire-le côté Discord.
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
    status === 'connecting' || status === 'connected' || status === 'error' || status === 'disconnected';
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
          {brandKey ? (
            <BrandIcon brand={brandKey} size={22} colored={false} />
          ) : (
            provider.charAt(0)
          )}
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
    </>
  );
}
