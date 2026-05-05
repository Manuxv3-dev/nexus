# ADR-021 : Design System v2 — true Apple System Colors

**Date** : 2026-05-03
**Statut** : Accepté
**Remplace** : ADR-016 (design system bundle "easyticket reinterpretation")

## Contexte

Le DS livré par ADR-016 (bundle Claude Design "easyticket") combinait :

- Une base sombre type Linear/Nexus (violet `#9080F8`, fond `#0A0A0F`)
- Une réinterprétation light "easyticket" (CTA navy `#0F172A`, accent orange `#FF6A2C`)
- Des accents pastels par feature (Events violet `#7B6CD4`, Polls rose `#C4708F`,
  Expenses orange `#D08A52`, Todo teal `#4FB1A8`, Chat brand purple `#9080F8`)
- Une layout 3 colonnes (sidebar 260 / main 1fr / right rail 340)
- Police display Space Grotesk, body Inter
- Iconographie Phosphor

Cette base a été utilisée pour scaffolder l'AppShell et les 4 dashboards killer
features pendant J5b. Le bundle est cohérent, mais Manu (2026-05-03) a décidé de
pivoter vers une **identité Apple-inspired** — déclenchée notamment par une
capture macOS Liquid Glass (traffic light + frosted backdrop) qui correspond à
la direction visuelle visée.

Le pivot vise :

- Une identité plus reconnaissable et raffinée (palette Apple HIG = standard de
  facto, lecture immédiate)
- Une cohérence forte avec mobile (la roadmap mobile cible iOS 26 Liquid Glass,
  cf. uploads `ios-frame.jsx` / `android-frame.jsx`)
- Un alignement avec la décision pivot Messenger/WA = encapsulation webview
  Tauri "modèle Franz" (cf. mémoire `nexus_messenger_whatsapp_encapsulation.md`),
  qui implique de bien cohabiter avec les apps natives Apple

## Options envisagées

### Option A — Light touch Apple (garder pastels Claude)

Conserver l'identité du bundle (pastels par feature, navy CTA easyticket light)
mais emprunter à Apple : SF font sur mobile, Liquid Glass sur surfaces flottantes,
density-aware spacing, transitions spring.

**Pour** : continuité visuelle avec ce qui a déjà été livré (J5b), respect du
travail design existant, identité Claude conservée.
**Contre** : reste un "Claude design + petites touches Apple", pas vraiment Apple.
Mix de palettes qui peut sembler indécis.

### Option B — Full Apple HIG (abandon pastels Claude)

Adopter strictement les Apple System Colors (`systemBlue`, `systemGreen`,
`systemRed`, `systemOrange`, etc.), backgrounds Apple (`#FFFFFF` / `#000` /
`#F2F2F7` / `#1C1C1E`), surfaces Liquid Glass sur les éléments flottants.
Différenciation par feature via les couleurs system : Events=Blue,
Polls=Purple, Expenses=Orange, Todo=Green, Chat=Indigo. Pas de `systemPink`
(refusé explicitement par Manu).

**Pour** : identité immédiatement lisible, alignement parfait avec mobile iOS,
palette professionnelle et éprouvée, pas d'ambiguïté chromatique.
**Contre** : oblige une migration des composants déjà construits sur les
pastels (mais migration incrémentale possible). Perd l'orange easyticket
`#FF6A2C` du segmented active light.

### Option C — Hybride (Apple sur structure, pastels sur accent)

Apple pour les états système (success/warning/error/info), pastels Claude pour
les features.

