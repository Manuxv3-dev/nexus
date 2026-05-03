/**
 * ChatView — dispatcher multi-mode (cf. ADR-022).
 *
 * Le rendu du volet central change selon le `providerType` du channel
 * actif :
 *  - **Discord** → `ChatViewDiscord` : rendu natif (DTO API + composer
 *    + thread). On a un accès programmable via l'API officielle Discord
 *    (cf. ADR-006).
 *  - **Messenger / WhatsApp** → `ChatViewWebview` : placeholder + CTA
 *    qui ouvre l'app web officielle. Modèle Franz/Ferdium (cf. ADR-022).
 *
 * Signature publique inchangée pour ne pas casser AppShell / MobileShell
 * (qui passent les props {groupId, sessionId, channel, memberCount,
 * providerType, onPickFeature}). La prop `onPickFeature` reste sur le
 * dispatcher pour le futur (J6 — suggestion IA → "Créer un évent à
 * partir de ce message"), à brancher quand on aura l'intent detection.
 */
import { type MessagingChannel } from '@/lib/queries';
import { type ProviderType } from '@/lib/tokens';

import { ChatViewDiscord } from './ChatViewDiscord';
import { ChatViewWebview } from './ChatViewWebview';

export interface ChatViewProps {
  groupId: string;
  sessionId: string;
  channel: MessagingChannel;
  memberCount: number;
  providerType: ProviderType;
  onPickFeature: (pane: 'event' | 'poll' | 'expense' | 'todo') => void;
}

export function ChatView({
  groupId,
  sessionId,
  channel,
  memberCount,
  providerType,
  // _onPickFeature : conservé dans la signature publique pour le futur
  // (J6 — suggestion IA → bouton "Créer un évent à partir de ce message").
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPickFeature: _onPickFeature,
}: ChatViewProps) {
  if (providerType === 'discord') {
    return (
      <ChatViewDiscord
        groupId={groupId}
        sessionId={sessionId}
        channel={channel}
        memberCount={memberCount}
        providerType={providerType}
      />
    );
  }

  // providerType === 'messenger' | 'whatsapp'
  return (
    <ChatViewWebview
      channel={channel}
      memberCount={memberCount}
      providerType={providerType}
    />
  );
}
