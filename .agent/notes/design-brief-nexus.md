# Brief design — Nexus

> **Pour qui** : agent Claude design (ou tout designer humain qui prend
> en main l'identité visuelle et l'UI de Nexus).
> **Pilote produit** : Manu.
> **Statut** : V1 brief complet, en attente de retour design.

---

## Le produit en 30 secondes

**Nexus** est une **plateforme d'agrégation de messageries** (Discord,
WhatsApp, Messenger) augmentée d'une **couche d'organisation pour bandes
d'amis** : agenda partagé, événements + RSVP, sondages, dépenses partagées
(à la Tricount/Splitwise), todos et listes collaboratives.

Le pitch : *"Tes amis sont éparpillés sur 3 messageries. Toi t'es fatigué
de scroller pour retrouver "qui amène quoi samedi". Nexus rassemble vos
discussions et te donne les outils pour vous organiser, sans changer les
habitudes de personne."*

C'est un produit **B2C grand public**, optimisé pour des groupes d'amis
(5-30 personnes), pas pour des équipes pro. Le ton est chaleureux, vivant,
proche. Pas corporate.

## Audience cible

- **Persona principal** : 25-40 ans, urbain, plusieurs cercles sociaux
  actifs, organise régulièrement des événements (apéros, weekends,
  voyages). Utilise tous les jours WhatsApp + Messenger ou Discord.
  Frustration : "j'arrive plus à suivre qui dit quoi sur quoi".
- **Personas secondaires** : groupes étudiants, colocs, équipes de sport
  amateur, chorales, asso, clubs de jeux.

Les utilisateurs ne sont **pas des power-users tech**. L'UI doit être
immédiate, sans onboarding lourd, sans jargon.

## Référents et mood

**Inspirations explicites** :
- **Linear** pour la rigueur visuelle, le sens du détail, les transitions
  fluides
- **Cron / Notion Calendar** pour la beauté d'un agenda dense mais lisible
- **Beeper** pour la philosophie multi-messagerie unifiée
- **Discord** pour le côté chaleureux/joyeux de l'interface (mais en moins
  geek, plus mainstream)
- **Splitwise** pour l'efficacité de l'écran "qui doit quoi à qui"
- **Partiful** pour l'esthétique des pages publiques d'événements

**À éviter** :
- Le côté austère/corporate de Slack ou Microsoft Teams
- L'over-engineering visuel de Notion (trop de surfaces, trop de boutons)
- Le côté "yet another mobile messenger" générique

**Mood global** : *moderne, soigné, chaleureux, légèrement ludique sans
être enfantin*. On veut que l'utilisateur ait envie d'ouvrir l'app le
matin parce qu'elle est belle, pas juste utile.

## Identité visuelle (à définir par le designer)

À ce stade, **rien n'est encore designé**. Le designer a la main complète
sur :
- **Palette de couleurs** — Préférence Manu : dark-first (l'app est utilisée
  beaucoup le soir, sur mobile en messagerie). Mais le light mode doit
  exister (PWA installée sur desktop, accessibilité). Une accent color
  vibrante mais pas criarde — quelque chose de mémorable. Inspiration
  possible : violet/indigo Linear, vert électrique Cron, teal/cyan ?
- **Typographie** — Une seule famille pour le système (Inter, Geist, ou
  équivalent moderne — preference pour des fontes variables avec un bon
  rendu en cyrillique/accents français/emojis).
- **Iconographie** — Lucide (déjà dans la stack shadcn/ui par défaut) ou
  Phosphor. Cohérent avec la fonte choisie.
- **Logo + wordmark** — À créer. Préférence Manu : un logo "léger", pas
  trop techy, qui suggère la mise en relation/le nœud (le sens "nexus").
  Pas obligé d'être un nœud littéral, mais l'idée est là.

