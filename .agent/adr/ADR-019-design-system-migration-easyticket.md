# ADR-019 : Migration du design system vers une réinterprétation dark de l'esthétique easyticket

**Date** : 2026-05-01
**Statut** : Accepté

## Contexte

ADR-016 a acté le design system "Neon Dusk" livré par Claude Design dans
le bundle `nexus_design.zip` (8 écrans HTML + tokens CSS + composants
mock). Trois mois plus tard (J0→J5 livrés, dont auth web, AppShell
3-pane, ChatView WS, killer features seedées et flow Discord
fonctionnel de bout en bout), Manu a fourni une nouvelle référence
visuelle (capture de l'app `easyticket`) et demandé d'aligner Nexus
sur ce DS.

L'esthétique easyticket est radicalement différente de Neon Dusk :
- **Light par défaut**, surfaces blanches sur fond gris très clair
  (≈ `#F5F5F7`).
- Cartes avec ombres subtiles, radius moyen (≈ 12-16px).
- Hiérarchie typographique forte (gros chiffres pour les data points,
  meta en gris muted).
- Pills colorées (orange "Cheapest", lavande "Recommended", "Popular"),
  CTA primary en **navy quasi-noir** (≠ violet primary actuel).
- Beaucoup d'espace blanc, peu dense.
- Composants avancés : segmented controls, range slider double curseur,
  histogramme de distribution, time picker wheel, date range picker.

Quatre questions structurelles à trancher avant de commander
l'extraction du DS à Claude design.

## Options envisagées

### Q1 — Stratégie d'écriture des composants : inline styles vs Tailwind/cva

**Option A** — Garder l'inline style + façade `NX` (statu quo ADR-016).
Pros : continuité immédiate, aucun refactor. Cons : pas de
responsive utilities Tailwind, pas de variants typés via CVA,
duplication des styles, dette qui grossit avec le nombre de composants.

**Option B** — Migrer les primitifs vers shadcn-cva (Tailwind +
class-variance-authority). Tokens toujours résolus via CSS variables
(`bg-primary`, `text-foreground`, etc. mappés sur `var(--primary)`,
etc.).
Pros : aligné avec l'écosystème React 2026, primitives accessibles
en standard, variants déclaratifs et typés, classes Tailwind = moins
de code custom, responsive trivial. Cons : refactor des 7 primitifs
+ ajustement de tous leurs call-sites (~30 fichiers).

### Q2 — Mode par défaut : light ou dark ?

**Option A** — Bascule sur **light par défaut** (fidèle à easyticket).
Pros : maximum de fidélité au DS source. Cons : changement complet
d'identité visuelle Nexus (Neon Dusk = signature dark violette
établie dans landing + pages publiques + OG cards).

**Option B** — **Réinterprétation dark** d'easyticket, avec light
mode dérivé cohérent.
Pros : conserve l'identité Nexus (dark violet) tout en adoptant
les patterns d'organisation, hiérarchie et composants d'easyticket
(cartes, pills, segmented, sliders, histogramme). Le light mode
reste fidèle à easyticket. Cons : exige de Claude design un
exercice de **traduction stylistique** plus fin que de l'extraction
brute.

**Option C** — Bascule complète vers light, abandon du dark.
Pros : simpler. Cons : perte du différenciateur visuel + hostile
en usage du soir / messagerie.

### Q3 — Adoption de shadcn/ui

**Option A** — Garder uniquement la convention CSS variables
shadcn-compatible (statu quo).
Pros : zéro dépendance ajoutée. Cons : on réécrit nous-mêmes des
composants que shadcn fournit (Dialog, DropdownMenu, Popover, Command,
Tooltip, Select, Calendar, Slider, etc.) — beaucoup de surface dans
les composants avancés easyticket.

**Option B** — Installer shadcn/ui via `pnpm dlx shadcn@latest init`
puis `add` les primitifs au fur et à mesure. Garder nos primitifs
sémantiques propres (Avatar avec couleur déterministe, Badge avec
tones source-messageries) en surcouche.
Pros : ne pas réinventer la roue sur Dialog/Popover/Slider/Calendar/
Command. Composants maintenus, accessibles, headless-friendly.
Tailwind-cva natif dans shadcn = cohérent avec Q1.B. Cons : dépendances
supplémentaires (Radix UI), discipline pour ne pas tout shadcn-iser
(garder nos composants Nexus-spécifiques).

### Q4 — Statut du bundle `.design_extracted/` précédent

**Option A** — Le supprimer. Pros : net. Cons : perte de référence
historique pour expliquer comment on en est arrivé là.

