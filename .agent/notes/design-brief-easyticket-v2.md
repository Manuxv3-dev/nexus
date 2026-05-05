# Brief Claude design — Extraction du DS easyticket pour Nexus (v2)

> Version 2 du brief, intégrant les décisions cadrantes actées dans
> ADR-019. À copier-coller dans une session Claude design avec :
>
> - la **capture easyticket** (jointe par Manu)
> - le document **`.agent/notes/design-current-state.md`** (état du repo)

---

## 0. Décisions cadrantes (ADR-019, statut Accepté)

Ces 4 décisions ne sont **pas négociables**. Le livrable doit s'y
conformer.

### D1 — Tailwind + shadcn-cva

Tous les composants primitifs sont écrits en \*\*Tailwind utility classes

- class-variance-authority\*\* (CVA). Pas d'inline styles. Les variants
  sont déclarés via `cva()` et typés. Exemple attendu :

```tsx
const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-55 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80',
        ghost: 'text-primary-foreground hover:bg-muted',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20',
      },
      size: {
        sm: 'px-3.5 py-1.5 text-xs',
        md: 'px-5 py-2.5 text-sm',
        lg: 'px-6 py-3 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);
```

### D2 — Réinterprétation dark Nexus + light fidèle à easyticket

- **Dark mode** : reste l'identité par défaut de Nexus. Tu réinterprètes
  l'esthétique easyticket (cartes, hiérarchie, pills, segmented controls,
  sliders, histogramme, time picker) en l'adaptant à un fond sombre
  cohérent avec l'univers Nexus. La primary reste violette/lavande
  (le différenciateur visuel Nexus).
- **Light mode** : fidèle à easyticket — fond gris très clair (≈
  `#F5F5F7`), surfaces blanches, primary CTA navy quasi-noir, accents
  bleu/orange/lavande comme dans la capture.
- Les deux modes doivent être **équivalents en fonctionnalité et en
  hiérarchie** : aucun composant ne doit n'exister que dans un mode.
- Le switch reste piloté par `[data-theme="light" | "dark"]` sur
  `<html>`. Dark = défaut.

### D3 — Adoption de shadcn/ui

- Le projet va installer shadcn/ui. Tes specs de composants doivent
  être **directement compatibles** avec `pnpm dlx shadcn@latest add`.
- Pour les composants avancés présents dans easyticket (Slider double,
  Calendar / DateRangePicker, Popover, Dialog, Command, Select,
  Tooltip, Switch), réfère-toi aux composants shadcn existants et
  donne juste les **overrides de classes** (custom variant, custom
  styling) — pas la réécriture intégrale.
- Pour les composants Nexus-spécifiques (Avatar avec couleur
  déterministe, Badge avec tons source-messageries, ChatView, AppShell,
  cartes killer features), donne le composant complet en CVA.
- `components.json` ciblé : `style: default`, `cssVariables: true`,
  `tailwind.css: src/styles/global.css`, `tailwind.config: tailwind.
config.ts`, `aliases.components: @/components`, `aliases.utils:
@/lib/utils`.

### D4 — Le bundle `.design_extracted/` est de l'archive

Le repo contient un dossier `.design_extracted/project/` issu d'une
**précédente** itération Claude design (DS "Neon Dusk", 8 protos
HTML). **Ne pas s'en servir comme source.** Si tu y trouves un
composant qui pourrait inspirer le DS easyticket, signale-le
explicitement plutôt que de le reprendre tel quel.

---

## 1. Contexte

Nexus est une plateforme d'agrégation de messageries (Messenger,
WhatsApp, Discord) augmentée d'une couche d'organisation pour bandes
d'amis (agenda partagé, événements, sondages, dépenses partagées,
todos). Stack frontend :

- React 18 + TypeScript + TailwindCSS, hébergé dans
  `packages/web` (Vite SPA).
- `packages/landing` réutilise les sources via alias Vite.
- Desktop Tauri prévu, mobile React Native prévu en V2.

Aujourd'hui le DS s'appelle "Neon Dusk", dark par défaut, primary
violet. Manu veut aligner Nexus sur l'esthétique de la capture
`easyticket` ci-jointe — sans abandonner la dimension dark Nexus
(cf. D2).

L'état actuel du repo (palette, composants existants, écrans, ADR
contraignants) est détaillé dans `design-current-state.md` joint.
**Lis-le avant de produire les livrables** — tu y trouveras les noms
de tokens à conserver, les composants à préserver, et les patterns
Nexus-spécifiques à intégrer.

## 2. Source

Capture jointe : page de recherche / résultats easyticket (booking
de billets de train).

## 3. Livrables attendus

### 3.1 Design tokens

Deux fichiers :

- **`tokens.css`** — réécriture complète, en gardant les **noms**
  des CSS variables actuelles (cf. `design-current-state.md` §2),
  en remplaçant les **valeurs**. Couvre dark + light mode complet,
  avec `:root, [data-theme="dark"]` et `[data-theme="light"]`.