**Pour** : compromis entre A et B.
**Contre** : Manu a explicitement rejeté ("non, je veux du true Apple sans
pastels"). N'apporte rien que A ne fasse mieux.

## Décision

**Option B — Full Apple HIG.**

Validation explicite par Manu (2026-05-03, deux questions/réponses successives) :

1. "Tu valides cette palette Apple-inspired ?" → "Non, je veux du true Apple
   (sans pastels)"
2. "Différenciation visuelle des 4 features ?" → "B — Une system color par
   feature (Recommandé)"

### Mapping features (final)

| Feature          | Light                    | Dark      |
| ---------------- | ------------------------ | --------- |
| **Events**       | `systemBlue` `#007AFF`   | `#0A84FF` |
| **Polls**        | `systemPurple` `#AF52DE` | `#BF5AF2` |
| **Expenses**     | `systemOrange` `#FF9500` | `#FF9F0A` |
| **Todo**         | `systemGreen` `#34C759`  | `#30D158` |
| **Chat / brand** | `systemIndigo` `#5856D6` | `#5E5CE6` |

`systemPink` est explicitement écarté (rejeté deux fois par Manu). Ne pas le
réintroduire.

### États système

| Rôle                          | Light                    | Dark      |
| ----------------------------- | ------------------------ | --------- |
| Primary action / link / focus | `systemBlue` `#007AFF`   | `#0A84FF` |
| Success                       | `systemGreen` `#34C759`  | `#30D158` |
| Warning                       | `systemOrange` `#FF9500` | `#FF9F0A` |
| Error / destructive           | `systemRed` `#FF3B30`    | `#FF453A` |
| Secondary text / icon         | `systemGray` `#8E8E93`   | `#8E8E93` |

### Backgrounds (Apple-aligned)

| Niveau                             | Light     | Dark                                  |
| ---------------------------------- | --------- | ------------------------------------- |
| `--nx-bg` (page)                   | `#FFFFFF` | `#000000` (true black, OLED-friendly) |
| `--nx-surface` (cards, sidebar)    | `#F2F2F7` | `#1C1C1E`                             |
| `--nx-elevated` (modals, popovers) | `#FFFFFF` | `#2C2C2E`                             |
| `--nx-raised` (subtle hover)       | `#F5F5F7` | `#3A3A3C`                             |

### Liquid Glass — scope d'application

**Uniquement sur les éléments flottants** (validation explicite Manu) :

- Sidebar
- Modals / dialogs
- Popovers / dropdowns
- Toasts
- Top bar mobile (status bar pill)

**PAS** sur :

- Content areas / dashboards (lisibilité)
- Cards killer features (lisibilité)

Pattern de spec :

```css
background: rgba(255, 255, 255, 0.78); /* light */
background: rgba(40, 40, 55, 0.65); /* dark */
backdrop-filter: blur(24px) saturate(160%);
-webkit-backdrop-filter: blur(24px) saturate(160%);
border: 0.5px solid rgba(255, 255, 255, 0.6); /* light */
border: 0.5px solid rgba(255, 255, 255, 0.12); /* dark */
box-shadow:
  0 1px 0 rgba(255, 255, 255, 0.6) inset,
  0 12px 40px rgba(0, 0, 0, 0.08);
```

### Logo

Variante "Atome" (3 orbites + 3 noyaux). Triade : `systemBlue` +
`systemGreen` + `systemIndigo`. Implémenté dans
`packages/web/src/components/ui/Logo.tsx`.

### Typographie

- **Display** : Space Grotesk 500/600/700 (à charger via Google Fonts)
- **Body** : Inter 400/500/600/700 (déjà chargé)
- **Mobile** : SF Pro System (`-apple-system, BlinkMacSystemFont`) — natif iOS

### Iconographie

Phosphor icons (déjà partiellement intégré via `PhIcon` component). Nouveau
mapping de glyphs disponible dans `_shared-v2.css` (codepoints `\e...`).
Migration vers le set complet à venir (J5c).

## Conséquences

### Positives

- Identité plus reconnaissable, alignement immédiat avec l'écosystème Apple
- Cohérence forte mobile/desktop (mêmes couleurs sur les deux plateformes)
- Accessibilité éprouvée (les Apple System Colors respectent WCAG AA contrast)
- Glass tokens réutilisables pour tous les éléments flottants futurs
- Réduction de la surface de personnalisation (palette plus restreinte)
- Préparation propre pour le futur ADR mobile iOS 26 strict

### Négatives

- Migration nécessaire : `tokens.css`, `tokens.ts`, AppShell, 4 dashboards,
  landing, settings. Travail incrémental géré par la stratégie "tokens
  d'abord, composants progressifs" actée 2026-05-03.
- Perte de l'orange easyticket `#FF6A2C` (segmented active light) — remplacé
  par `systemBlue`. Manu peut le réintroduire ailleurs s'il manque.
- `_shared-v2.css` du bundle uploadé reste obsolète (pastels par feature) —
  source d'inspiration historique mais ne correspond plus à la spec.
- Risque visuel transitoire pendant la migration progressive : certains screens
  peuvent rester en pastels pendant que d'autres sont déjà migrés. Acceptable.

### Neutres

- ADR-016 (design system bundle) est marqué "Remplacé par ADR-021". On garde
  la trace pour l'historique des décisions.
- Les composants Hubble (couche IA) restent mis de côté dans tous les cas
  (cf. cadrage 2026-05-03 — "ne tiendras pas compte des composants liés à la
  feature IA").
- Le mapping shadcn (`--primary`, `--secondary`, etc.) est repris pour rester
  compatible avec les composants UI déjà installés.