**Option B** — Le marquer comme archive et le passer à Claude design
en référence "à NE PAS réutiliser".
Pros : trace historique conservée, pas de risque de panachage.
Cons : aucun.

## Décision

| Question | Décision |
|----------|----------|
| Q1 | **Option B** — Migrer vers Tailwind + shadcn-cva. Façade `NX` JS supprimée à terme, classes Tailwind partout. |
| Q2 | **Option B** — Réinterprétation dark Nexus de l'esthétique easyticket, light mode fidèle à la capture. |
| Q3 | **Option B** — Installer shadcn/ui et adopter ses primitifs pour les composants avancés (Dialog, Popover, Slider, Calendar, Command, Select, Tooltip, etc.). Conserver nos composants Nexus-spécifiques (Avatar déterministe, Badge tons source, ChatView, AppShell). |
| Q4 | **Option B** — `.design_extracted/` reste, marqué archive, signalé à Claude design comme contexte historique uniquement. |

## Conséquences

### Positives
- Cohérence avec l'écosystème React 2026 (Tailwind + shadcn = standard).
- Composants avancés (Slider double, Calendar, Command palette, Popover)
  obtenus gratuitement, accessibles et maintenus.
- Variants typés via CVA → moins de bugs visuels par dérive.
- Identité Nexus dark préservée, gain de qualité sur la hiérarchie
  visuelle et la densité d'information (apport easyticket).
- Light mode plus crédible (fidèle à une référence éprouvée).

### Négatives
- Refactor lourd : 7 primitifs (Button, Badge, Input, Toggle, Avatar,
  Logo, PhIcon) + tous les call-sites (~30 fichiers d'écrans). À
  séquencer en plusieurs commits par primitif.
- Dépendances ajoutées : Radix UI (via shadcn), CVA, clsx, tailwind-merge.
  Surface d'attaque sécurité légèrement augmentée.
- Risque de "shadcn-iser" abusivement → discipline d'équipe à tenir.
- Bascule visuelle perceptible pour les early-users (reconnu, accepté).

### Neutres
- Les CSS variables `--background`, `--foreground`, `--primary`, etc.
  restent la source de vérité. Seules leurs valeurs changent.
- Les tokens Nexus-spécifiques (`--nx-discord`, `--nx-whatsapp`,
  `--nx-messenger`, `--nx-fg-muted`, etc.) sont préservés tels quels.
- Le switch dark/light reste piloté par `[data-theme]` sur `<html>`.
- Inter reste la police par défaut (à reconfirmer après livrable
  Claude design — easyticket pourrait imposer un autre choix).

## Plan d'exécution proposé

1. **Lancement Claude design** (cf. brief
   `.agent/notes/design-current-state.md` + brief easyticket fourni
   par Manu) → livrables : `tokens.css` v2, `tailwind.config.ts` v2,
   `components.md` (specs CVA), `globals.css` shadcn-compatible,
   mapping écran-par-écran.
2. **Setup shadcn/ui** : `pnpm add class-variance-authority clsx
   tailwind-merge` côté `@nexus/web`, `pnpm dlx shadcn@latest init`
   pointant sur `src/styles/tokens.css`, `components.json` configuré
   en `style: default` + `cssVariables: true`.
3. **Migration tokens** : remplacer `tokens.css` par la v2 livrée.
   Vérification visuelle écran par écran avant de toucher au code TS.
4. **Migration primitifs** (un par PR) : Button → Badge → Input →
   Toggle → Avatar → Logo → PhIcon. Pour chacun, commit séparé qui
   migre le primitif + ses call-sites.
5. **Ajout des nouveaux composants** demandés en §7 du brief
   contextuel (item conversation, bulle message, composer, OG card,
   etc.) selon le mapping livré.
6. **Re-validation visuelle** : tour des 8 familles d'écrans
   (auth, app, killer-features, public, settings, landing, oauth,
   onboarding) pour caler les détails.
7. **Suppression de la façade `NX`** une fois tous les call-sites
   migrés. Conservation temporaire de `lib/tokens.ts` en `@deprecated`
   le temps de la transition.

Chaque étape est une tâche trackée dans `current-task.md` /
`backlog.md`. Estimation à la louche : 2-3 sessions de travail
denses pour une migration propre, hors temps de livraison Claude
design.

## Liens

- ADR-016 : décision initiale d'adoption du DS Neon Dusk
- `.agent/notes/design-current-state.md` : état actuel détaillé
  (palette, composants, écrans, contraintes)
- `.design_extracted/` : bundle Neon Dusk historique (archive,
  ne pas réutiliser comme source)
