# Historique de l'initialisation

Trace narrative des décisions prises pendant l'initialisation, pour qu'une
session future ou un dev qui rejoint le projet comprenne pourquoi on en est
là sans avoir à relire tous les ADR.

## Session 1 — 2026-04-30

### Étape 1 : structure et ADR fondateurs
- Création de `.agent/`, du squelette monorepo, de 8 ADR initiaux
- Roadmap MVP en J0-J7 + V1.1/V1.2/V2

### Étape 2 : pivot webview-injection (Franz-style)
Manu pose la question : *"Franz/Ferdium intègrent Messenger et WhatsApp,
comment font-ils ?"*. Réponse : ils utilisent des webviews officielles
(messenger.com, web.whatsapp.com). On bascule vers une approche
**webview Tauri + injection DOM** :
- ADR-007 v2 et ADR-008 v2 : option β, lecture seule
- ADR-009 v1 (nouveau) : pattern webview-injection

Avantages perçus à ce moment : pas d'infra Synapse, conformité ToS plus
défendable, blocker VPS downgradé.

### Étape 3 : pivot bridges server-side (final)
Manu pose trois nouvelles exigences :
1. Envoi possible depuis Nexus dans toutes les messageries
2. Killer features fonctionnelles partout
3. Parité mobile/desktop

Ces trois exigences invalident le webview-injection :
- L'envoi dans un webview = simulation clavier (fragile, ostensiblement
  automation)
- Webview-injection inopérant sur mobile (iOS sandbox strict)
- Diviser l'archi desktop/mobile = deux produits différents à maintenir

Bascule définitive vers une **architecture bridges server-side** :
- ADR-007 v3 : Messenger via mautrix-meta + Conduit (homeserver Matrix léger)
- ADR-008 v3 : WhatsApp via Baileys (Node, pas de Synapse pour ce bridge)
- ADR-009 v2 (réécrit) : pattern bridges server-side, clients agnostiques
- ADR-010 (nouveau) : pas d'auto-envoi, tout passe par des **liens Nexus
  publics** partagés manuellement par l'utilisateur

Le pattern "lien Nexus partagé" est la pièce maîtresse qui rend le système
défendable côté ToS Meta : les seuls envois bridges → Messenger/WhatsApp
sont des messages **tapés explicitement** par l'utilisateur, comme avec
n'importe quel client tiers (Caprine, etc.).

### Validation VPS
VPS Hostinger KVM 2 (8 Go RAM, 2 vCPU, 100 Go disque, France/Paris).
n8n cohabite. Largement dimensionné pour Nexus + n8n.
Détails dans `.agent/notes/vps-hostinger.md`.

### Validation finale
Manu valide les 10 ADR le 2026-04-30. Statut "Accepté", immuables.
J0 (Fondations) démarre.

## Leçons à retenir

1. **Toujours questionner l'écosystème existant avant de coder** : la
   référence à Franz a fait économiser un faux départ. Pour les futures
   intégrations, regarder ce que la communauté fait déjà.

2. **Les exigences produit dictent l'archi** : l'enjeu n'était pas
   technique (toutes les options webview/bridge marchent) mais
   produit (qu'est-ce qu'on veut que l'utilisateur puisse faire ?). La
   bascule s'est faite sur trois exigences claires énoncées par Manu.

3. **Pas d'auto-envoi** est une **règle dure**, pas un compromis. ADR-010
   pose des anti-patterns explicitement interdits : aucun message
   généré par Nexus dans les conversations source. Cette discipline
   réduit le risque ToS de moitié et simplifie la conception.

4. **Le pattern "lien Nexus" est cross-cutting** : il décolle les killer
   features de la messagerie source, ce qui est un avantage produit (un
   événement n'est pas enfermé dans Messenger, il est partageable
   partout).
