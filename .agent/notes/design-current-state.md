# État actuel du design Nexus — brief contextuel pour Claude design

> Document destiné à être passé à Claude design en complément du brief
> d'extraction du DS easyticket. Il décrit ce qui existe **aujourd'hui**
> dans le repo, pour que les livrables soient une **migration ciblée**
> et pas un greenfield.

## 1. Stack frontend

- Monorepo pnpm + Turborepo (cf. ADR-001).
- Frontend principal : `packages/web` (SPA Vite + React 18 + TS).
- `packages/landing` réutilise les sources de `web` via alias Vite.
- `packages/desktop` (Tauri) et `packages/platform`/`platform-web` posés
  pour l'avenir, encore légers.
- Mobile React Native : non démarré (V2).
- Tailwind est installé mais **peu utilisé en pratique** : le code écran
  est massivement en **inline styles** via un objet `NX` qui pointe sur
  les CSS variables. C'est un choix structurant à reconsidérer (cf. §6).
- shadcn/ui : pas installé. Les CSS variables suivent la convention
  shadcn (`--background`, `--foreground`, `--primary`, etc.) pour
  faciliter une éventuelle adoption.
- Icônes : Phosphor (set Regular) inline SVG via composant `PhIcon`.
- Police : **Inter** (Google Fonts) — déjà chargée par défaut.
- Données : TanStack Query + Zustand, TanStack Router (code-based).

## 2. Thème actuel : "Neon Dusk"

Theme **dark par défaut**, light mode aussi défini, switch via
`[data-theme='light' | 'dark']` sur `<html>`.

### Palette dark (extrait, source : `packages/web/src/styles/tokens.css`)

| Rôle              | HSL                | HEX approx |
|-------------------|--------------------|------------|
| `--background`    | `240 50% 4%`       | `#0a0a0f` |
| `--card`          | `240 29% 6%`       | `#0f0f18` |
| `--popover`       | `240 22% 10%`      | `#14141f` |
| `--muted`         | `240 18% 14%`      | `#1a1a2a` |
| `--foreground`    | `252 33% 95%`      | `#f0eef6` |
| `--primary`       | `248 85% 74%`      | `#9080f8` (violet) |
| `--accent`        | `209 100% 83%`     | `#a8d8ff` (bleu pastel) |
| `--destructive`   | `0 92% 79%`        | `#fb9999` |
| `--ring`          | `248 85% 74%`      | (= primary) |
| `--radius`        | `0.875rem`         | (14px) |

### Tokens sémantiques Nexus (`--nx-*`)

- Surfaces : `--nx-bg`, `--nx-surface`, `--nx-elevated`, `--nx-raised`
- Bordures : `--nx-border`, `--nx-border-hover` (rgba blanc 7→14% en dark)
- Primary : `--nx-primary`, `-hover`, `-deep`, `-muted`, `-text`
- Foreground : `--nx-fg`, `-muted` (58%), `-dim` (32%), `-ghost` (16%)
- Sémantique : `--nx-success` `#7dd3a0`, `--nx-error` `#fb9999`,
  `--nx-warning` `#f5c977`, `--nx-info` `#9fbef6` + leurs `-bg`
- **Couleurs sources messageries** (essentiel — à conserver) :
  - `--nx-discord` `#8ea0e6` / bg 12%
  - `--nx-whatsapp` `#7ad99b` / bg 12%
  - `--nx-messenger` `#7fb6f5` / bg 12%
- Radius : `--radius` (14px), `--nx-radius-sm` (10), `--nx-radius-xs`
  (6), `--nx-radius-pill` (24)
- Transitions : `--nx-transition-fast` 150ms, `--nx-transition-normal`
  250ms, easing custom `cubic-bezier(0.16, 1, 0.3, 1)`

### Light mode (déjà défini)

- `--background` `#fafafd` clair lavande, surface `#f4f3f8`, elevated
  blanc pur.
- Primary plus saturé pour contraste : `#6a59e8`.
- Bordures opaques `rgba(20, 20, 35, 0.10)`.

> Le système de switch dark/light est déjà fonctionnel et l'agent doit
> impérativement préserver la **continuité** des deux thèmes (cf. §6).

## 3. Composants primitifs existants (`packages/web/src/components/ui/`)