- **`tailwind.config.ts`** (partiel) — extensions à ajouter au config
  existant : `colors` mappés sur les CSS variables (convention shadcn
  - bloc `nx.*`), `fontFamily`, `fontSize` (échelle complète),
    `borderRadius`, `boxShadow`, `spacing` (si tu déduis une échelle
    différente du défaut Tailwind), `keyframes` et `animation` (préserve
    les existants : fadeUp, shake, spinSlow, checkPop, float, pulseGlow).

Couvre :

- **Palette dark + light** complètes : surfaces (background, card,
  popover, muted, elevated, raised), foreground (default, muted,
  dim, ghost), primary (default, hover, deep, muted, text), accent,
  destructive, border, input, ring.
- **Sémantique** : success, warning, error, info — chacun avec sa
  variante `-bg` (fond teinté à 10-12%).
- **Couleurs sources messageries (impératif)** : `--nx-discord`,
  `--nx-whatsapp`, `--nx-messenger` + leurs `-bg`. Donne des valeurs
  cohérentes en dark **et** en light.
- **Typographie** : famille principale (Inter par défaut, mais propose
  une alternative si easyticket impose un autre choix), échelle
  complète xs→4xl avec font-size / line-height / letter-spacing /
  weight pour chaque pas, et l'usage attendu (`text-xs uppercase
