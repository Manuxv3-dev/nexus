# ADR-006 : Intégration Discord — API officielle (bot + OAuth user)

**Date** : 2026-04-30
**Statut** : Remplacé par ADR-027 (2026-05-04)

> ⚠️ **Obsolète depuis le 2026-05-04** : la décision actée ici (Discord
> via API officielle bot + OAuth user, avec worker bridge serveur) a été
> remplacée par l'**ADR-027 (universalisation webview messaging)** qui
> traite Discord comme tous les autres providers : encapsulation webview
> Tauri, plus d'API serveur. L'ensemble de la plomberie évoquée ici
> (`integrations/discord/`, `workers/discord-bridge`, channels Nexus) a
> été supprimée. Conservé pour historique.

## Contexte

Discord est la première messagerie ciblée pour le MVP, retenue car la plus
permissive juridiquement (API officielle ouverte, ToS clairs, écosystème mature).

Besoin fonctionnel :
- Lire les messages d'un canal/serveur côté bande d'amis
- Envoyer des messages depuis Nexus (dans Discord)
- Détecter en temps réel les nouveaux messages (pour que le moteur d'intention puisse les analyser)
- Récupérer la liste des membres et présence
- Identifier de façon stable un "groupe Nexus" ↔ un "guild Discord" (ou un sous-ensemble de canaux)

## Options envisagées

### 1. Bot Discord uniquement (Bot Token)
- **Pros** : approche officielle, robuste, gateway WebSocket pour le temps réel,
  permissions granulaires par canal
- **Cons** : il faut que le bot soit invité sur le serveur Discord du groupe ;
  les utilisateurs Nexus doivent disposer des droits pour l'inviter

### 2. User token / self-bot
- **Pros** : accès comme un utilisateur, pas besoin d'inviter un bot
- **Cons** : **violation explicite des ToS Discord**, ban quasi-systématique,
  hors de question

### 3. Bot + OAuth user (combo)
- **Pros** :
  - Le bot lit/écrit dans le serveur de la bande
  - L'OAuth user permet à Nexus d'identifier l'utilisateur de façon canonique
    (mapping Nexus user ↔ Discord user) et de récupérer la liste de ses serveurs
  - Permet l'expérience "log in with Discord" propre
- **Cons** : deux flows à orchestrer

## Décision

**Bot + OAuth user.**

Architecture :
- **Bot Nexus** : application Discord enregistrée, invitée sur le serveur du groupe
  via lien d'invitation avec scopes `bot applications.commands` et permissions
  minimales (`Read Messages`, `Send Messages`, `Read Message History`,
  `View Channels`, `Mention Everyone` désactivé par défaut)
- **OAuth user** : pour l'auth utilisateur dans Nexus, scopes `identify guilds`
- **Gateway WebSocket Discord** : un worker dédié (`packages/backend/src/integrations/discord/gateway.ts`)
  maintient une connexion gateway, ingère les events, les pousse dans un channel
  Redis interne (`discord:events:{guildId}`)
- **Mapping** : table `messaging_channels` avec `(groupId, provider='discord', external_id=guild_id, channel_ids=[...])`
- **Lib** : `discord.js` v14 (de loin la plus mature pour Node.js)

Flow utilisateur :
1. Manu crée un groupe "Bande des cousins" dans Nexus
2. Cliquer "Connecter Discord" → ouvre le lien d'invitation du bot avec le serveur cible
3. Le bot rejoint le serveur, on liste les canaux, l'utilisateur sélectionne lesquels suivre
4. Désormais, les messages des canaux sélectionnés remontent dans Nexus en temps réel

## Conséquences

**Positif** :
- Approche conforme aux ToS, robuste, scalable
- L'expérience est propre côté UX (pas de "scrap" tout sale)
- discord.js gère 90% de la plomberie (rate limits, reconnexion gateway, sharding si besoin un jour)

**Négatif** :
- Il faut que Manu (ou un admin du serveur) ait le droit d'inviter un bot
- Sharding gateway à prévoir si on dépasse 2500 guilds (largement hors scope V1)
- Stockage des bot tokens chiffré (cf. ADR-004)

**Neutre** :
- Le bot est public (anyone peut l'inviter techniquement) ou privé (whitelist) :
  on démarre **privé** (whitelist) tant qu'on est en mono-tenant
- Skill à créer : `integrate-messaging-platform.md` (template générique)

## Risques juridiques / ToS

Aucun problème majeur. Discord encourage explicitement les bots et l'OAuth.
**Veillera** :
- Stocker le minimum de données nécessaires (pas de copie sauvage de tout l'historique sans nécessité)
- Permettre la suppression à la demande (RGPD)
- Afficher clairement à l'utilisateur ce qui est synchronisé