| Composant | Variantes / props clés | Notes |
|-----------|-------------------------|-------|
| `Button`  | variant: primary / secondary / ghost / destructive ; size sm/md/lg ; loading, leftIcon, rightIcon, fullWidth | borderRadius = `radiusPill` (très arrondi), fontWeight 600 |
| `Badge`   | tone: neutral / primary / success / warning / error / info / discord / whatsapp / messenger ; size sm/md | pill, fontSize 10-11px, fontWeight 600 |
| `Input`   | label, error, hint | radius `--nx-radius-sm` (10px), focus ring 3px en `primary-muted` |
| `Toggle`  | on, onChange, ariaLabel | iOS-style 40×22, knob blanc 18×18 |
| `Avatar`  | name (initiale + couleur déterministe par hash), size, src | radius = 28% de la taille |
| `Logo`    | logo Nexus | — |
| `PhIcon`  | wrapper Phosphor inline SVG | — |

**Tous les primitifs sont écrits en inline styles**, pas en classes
Tailwind. Refactor probable lors de la migration vers le nouveau DS.

## 4. Écrans existants (`packages/web/src/screens/`)

```
auth/
  AuthShell.tsx
  LoginScreen.tsx        (148 lignes)
  RegisterScreen.tsx
  ForgotPasswordScreen.tsx
  OnboardingScreen.tsx
app/
  AppShell.tsx           (597 lignes — 3-pane desktop : groupes / channels / chat)
  MobileShell.tsx        (stack mobile)
  ChatView.tsx           (composer + messages WS)
  GroupMenu.tsx
  killer-features/
    EventDetail.tsx      (RSVP)
    PollDetail.tsx       (sondage + barres votes)
    ExpenseDetail.tsx    (Tricount-like, soldes)
    TodoDetail.tsx
    shared.tsx
features/
  EventsDashboard.tsx, PollsDashboard.tsx,
  ExpensesDashboard.tsx, TodosDashboard.tsx
  FeatureShell.tsx, Placeholder.tsx
public/
  PublicEventScreen.tsx, PublicPollScreen.tsx,
  PublicExpenseScreen.tsx, PublicTodoScreen.tsx,
  PublicListScreen.tsx
  PublicShell.tsx
  og-meta.tsx            (rendu OG card)
settings/
  SettingsScreen.tsx     (4 sections : profil / notifs / connexions / sécurité)
landing/
  LandingScreen.tsx      (688 lignes — hero / problem / features / how-it-works / waitlist)
oauth/
  OAuthCallbackScreen.tsx (popup Discord OAuth)
```

L'app shell est un layout **3 colonnes** : rail gauche (groupes), liste
intermédiaire (channels), zone principale (conversation).
Mobile passe à un **stack** (`<768px`).

## 5. Conventions et contraintes héritées

### Architecture des tokens
- **Source de vérité unique** : `packages/web/src/styles/tokens.css`.
- `lib/tokens.ts` expose un objet `NX` dont chaque clé renvoie
  `var(--nx-*)`. Ça permet d'utiliser les tokens en inline-style sans
  perdre le switch de thème (résolu au paint, pas de re-render React).
- Le mapping shadcn (`--background`, `--primary`, etc.) est en place
  mais **shadcn lui-même n'est pas installé** — c'est juste une
  promesse de compatibilité.

### ADR contraignants
- ADR-014 web-first : la couche `platform` doit rester abstraite.
- ADR-015 auth cookie+CSRF.
- ADR-016 design system bundle : trace de la livraison initiale du
  design "Neon Dusk".
- ADR-018 Open Graph : les pages publiques `/e /p /d /t /l` ont des
  cards OG avec rendu côté serveur. Toute redesign de ces pages doit
  rester compatible.

### Animations existantes (à conserver)
- `fade-up`, `shake`, `spin-slow`, `spin-orbit`, `check-pop`, `float`,
  `pulse-glow`. Définies dans `tailwind.config.ts`.

## 6. Pain points et zones ouvertes pour la migration

L'agent design doit savoir où il a la main et où il ne l'a pas :

### Open / encouragé
- Repenser entièrement la palette si easyticket l'impose. Conserver les
  noms de tokens (`--nx-primary`, `--nx-fg`, etc.), changer les valeurs.
- Ajuster radius, spacing, ombres librement.
- Proposer un **light mode comme thème par défaut** si easyticket pousse
  dans cette direction (ce qui semble être le cas vu la capture). C'est
  un changement structurel mais le switch existe déjà côté code.
- Proposer une **typographie + échelle** différente si pertinent.
  Inter est déjà chargé mais on peut basculer.