**Contrainte forte** : la stack technique impose **Tailwind CSS + shadcn/ui**.
Le design system doit être implémentable avec ces outils. Concrètement :
- Variables CSS pour les couleurs (les "themes" shadcn)
- Spacing scale Tailwind par défaut (0, 1, 2, 4, 8, 12, 16, 24...)
- Composants base shadcn (Button, Input, Dialog, Sheet, Toast, etc.) que
  le designer **personnalise** plutôt que de partir de zéro

## Périmètre du design

Le design est attendu en **plusieurs phases**, alignées sur la roadmap
produit (cf. `.agent/roadmap.md`) :

### Phase 1 — Identité + landing teasing (J4-pre, ≈ 2 j de dev)

- **Logo + wordmark Nexus** (versions claire/sombre, monochrome, favicon)
- **Palette + typo confirmées**
- **Page landing teasing** : 1 page, sections hero + features + waitlist
  email capture
  - URL : `nexusapp.chat`
  - Mobile-first, responsive, animée subtilement (Framer Motion)
  - Open Graph card
- **Format livraison** : Figma + tokens exportables (CSS variables) + assets
  (SVG logo, favicons multi-tailles)

### Phase 2 — App web V1 (J4, ≈ 2-3 sem de dev)

L'app principale, accessible sur `app.nexusapp.chat`, installable comme
PWA. C'est le gros morceau.

**Écrans clés à concevoir** (flow logique) :

1. **Auth**
   - Login (email + password, "se souvenir de moi", lien "mot de passe oublié")
   - Register (email + password + display name)
   - Mot de passe oublié (V2, peut sketcher l'écran)
2. **Onboarding** (post-register)
   - "Crée ton premier groupe" OU "Rejoins un groupe via invitation"
   - Capture du display name + avatar (upload optionnel)
3. **Layout principal** (3-pane sur desktop, drawer sur mobile)
   - Pane gauche : liste des groupes (avec badges notifs)
   - Pane centre : liste des conversations du groupe sélectionné (channels
     Discord, threads WhatsApp/Messenger plus tard)
   - Pane droit : la conversation active OU un écran "killer feature"
     (événement, sondage, dépense...)
4. **Écran conversation** (cœur du produit)
   - Liste de messages (auteur, avatar, timestamp, contenu, attachments,
     réactions)
   - Indicateur "X est en train d'écrire"
   - Composer (input texte, pièces jointes, emoji picker, reply, /commandes)
   - Header : nom de la conversation, indicateur source (badge Discord/
     WhatsApp/Messenger), participants, bouton "ouvrir dans l'app source"
   - Détection d'intention IA (cf. ADR-010) : suggestion inline
     "Créer un événement pour samedi 20h ?" avec [Créer] [Ignorer]
5. **Killer features** (à designer en mockup d'écrans, on dérivera les
   composants au moment de J5)
   - **Événements** : création, vue détail (date/lieu/RSVP), liste des
     RSVP, page publique partagée
   - **Sondages** : création, vote (1 choix / multi-choix), résultats
     temps réel
   - **Dépenses** : ajout, répartition (équitable / par parts / custom),
     écran "qui doit quoi à qui", marquer "réglé"
   - **Todos / listes** : items cochables, assignation à un membre,
     échéance optionnelle
6. **Pages publiques** (cf. ADR-010)
   - URLs courtes `/e/:slug` (event), `/p/:slug` (poll), etc.
   - Accessibles sans compte (qui a le lien voit)
   - Action requise → invite à se logger / créer un compte rapide
   - **Open Graph cards** soignées (image générée dynamiquement) pour que
     les liens partagés sur WhatsApp/Messenger soient beaux
7. **Réglages**
   - Profil (nom, avatar, mot de passe)
   - Notifications (push, sons, par groupe)
   - Connexions messageries (liste des bridges actifs, ajouter, déconnecter)
   - Sécurité (sessions actives, déconnecter tout)
8. **States transverses**
   - Loading (skeleton screens, pas de spinners moches)
   - Empty states (groupe vide, pas de notif, pas de message — illustrations
     légères)
   - Errors (réseau, permission, etc.)
   - Notifications toast

### Phase 3 — Mobile-spécifique (V2)

L'app web est responsive, donc la "version mobile" pour beta privée =
PWA installée sur smartphone. À designer : adaptations spécifiques mobile
(bottom nav, gesture back, taille touchpoints).

V2 native React Native aura besoin d'écrans légèrement adaptés mais c'est
hors scope V1.

## Contraintes techniques (à respecter par le design)

### Stack et tokens

- **CSS** : Tailwind CSS 4 + shadcn/ui (variables CSS pour les couleurs).
  Le designer livre **les tokens en CSS variables** (`--background`,
  `--foreground`, `--primary`, `--accent`, etc.) compatibles shadcn.
- **Composants** : la lib shadcn fournit déjà 50+ composants (Button,
  Input, Dialog, Sheet, Tooltip, Dropdown, Toast, Tabs, etc.). Le designer
  **personnalise** plutôt que de redessiner from scratch. Cohérence
  globale > originalité de chaque composant.
- **Fonts** : self-hosted (`/fonts/...` servis par Caddy) — pas de Google
  Fonts CDN pour la perf et la privacy.
- **Iconographie** : lucide-react (par défaut shadcn). Le designer peut
  proposer un autre set si justifié.

### Accessibilité (non-négociable)

- Contrastes WCAG AA minimum sur tous les couples texte/fond
- Tailles de touch targets ≥ 44px sur mobile
- Focus visible sur tous les éléments interactifs (pas juste hover)
- Support clavier complet (Tab, Esc, flèches dans les listes)
- `prefers-reduced-motion` respecté pour les animations
- Tous les icônes informatifs ont un `aria-label`

### Performance

- L'app doit être **rapide à se charger** (objectif Lighthouse Performance
  ≥ 90 sur mobile 4G). Implications design :
  - Pas de fonts trop variées (1-2 familles max)
  - Pas d'images/vidéos lourdes en first paint
  - Animations CSS/Framer Motion légères (transform/opacity, pas de
    box-shadow animées)
  - Skeleton screens plutôt que spinners

