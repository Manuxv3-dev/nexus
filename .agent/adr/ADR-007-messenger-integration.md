# ADR-007 : Intégration Messenger — Bridge mautrix-meta server-side (option γ)

**Date** : 2026-04-30 (rév. 2 après nouvelles exigences : envoi possible, parité mobile)
**Statut** : Accepté

## Contexte

Cet ADR a connu deux révisions précédentes :
1. v1 : recommandait de sortir Messenger du MVP faute d'API officielle
2. v2 : option β (webview Tauri + injection DOM, lecture seule)

Manu a posé trois nouvelles exigences fortes :
- L'utilisateur doit pouvoir **envoyer** des messages depuis Nexus dans Messenger
- Les killer features doivent **fonctionner sur toutes les plateformes**
- **Parité mobile/desktop** : tout ce qui marche sur desktop doit marcher sur mobile

Ces trois exigences éliminent l'option β (webview-injection inopérant sur mobile,
particulièrement iOS) et imposent une architecture **server-side** : le backend
Nexus parle directement aux protocoles Messenger via un bridge, et les clients
(desktop ET mobile) consomment la même API REST/WebSocket Nexus.

Les killer features ne nécessitent **pas** d'envoi automatisé dans les
conversations source (cf. ADR-010) : tout passe par des liens Nexus partagés
manuellement par l'utilisateur. Cela limite le risque ToS Meta : les seuls
envois bridges → Messenger sont des messages **tapés explicitement par
l'utilisateur** dans Nexus, indistinguables d'un client tiers comme Messenger
desktop ou Caprine.

## Options envisagées (réévaluées avec les nouvelles contraintes)

### γ.1 — mautrix-meta + homeserver Matrix
- **Pros** :
  - Bridge le plus mature pour Facebook Messenger / Instagram DM en 2025-2026
  - Maintenu activement par la communauté Matrix
  - Multi-device protocole (l'utilisateur lie son compte comme via la session web)
  - Architecture éprouvée (le même pattern que mautrix-wa pour WhatsApp)
  - Stockage local des messages sur le VPS, sous contrôle utilisateur
- **Cons** :
  - Nécessite un homeserver Matrix (Synapse ou alternative légère)
  - Suit l'évolution du protocole Meta : ~6-8 incidents en 2024 nécessitant patch
  - Coût RAM (homeserver + bridge)

### γ.2 — Library Node.js directe (`fca-unofficial`, `facebook-chat-api`, dérivés)
- **Pros** : pas de Synapse, intégration directe dans nos workers BullMQ
- **Cons** :
  - **Toutes les libraries Node Messenger sont abandonnées ou très instables** depuis les durcissements Meta de 2023-2024
  - Risque de ban élevé (détection automation plus agressive)
  - Communauté très réduite, pas de patch rapide
- **Verdict** : non retenu

### γ.3 — WhatsApp Business API / Cloud API (pas applicable à Messenger personnel)
Hors scope, n'existe pas pour les conversations amis Messenger.

### Choix du homeserver Matrix pour mautrix-meta

mautrix-meta nécessite un homeserver Matrix. Trois options :

| Homeserver | Lang | RAM      | Maturité | Notes                                    |
|------------|------|----------|----------|------------------------------------------|
| Synapse    | Py   | 500-800 Mo | Très haute | Référence officielle, peut être lourd  |
| Dendrite   | Go   | 200-400 Mo | Stable   | Alternative officielle Matrix.org        |
| **Conduit**| Rust | 150-250 Mo | Beta stable | Le plus léger, base SQLite, idéal mono-utilisateur technique |

Conduit est notre choix par défaut pour son empreinte minimale, sachant qu'on
n'a besoin que d'un homeserver "service" (pas un homeserver fédéré ouvert),
hébergeant un seul utilisateur technique par bridge.

**Fallback** : bascule vers Synapse si Conduit pose un problème de compatibilité
mautrix-meta (à valider en POC avant J8 — ajouté au backlog).

## Décision

**Option γ.1 — mautrix-meta + Conduit (homeserver Matrix léger)**, validée par
Manu en discussion (à passer en Accepté lors de la validation groupée).

Architecture :

```
Utilisateur Nexus
    │ tape un message (UI desktop ou mobile)
    ▼
Backend Nexus API
    │ relai via Application Service Matrix
    ▼
Conduit (homeserver, ~200 Mo RAM)
    │ event Matrix
    ▼
mautrix-meta (bridge, ~150-300 Mo RAM)
    │ protocole Meta multi-device
    ▼
S