### À conserver
- **Convention shadcn-compatible** des CSS variables (`--background`,
  `--foreground`, `--primary`, `--card`, `--popover`, `--muted`,
  `--accent`, `--destructive`, `--border`, `--ring`, `--radius`).
- **Slots `--nx-*` Nexus-spécifiques** : surfaces (bg/surface/elevated/
  raised), foreground muted/dim/ghost, sémantique success/warning/error/
  info, et **impérativement** les couleurs sources messageries
  (`--nx-discord`, `--nx-whatsapp`, `--nx-messenger` + bg).
- Les noms des **composants primitifs** (Button, Badge, Input, Toggle,
  Avatar) et leurs variantes sémantiques (`tone="discord"`, etc.).
- Animations existantes (`fade-up`, `check-pop`, etc.) — au minimum
  les noms.

### Recommandation forte
- Profiter de la migration pour **passer les primitifs en classes
  Tailwind/shadcn-cva** plutôt qu'inline styles. Le brief DS doit
  produire des exemples JSX compatibles shadcn-cva.
- Si easyticket utilise une autre famille typographique, donner les
  imports Google Fonts ou la stratégie locale.

## 7. Composants Nexus-spécifiques **manquants** dans easyticket

L'app easyticket est transactionnelle (liste + filtres). Nexus a des
patterns que la capture ne couvre pas et que Claude design doit
**proposer en complément** dans son livrable :

- **Item de conversation** dans la liste (avatar, nom, dernier message,
  timestamp, badge non-lu, badge source messagerie).
- **Bulle de message** : variantes entrante / sortante / système /
  suggestion IA inline (cf. détecteur d'intention).
- **Composer** : champ + boutons d'action + suggestions inline IA.
- **Carte killer feature inline** dans la conversation (mini-card
  Event/Poll/Expense/Todo avec CTA).
- **Carte killer feature pleine** (panneau de droite) avec liste de
  participants, RSVP, votes, balances.
- **Rail de groupes** (sidebar étroite) avec pastilles colorées par
  source active.
- **Indicator de présence / typing**.
- **Toast de notification** (nouveau message, événement créé).
- **Modal** (confirmation déconnexion compte messagerie).
- **OG card** (rendue côté serveur, doit rester recréable en SSR).

Pour chacun, proposer un design dans la lignée easyticket (light, peu
dense, bords arrondis, typographie hiérarchisée).

## 8. Référence fichiers

Pour donner à Claude design une carte du repo s'il veut creuser :

```
packages/web/
├── tailwind.config.ts
├── src/
│   ├── styles/
│   │   ├── tokens.css      ← source palette
│   │   └── global.css
│   ├── lib/
│   │   ├── tokens.ts       ← façade JS NX = { primary, fg, ... }
│   │   └── theme.ts        ← switch dark/light
│   ├── components/ui/
│   │   ├── Button.tsx, Badge.tsx, Input.tsx,
│   │   ├── Toggle.tsx, Avatar.tsx, Logo.tsx, PhIcon.tsx
│   │   └── index.ts
│   └── screens/
│       ├── auth/  app/  features/  public/  settings/
│       └── landing/  oauth/
```

Bundle de design **précédent** (réf. historique) :
`/.design_extracted/project/` avec 8 prototypes HTML +
`nexus-tokens.css` + `components.jsx` + `killer-features.jsx`.
À ne **pas** réutiliser comme source — le but est de remplacer.

## 9. Ce qu'on attend en sortie côté Nexus

À l'issue de la mission Claude design (livrables du brief easyticket
+ ce contexte) :

1. **`tokens.css` v2** — réécriture du fichier en gardant les noms,
   en remplaçant les valeurs.
2. **`tailwind.config.ts` v2** — éventuels ajouts de scale (typographie,
   spacing) et conservation des animations.
3. **Composants primitifs migrés** — Button, Badge, Input, Toggle,
   Avatar réécrits façon shadcn-cva (Tailwind + class-variance-authority),
   API publique inchangée.
4. **Composants nouveaux** — date range picker, time picker, segmented
   control "Cheapest/Recommended", range slider double, histogram, plus
   les composants Nexus-spécifiques de §7.
5. **Mapping écran-par-écran** — pour chaque écran de §4, indiquer
   quelles modifications appliquer (ou si l'écran est OK tel quel après
   bascule des tokens).

Une fois les livrables reçus, l'application en code se fera package par
package, écran par écran, avec un ADR `ADR-019-design-system-easyticket.md`
qui actera la décision et la stratégie de migration.
