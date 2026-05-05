# ADR-008 : Intégration WhatsApp — Bridge Baileys server-side (option γ.1)

**Date** : 2026-04-30 (rév. 2 après nouvelles exigences : envoi possible, parité mobile)
**Statut** : Accepté

## Contexte

Cet ADR a connu deux révisions précédentes :

1. v1 : recommandait mautrix-wa + Synapse
2. v2 : option β (webview Tauri + injection DOM, lecture seule)

Suite aux nouvelles exigences de Manu (envoi, killer features partout, parité
mobile/desktop), on bascule comme pour Messenger sur une **architecture
server-side**. La question est de choisir entre deux options server-side
possibles pour WhatsApp.

## Options envisagées

### γ.1 — Baileys (library Node.js, intégrée dans nos workers)

- **Pros** :
  - Library Node TypeScript active (`@whiskeysockets/baileys`), maintenue, large communauté
  - **Pas de Synapse / homeserver Matrix nécessaire** : on intègre directement dans un worker BullMQ
  - Empreinte RAM minimale (~50-150 Mo par session)
  - API Node directe : facile à interfacer avec notre interface `MessagingProvider`
  - Pas de couche Matrix à apprendre / maintenir
  - Le protocole multi-device est implémenté côté Baileys, identique à celui de WhatsApp Web
- **Cons** :
  - Plus exposé visuellement à Meta (pas l'enrobage Matrix qui agrège plein de bridges)
  - Moins de couches d'abstraction → quand le protocole change, c'est nous qui patchons
  - Réputation perçue : Meta pourrait théoriquement plus aisément contre-attaquer
    une library Node populaire qu'un projet Matrix décentralisé. Empirique, pas de cas concret en 2025-2026.

### γ.2 — mautrix-wa (bridge Matrix)

- **Pros** :
  - Le bridge le plus mature pour WhatsApp, des milliers d'utilisateurs en prod
  - Moins de churn protocole (la communauté Matrix patch vite)
  - Reuse possible : si on prend Conduit pour mautrix-meta (cf. ADR-007),
    le même Conduit peut héberger mautrix-wa
- **Cons** :
  - Ajoute une couche Matrix qu'on traverse pour rien si Baileys suffit
  - Plus de RAM cumulée (~300-500 Mo bridge + share homeserver)
  - Latence légèrement plus élevée (event Matrix → bridge → Meta vs Node direct)

### γ.3 — whatsapp-web.js (Puppeteer + Chrome headless)

- **Pros** : ergonomie de l'API
- **Cons** : Chrome headless lourd (~400 Mo RAM), fragile, latent ; déconseillé en prod sérieuse

### γ.4 — WhatsApp Cloud API officielle (WABA)

- **Pros** : officiel
- **Cons** : business-only, coût par conversation, inadapté aux conversations amis. **Hors scope.**

## Décision

**Option γ.1 — Baileys (library Node.js)**, validée par Manu en discussion (à
passer en Accepté lors de la validation groupée).

Justification du choix γ.1 plutôt que γ.2 :

1. **Empreinte VPS minimale** : on a déjà mautrix-meta + Conduit pour Messenger
   (~500 Mo). Ajouter mautrix-wa monterait à ~1 Go juste pour les bridges.
   Baileys nous coûte 100-150 Mo de plus, pas 500.
2. **Simplicité d'intégration** : Baileys est une library Node, nos workers
   BullMQ peuvent l'embarquer directement. Pas de couche Matrix supplémentaire
   pour le seul bridge où on peut s'en passer.
3. **Cohérence avec notre stack** : tout reste TypeScript/Node, monitoring
   homogène, debug en JS qu'on connaît, déploiement plus simple.
4. **Patch path** : si Baileys casse, on patch nous-mêmes, et on bascule vers
   mautrix-wa en backup si besoin (Conduit est déjà là pour Messenger, l'ajouter
   est trivial).

Architecture :

```
Utilisateur Nexus
    │ tape un message (UI desktop ou mobile)
    ▼
Backend Nexus API
    │ enqueue → BullMQ
    ▼
Worker WhatsApp (Node + Baileys)
    │ protocole multi-device
    ▼
Serveurs WhatsApp
```

Stack runtime sur le VPS pour ce bridge :

- Worker `whatsapp-bridge` (process Node dédié, ~150 Mo RAM par session active)
- Stockage session : clés Signal protocol chiffrées en DB (table `messaging_provider_sessions`,
  chiffrement AES-GCM, clé en env)

Périmètre V1 :

- ✅ Lecture des messages (toutes conversations bridgées)
- ✅ Envoi de messages tapés par l'utilisateur dans Nexus
- ✅ Réception temps réel
- ✅ QR code de pairing affiché dans l'UI Nexus
- ✅ Mapping vers le modèle interne `MessagingProvider`
- ✅ Alimentation du moteur de coordination
- ❌ Envoi automatisé (bot Nexus) — **interdit par ADR-010**
- ❌ Médias en V1 (photos, audios) — V1.x
- ❌ Appels — hors scope

Consentement utilisateur :

- Modal de consentement obligatoire au premier branchement, texte clair :
  \*"Connecter WhatsApp à Nexus crée une session liée comme un device WhatsApp
  Web (tu scannes un QR code dans ton app WhatsApp). Nexus va lire tes
  messages pour alimenter le moteur d'organisation et te permettre de répondre
  depuis Nexus. Cela utilise un protocole non documenté de WhatsApp —