tracking-wide` pour caption, `text-3xl font-bold tabular-nums`
  pour metric, etc.).
- **Espacements** : si tu observes une échelle non-Tailwind-default
  (multiples de 4px déjà couverts), précise les ajouts.
- **Border-radius** : valeurs sm/md/lg/xl/full + `--radius` (shadcn).
- **Shadows / elevations** : `--nx-shadow-sm`, `-md`, `-lg` adaptées
  dark + light. En dark, ombres = subtiles + glow primary léger en
  hover. En light, ombres = subtiles façon easyticket
  (`0 1px 3px rgba(0,0,0,0.04)`).
- **Iconographie** : Phosphor Regular est en place, stroke 1.5,
  taille standard 16/18/20px selon contexte. Confirme ou propose
  un changement (avec justification).

### 3.2 Spécifications composants

Un fichier **`components.md`** avec, pour chaque composant identifiable
dans la capture, une fiche :

- **Anatomie** (zones, padding interne, alignement)
- **Variantes observées** (dark + light, tailles, tons)
- **États** (default, hover, focus, active, disabled, selected)
- **API React proposée** (props, types)
- **Exemple JSX complet** en CVA (cf. D1) — directement collable
  dans `packages/web/src/components/ui/`

Composants à couvrir au minimum :

- Card / surface conteneur (avec et sans hover)
- Button : primary navy, secondary, ghost, destructive, icon-only,
  segmented (Cheapest/Recommended/seats-left)
- Badge / Pill : tones neutral, primary, success, warning, error,
  info, **discord, whatsapp, messenger** (Nexus-specific)
- Input texte (avec label, error, hint, leftIcon)
- Date range picker (le sélecteur "We 11 Sep – Fr 20 Sep" — utilise
  le Calendar shadcn avec custom styling)
- Stepper numérique (les +/- avec compteur, type "1 adult")
- Select / dropdown (utilise Select shadcn)
- Toggle switch (utilise Switch shadcn)
- Checkbox (utilise Checkbox shadcn)
- Time picker wheel (le "06/07/08 : 59/00/01 : PM" — composant
  custom car shadcn ne le couvre pas)
- Range slider double curseur (utilise Slider shadcn avec custom
  styling)
- Histogramme de distribution de prix (composant custom, donne le
  pattern SVG ou approche Tailwind avec divs height-scaled)
- Sidebar de filtres (panneau latéral avec sections collapsibles)
- Header / nav top (avec tabs textuels + indicateur souligné)
- Avatar (Nexus-specific : couleur déterministe par hash du nom,
  cf. comportement actuel `lib/tokens.ts:avatarColor`)
- Icon button (bell, settings, gear)
- Tabs textuels (utilise Tabs shadcn)
- Tooltip (Tooltip shadcn)
- Popover (Popover shadcn — pour les pickers inline)

### 3.3 Composants Nexus-spécifiques (absents de la capture)

À designer dans la **lignée d'easyticket** mais avec les besoins
spécifiques de Nexus. Pour chacun, livre la fiche complète + JSX CVA.

- **Item de conversation** (liste latérale) : avatar, nom du groupe,
  dernier message tronqué, timestamp relatif, badge non-lu, badge
  source messagerie. Variante "active" (sélectionné).
- **Bulle de message** : variantes entrante / sortante / système /
  suggestion IA inline. La bulle suggestion IA est cliquable et
  ouvre un panel killer-feature (Event/Poll/Expense/Todo).
- **Composer** : champ + boutons (attach, emoji, send) + zone de
  suggestions inline (chips proposées par le détecteur d'intention).
- **Carte killer feature inline** dans la conversation (mini-card
  Event/Poll/Expense/Todo avec CTA "Voir détails").
- **Carte killer feature pleine** (panneau latéral droit) avec :
  - Event : titre, date, lieu, participants, RSVP buttons
  - Poll : question, options avec barres de votes en %, voter
  - Expense : montant, payeur, répartition par membre, soldes nets
  - Todo : titre, items checkables, assigné à
- **Rail de groupes** (sidebar étroite ≈ 64px) : avatars de groupes
  - pastilles colorées par source messagerie active (point coloré
    en bas-droite de l'avatar).
- **Indicator de présence** (point vert/orange/gris sur l'avatar).
- **Indicator de typing** (3 points animés).
- **Toast de notification** (variants info / success / warning /
  error) — utilise Sonner shadcn.
- **Modal** de confirmation (utilise Dialog shadcn) — variants
  default / destructive.
- **OG card** (rendue côté serveur) : variantes Event / Poll /
  Expense / Todo / List. Format 1200×630, doit rester re-créable
  sans JS (HTML+CSS pur côté backend).

### 3.4 Adaptation Nexus — Mapping écran-par-écran

Un fichier **`nexus-mapping.md`** qui projette le DS sur les écrans
existants. Pour chaque écran de Nexus, dis :

1. Quels composants du DS easyticket réutiliser
2. Quels composants Nexus-spécifiques (§3.3) y placer
3. Quels ajustements de layout faire
4. Si l'écran reste essentiellement OK avec juste un swap de tokens

Écrans à couvrir :

- `auth/` : LoginScreen, RegisterScreen, ForgotPasswordScreen,
  OnboardingScreen
- `app/` : AppShell (3-pane desktop), MobileShell (stack mobile),
  ChatView, GroupMenu
- `app/killer-features/` : EventDetail, PollDetail, ExpenseDetail,
  TodoDetail
- `features/` : EventsDashboard, PollsDashboard, ExpensesDashboard,
  TodosDashboard, FeatureShell
- `public/` : PublicEvent, PublicPoll, PublicExpense, PublicTodo,
  PublicList, PublicShell
- `settings/` : SettingsScreen (4 sections : profil, notifs,
  connexions, sécurité)
- `landing/` : LandingScreen (hero, problem, features, how-it-works,
  waitlist, footer)
- `oauth/` : OAuthCallbackScreen

### 3.5 Globals CSS

Un fichier **`global.css`** prêt à remplacer l'actuel, avec :

- Imports Tailwind (`@tailwind base/components/utilities`)
- Import du `tokens.css` v2
- Reset `box-sizing`, `body`, scrollbar custom
- Helpers utilities Nexus (`.scrollbar-hidden`, `.nx-border`)
- `@media (prefers-reduced-motion: reduce)` block
- Tout polyfill ou utility nécessaire pour les nouveaux composants

## 4. Contraintes

- Tout doit être **directement compilable** dans un projet Vite +
  React 18 + Tailwind 3 + shadcn/ui. Pas de DSL maison, pas de
  dépendances exotiques.
- Les **noms de tokens existants** restent (cf. §2 du
  `design-current-state.md`). Tu changes les valeurs, pas les noms.
- Les **animations existantes** (fadeUp, shake, spinSlow, checkPop,
  float, pulseGlow) sont conservées au minimum dans leur **nom**
  (les valeurs peuvent évoluer si tu justifies).
- Reste fidèle à la capture **mais signale clairement** ce qui est
  interpolé/déduit vs. ce qui est directement observable.
- Ne rédige pas de prose marketing : c'est un livrable technique,
  dense et précis.
- Si tu fais un choix qui n'est pas évident depuis la capture
  (ex : valeur précise d'un radius ou d'un letter-spacing), justifie
  en une phrase.

## 5. Format de sortie

Cinq blocs de fichiers, chacun dans un code block markdown taggé
avec son chemin :

```css:packages/web/src/styles/tokens.css
…
```

```ts:packages/web/tailwind.config.ts
…
```

```css:packages/web/src/styles/global.css
…
```

```md:components.md
…
```

```md:nexus-mapping.md
…
```

Plus, en bonus, **un fichier par composant** primitif et nouveau,
chacun dans son code block taggé avec le chemin cible :

```tsx:packages/web/src/components/ui/Button.tsx
…
```

```tsx:packages/web/src/components/conversation/ConversationItem.tsx
…
```

(etc.)

Pour que je puisse les déposer tels quels dans le repo.

## 6. Livraison

Travaille de manière séquentielle :

1. **Tokens** d'abord (palette dark + light complètes).
2. **Composants primitifs migrés** (Button, Badge, Input, Toggle,
   Avatar, Logo, PhIcon).
3. **Composants avancés easyticket** (DateRangePicker, RangeSlider,
   Histogram, TimePicker, SegmentedControl, Stepper).
4. **Composants Nexus-spécifiques** (ConversationItem, MessageBubble,
   Composer, KillerFeatureCard, etc.).
5. **Globals CSS + tailwind.config.ts**.
6. **Mapping écran-par-écran**.

Si la livraison est trop volumineuse pour un seul tour, livre par
phases et signale-moi explicitement les lots.
