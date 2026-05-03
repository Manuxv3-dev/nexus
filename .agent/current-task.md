# Tâche en cours

**Statut** : ✅ Session 2026-05-03 (refonte DS) — quick wins + bloc fondateur
DS v2 livrés. À commit + push côté Manu.

## 🎯 Action immédiate côté Manu

```powershell
cd C:\Users\Manu\claude\nexus\nexus

# Vérifs
pnpm typecheck
pnpm lint
pnpm --filter @nexus/web dev   # vérif visuelle rapide (logo + tokens)

# Commit en 2 morceaux propres :
git add packages/web/src/components/ui/Logo.tsx `
        packages/web/src/screens/landing/LandingScreen.tsx
git commit -m "feat(web): logo Atome (Apple Blue/Green/Indigo) + nouvelle tagline landing"

git add packages/web/src/styles/tokens.css `
        packages/web/src/lib/tokens.ts `
        .agent/adr/ADR-021-design-system-v2-apple.md `
        .agent/README.md `
        .agent/current-task.md
git commit -m "feat(web): DS v2 Apple — tokens.css + tokens.ts (ADR-021)

- Backgrounds Apple-aligned (#FFFFFF / #000 / #F2F2F7 / #1C1C1E)
- Primary = systemBlue, Success = systemGreen, Warning = systemOrange,
  Error = systemRed, Brand accent = systemIndigo
- Mapping features : Events=Blue, Polls=Purple, Expenses=Orange,
  Todo=Green, Chat=Indigo (cf. ADR-021)
- Liquid Glass tokens (--nx-glass-bg, --nx-glass-blur, ...) pour
  sidebar / modals / popovers / toasts
- Nouveaux helpers featureColor[key], featureBg[key], FeatureKey
- Shadcn tokens HSL re-mappés (primary, ring, destructive)
- Compat radius=14 conservée + nouveaux radiusXl/Lg/Md/Sm/Xs
- Invalide ADR-016 (bundle easyticket) et ADR-019"

git push
```

## 📦 Livré ce passage (refonte DS — bloc fondateur)

### Quick wins (déjà code)

- ✅ **Logo Atome** dans `packages/web/src/components/ui/Logo.tsx`
  3 orbites + 3 noyaux Apple : systemBlue + systemGreen + systemIndigo
- ✅ **Tagline landing** dans `LandingScreen.tsx:223`
  « Une app pour discuter, planifier et partager — sans jongler entre dix outils. »

### Spec figée

- ✅ **ADR-021** rédigé : `.agent/adr/ADR-021-design-system-v2-apple.md`
  (remplace ADR-016 + ADR-019)
- ✅ Mapping features acté :
  - Events → systemBlue (`#007AFF` / `#0A84FF`)
  - Polls → systemPurple (`#AF52DE` / `#BF5AF2`) — pas de pink
  - Expenses → systemOrange (`#FF9500` / `#FF9F0A`)
  - Todo → systemGreen (`#34C759` / `#30D158`)
  - Chat / brand → systemIndigo (`#5856D6` / `#5E5CE6`)

### Migration tokens

- ✅ **`packages/web/src/styles/tokens.css`** — réécriture complète
  - Light bg `#FFFFFF`, dark bg `#000000` (true black OLED)
  - Apple system colors pour primary / success / warning / error
  - Backgrounds en hiérarchie 3 niveaux (Apple-aligned)
  - Tokens `--nx-feat-*` (5 features)
  - Tokens `--nx-glass-*` (Liquid Glass : bg, border, blur, shadow)
  - Shadcn tokens re-mappés en HSL (primary, ring, destructive)
- ✅ **`packages/web/src/lib/tokens.ts`** — façade JS étendue
  - Tous les nouveaux tokens exposés (NX.featXxx, NX.glassXxx, NX.shadowXxx)
  - Helpers `featureColor[key]` + `featureBg[key]` + type `FeatureKey`
  - Compat préservée : `radius: 14`, `accentMuted` deprecated mais maintenu

### Conséquences immédiates

- L'app va changer **visuellement** dès le rebuild :
  - Light theme : fond blanc, primary bleu Apple (au lieu de navy easyticket)
  - Dark theme : fond noir pur, primary bleu Apple (au lieu de violet)
- Composants existants qui utilisent `NX.primary`, `NX.accent`, etc., se
  remappent automatiquement → pas de cassure mais changement de teinte
- Les screens utilisant les pastels Claude **hardcodés** (ex. `#7B6CD4`
  pour Events) restent inchangés tant qu'on ne les migre pas

## 🔁 Prochaine session — suite logique

Dans l'ordre :

1. **Migration des screens vers les nouveaux feature tokens** (utiliser
   `featureColor.events` au lieu de hardcoder `#7B6CD4`) — touche AppShell,
   EventsDashboard, PollsDashboard, ExpensesDashboard, TodosDashboard,
   ChatView, pages publiques.
2. **Refonte landing — densité visuelle** (tâche #7) : mockups dans le hero,
   sections "comment ça marche", screenshots dashboards refaits, social proof.
3. **Charger Space Grotesk** (display font v2) via Google Fonts dans le
   index.html des packages web + landing.
4. **Migration vers Phosphor icons complet** (codepoints du `_shared-v2.css`
   uploadé) — actuellement `PhIcon` component n'a qu'un sous-set.
5. **Adapter le Liquid Glass aux composants concernés** (sidebar AppShell,
   modal d'event, toast event:reminder) — utiliser `NX.glassBg`, `NX.glassBlur`.

## ⏭️ Backlog général (rappel)

Ordonnancement priorisé :

1. **#44 Tests d'intégration mutations critiques** (RSVP, vote, expense,
   todo) — non commencé
2. **#4 ADR de remplacement Messenger/WA = webview Tauri** — non commencé
3. **#5 Système de notifications transverses** (V1.2) — spec actée
4. **#7 Refonte landing densité visuelle** — en cours (tagline OK, reste le
   visuel)
5. **#8 Refonte composants progressive** — en cours (logo + tokens OK,
   reste les screens)

## Blockers

Aucun. Migration des composants peut s'enchaîner autour des autres priorités.
