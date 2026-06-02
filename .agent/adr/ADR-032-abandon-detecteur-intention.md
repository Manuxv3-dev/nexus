# ADR-032 : Abandon du détecteur d'intention Claude (J6)

**Date** : 2026-06-02
**Statut** : Accepté

## Contexte

Le détecteur d'intention (Jalon 6 de la roadmap initiale) était pensé comme la
couche IA différenciante de Nexus : analyser les messages entrants via l'API
Claude pour repérer des opportunités d'organisation (proposition de date,
mention de dépense, demande de sondage, ajout de todo) et proposer des actions
inline à l'utilisateur.

Cette feature reposait sur une hypothèse devenue fausse : que le backend Nexus
**lit le contenu des messages**. Or le pivot acté en ADR-022 puis généralisé en
ADR-027 (universalisation webview messaging) a remplacé l'ingestion de messages
côté serveur par l'**encapsulation des pages web officielles** des messageries
(Discord, WhatsApp, Messenger, etc.) dans des webviews isolées. Conséquences :

- Nexus n'a plus accès programmatique au texte des messages — il affiche une
  webview tierce, il ne la parse pas.
- Lire ces messages pour les envoyer à Claude impliquerait du scraping DOM /
  injection dans des webviews tierces : fragile, contraire aux ToS, et un risque
  RGPD majeur (envoi de contenus privés de tiers à une API externe).
- Le backlog (feature « F — Suggestions IA ») marquait déjà cette piste comme
  exclue, et la note ADR-022 signalait « intent detection Claude impossible sur
  Messenger/WA sans injection ».

Manu a donc décidé (2026-06-02) d'abandoner purement et simplement le détecteur
d'intention, plutôt que de le maintenir comme dette ou de le réarchitecturer.

## Options envisagées

1. **Réarchitecturer l'intent detection sur le seul périmètre lisible**
   (messages saisis nativement dans Nexus) — mais il n'existe plus de chat natif
   Nexus depuis la suppression de `ChatView` (cleanup ADR-027). Plus de surface
   d'entrée → feature sans objet.
2. **Scraper / injecter dans les webviews tierces pour récupérer le texte** —
   rejeté : fragile, violation de ToS, risque RGPD (contenus de tiers envoyés à
   une API externe sans base légale claire).
3. **Abandonner la feature** — assumer que Nexus est un agrégateur de messageries
   - une couche d'organisation explicite (events, sondages, dépenses, todos
     déclenchés manuellement par l'utilisateur), sans suggestion IA automatique.

## Décision

Option 3 : **abandon du détecteur d'intention**. La couche d'organisation reste
pilotée explicitement par l'utilisateur (boutons / actions Nexus), ce qui est
déjà entièrement livré (events, polls, expenses, todos + pages publiques +
notifications V1.2). L'API Claude n'est plus une dépendance du produit.

## Conséquences

- **Positif** : moins de surface ToS/RGPD, pas de coût ni de quota API Claude à
  gérer, pas de cache d'analyses à maintenir, scope MVP resserré et déjà atteint.
- **Positif** : la proposition de valeur reste claire — agréger les messageries
  - organiser explicitement entre amis — sans promettre une IA qui lirait des
    conversations privées de tiers.
- **Neutre** : le skill `.agent/skills/use-claude-api.md` est déprécié (conservé
  pour historique, ré-activable si une feature IA _sur du contenu first-party_
  émerge un jour).
- **Négatif** : on perd l'angle marketing « organisation intelligente / IA ».
  Acceptable : la valeur d'usage (agrégation + orga partagée) tient sans ça.
- Jalon 6 retiré de la roadmap ; références nettoyées dans `backlog.md`,
  `README.md` et le skill.