### Dark / Light

- **Dark mode = défaut** (l'app est utilisée beaucoup le soir)
- **Light mode = obligatoire** (PWA desktop, accessibilité, prefs user)
- **Switch** dans les réglages + suit `prefers-color-scheme` au premier
  load
- Les deux thèmes doivent être designés en parallèle (pas un dark posé
  par-dessus un light)

### Multi-plateforme

L'app web est livrée sur :
- Navigateur desktop (Chrome/Firefox/Safari/Edge ≥ 2 ans)
- Navigateur mobile (Chrome Android, Safari iOS ≥ 16)
- PWA installée (Android, iOS ≥ 16.4, Windows, macOS)
- Wrapper Tauri V1.5 (Windows, macOS, Linux — webview du système)

Le design doit fonctionner **sur tous** sans écran spécifique. Adaptations
prévues par breakpoints Tailwind :
- `< 640px` (sm) : layout 1-pane, bottom nav, drawer pour groupes/convs
- `640-1024px` (md→lg) : 2-pane, sidebar groupes + conversation
- `≥ 1024px` (lg+) : 3-pane (groupes + convs + détail)

## Format de livraison attendu

### Phase 1 (identité + landing)

1. **Figma** :
   - Page "Brand" : logo (vector source), versions, palette, typo, spacing
   - Page "Landing" : desktop + mobile, sections + interactions
2. **Assets exportés** :
   - Logo SVG (light + dark + monochrome)
   - Favicon (16, 32, 192, 512, apple-touch-icon)
   - OG image (1200×630) pour `nexusapp.chat`
3. **Tokens CSS** : un fichier `tokens.css` ou `theme.json` exploitable
   directement dans Tailwind config + shadcn theme

### Phase 2 (app web V1)

1. **Figma** :
   - Page "Design system" : tous les composants shadcn personnalisés,
     variantes (default, hover, focus, disabled, loading)
   - Page "Écrans" : tous les écrans listés ci-dessus, desktop + mobile,
     dark + light
   - Page "Pages publiques" : cards pour event/poll/expense/todo/list
     (incluant l'OG image dynamique)
   - Page "Empty states" : illustrations + copy
2. **Specs** :
   - Notes sur les interactions (animations, transitions, micro-interactions)
   - Comportements responsive (qu'est-ce qui change entre breakpoints)
3. **Assets** :
   - Illustrations (empty states, onboarding) en SVG ou React components
4. **Composants prêts** :
   - **Idéal** : un dépôt shadcn/ui custom (fork ou theme) que le dev
     installe via `npx shadcn add ...`
   - **Sinon** : specs précises dans Figma pour chaque composant +
     correspondance avec les composants shadcn existants

### Itération

Le design n'est pas figé : le dev (nexus-dev / Manu) renverra du feedback
au fur et à mesure de l'implémentation. Le designer doit prévoir 1-2
rounds de revisions par phase.

## Hors scope (pour l'instant)

- Animations vidéo / motion design poussé (V2)
- Illustrations sur-mesure 3D ou complexes (V2 — pour V1, illustrations
  vectorielles plates)
- Marketing site complet (juste la landing teasing pour l'instant)
- App store screenshots (V2 quand mobile native)
- Branding extension (merch, deck, etc.)

## Workflow proposé

1. **Brief** (ce document) → designer lit, pose ses questions à Manu
2. **Mood board + 3 directions visuelles** (1-2 j) → Manu choisit une
   direction
3. **Phase 1** (3-5 j) : identité + landing → Manu valide → dev intègre
4. **Phase 2 design system** (5-7 j) : palette finalisée + composants base
5. **Phase 2 écrans** (10-15 j) : tous les écrans V1, par lots (auth,
   layout principal, conversations, killer features, pages publiques,
   réglages)
6. **QA design** : pendant le dev, le designer reste dispo pour corriger
   les écarts entre Figma et l'implé

## Documents de référence

Pour comprendre Nexus en profondeur, le designer peut consulter :
- `.agent/roadmap.md` — roadmap produit complète
- `.agent/adr/ADR-010-killer-features-via-shared-links.md` — pourquoi le
  partage par lien est central
- `.agent/adr/ADR-014-web-first-monorepo.md` — pourquoi web prioritaire
- `.agent/notes/j3-plan.md` — plan technique J3 (utile pour comprendre
  ce qui est en cours côté backend)

## Questions ouvertes pour Manu

À préciser avant que le designer démarre, ou en réponse au mood board :

1. **Nom + ton** — "Nexus" est-il définitif ? Le wordmark doit-il être
   tout en majuscules, lowercase, ou capitalisé ? Y a-t-il une signification
   à graver (ex. "le nœud d'amitié" ?)
2. **Palette** — Dark-first OK pour Manu, mais accent color : Manu a-t-il
   une préférence (violet, vert, teal, orange...) ? Ou laisser le designer
   proposer ?
3. **Logo style** — Géométrique abstrait (ex. nœud stylisé), wordmark seul
   (Linear-style), ou pictogramme + wordmark ?
4. **Tone of voice** dans les copy UI — tutoyer ou vouvoyer ? Plutôt
   chaleureux ("Hey, on commence ?") ou neutre ("Bienvenue") ?
5. **Public cible** — confirmer 25-40 ans urbain ? L'esthétique peut
   varier sensiblement selon ça.

---

## Comment utiliser ce brief

Si le designer est **Claude design** (autre instance Claude avec capacités
design Figma) :
- Coller ce document tel quel comme prompt initial
- Ajouter en complément : *"Avant de commencer, lis les documents
  référencés dans `.agent/`, propose-moi un mood board avec 3 directions
  visuelles distinctes, et liste les questions ouvertes que tu as."*

Si le designer est **un humain** :
- Ce document est un brief autonome, partageable tel quel
- Prévoir un kick-off call de 30 min avec Manu pour répondre aux questions
  ouvertes

---

*Brief rédigé le 2026-05-01 par nexus-dev.*
