# ADR-031 : Pipeline de release desktop Tauri (Windows V1)

**Date** : 2026-05-07
**Statut** : Accepté

## Contexte

Le shell Tauri 2 vit dans `packages/desktop/` (cf. ADR-026). Jusqu'ici il n'a
été buildé qu'en local (`pnpm tauri:build`), sans pipeline CI ni stratégie de
distribution. Pour passer à une V1 publique, il faut :

1. Un build reproductible déclenché par tag git
2. Un canal de distribution (GitHub Releases, déjà utilisé par la landing
   pour le bouton "Télécharger")
3. Un mécanisme d'auto-update silencieux (sinon les utilisateurs restent
   bloqués sur la première version pour toujours)
4. Une décision claire sur le code-signing (cher) vs le SmartScreen warning
   (gratuit mais friction au premier lancement)

Le SPA `@nexus/web` est déjà servi en prod sur `https://app.nexusapp.chat`
via Caddy/Traefik. En mode Tauri, le SPA est embedded (chargé depuis
`tauri://localhost`) et doit faire ses appels API vers `api.nexusapp.chat`
en absolu — alors qu'en mode web il utilise des paths relatifs.

## Options envisagées

### Code-signing

**A. Pas de cert** : Windows SmartScreen affiche "Éditeur inconnu" au premier
lancement. L'utilisateur clique "Informations complémentaires" → "Exécuter
quand même". Friction modérée. La réputation Microsoft s'améliore après
~quelques centaines de download → SmartScreen se calme tout seul.
Coût : 0€.

**B. Certificat OV** : ~150-300€/an, signature OK pour l'OS mais SmartScreen
reste sceptique au début (réputation par certif).

**C. Certificat EV** : ~400-600€/an, SmartScreen accepte sans warning dès le
premier run. Distribution sur clé USB physique.

### Distribution

**A. GitHub Releases** : standard pour les apps open-source / indie. Free.
Déjà utilisé par la landing pour le bouton "Télécharger".

**B. Microsoft Store** : payant (~75€ one-shot), validation manuelle, audit
sur chaque update. Pas pertinent pour MVP.

**C. Hostinger VPS direct** : héberger les `.exe` nous-même. Bandwidth coût,
pas de signature, pas de mirror.

### Auto-update

**A. Tauri updater natif** (`tauri-plugin-updater`) : check d'un endpoint
JSON, signature de la payload via clé Tauri (séparée du code-signing OS),
download + remplacement automatique.

**B. Manual** : l'utilisateur retélécharge depuis GitHub Releases. Friction
forte, abandon élevé.

**C. Squirrel.Windows / WiX** : alternatives spécifiques à Windows. Plus de
maintenance, moins cross-platform que Tauri.

## Décision

- **Code-signing : option A** (pas de cert pour l'instant). Validé Manu
  2026-05-07. À reconsidérer à la première vague de feedback utilisateur si
  le SmartScreen warning bloque trop.
- **Distribution : GitHub Releases** (option A). Cohérent avec le bouton
  Télécharger de la landing qui pointe déjà sur
  `https://github.com/Manuxv3-dev/nexus/releases/latest`.
- **Auto-update : Tauri updater natif** (option A). Validé Manu 2026-05-07.
- **Première version : `desktop-v0.1.0`**. Validé Manu 2026-05-07.
- **Plateforme V1 : Windows uniquement**. macOS + Linux brancheront plus
  tard (matrix workflow déjà préparée commentée).

## Architecture

### Versions

Bump dans 3 fichiers (synchrones) :

| Fichier                                      | Champ             | Valeur  |
| -------------------------------------------- | ----------------- | ------- |
| `packages/desktop/package.json`              | `version`         | `0.1.0` |
| `packages/desktop/src-tauri/Cargo.toml`      | `package.version` | `0.1.0` |
| `packages/desktop/src-tauri/tauri.conf.json` | `version`         | `0.1.0` |

### URLs API/WS configurables

Le SPA utilisait des URLs relatives (`/api/v1`, `${proto}://${host}/ws`) qui
fonctionnent en mode web (Traefik proxy) mais pas en Tauri (chargé depuis
`tauri://localhost`).

Modifs :

- `packages/web/src/lib/api.ts` : `API_BASE` lit `import.meta.env.VITE_API_BASE`
  (default `/api/v1`)
- `packages/web/src/lib/ws.ts` : URL WS lit `import.meta.env.VITE_WS_BASE`
  (default `wss://${host}/ws`)

Le workflow `desktop-release.yml` injecte au build Tauri :

- `VITE_API_BASE=https://api.nexusapp.chat/api/v1`
- `VITE_WS_BASE=wss://api.nexusapp.chat/ws`

### Plugin updater

`packages/desktop/src-tauri/Cargo.toml` :

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-updater = "2"
```

`packages/desktop/src-tauri/src/lib.rs` enregistre le plugin uniquement
sur desktop (pas iOS/Android où l'app store gère les updates).

`packages/desktop/src-tauri/capabilities/default.json` : ajoute
`updater:default` aux permissions.

`packages/desktop/src-tauri/tauri.conf.json` :

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/Manuxv3-dev/nexus/releases/latest/download/latest.json"
    ],
    "pubkey": "<output de pnpm tauri signer generate>",
    "windows": { "installMode": "passive" }
  }
}
```

### Pipeline CI

`.github/workflows/desktop-release.yml` :

- Trigger : `push` de tag `desktop-v*` OU `workflow_dispatch` manuel
- Matrix : `windows-latest` (V1), structure prête pour macOS + Linux
- Steps : checkout → setup pnpm/node/rust → install deps → `tauri-apps/tauri-action@v0`
- Variables build-time : `VITE_API_BASE` + `VITE_WS_BASE` injectés dans l'env
- Signing payload updater : via secrets `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Output : asset `.exe` (NSIS) ou `.msi` (WiX) + `latest.json` signé →
  upload sur GitHub Release auto-créée à partir du tag

### Setup signing (à faire une fois par Manu)

```bash
# 1. Génère le couple clé publique / clé privée
pnpm --filter @nexus/desktop tauri signer generate -w ~/.tauri/nexus-updater.key

# 2. Récupère la clé publique (~/.tauri/nexus-updater.key.pub) → coller dans
#    tauri.conf.json à la place de REPLACE_ME_WITH_OUTPUT_OF_TAURI_SIGNER_GENERATE

# 3. Récupère la clé privée (~/.tauri/nexus-updater.key, base64 sans newline)
cat ~/.tauri/nexus-updater.key | base64 -w 0

# 4. Ajoute dans GitHub Secrets (settings → Secrets and variables → Actions) :
#    - TAURI_SIGNING_PRIVATE_KEY = contenu de la clé privée (base64)
#    - TAURI_SIGNING_PRIVATE_KEY_PASSWORD = le password choisi à l'étape 1
```

### Premier release (à faire une fois config OK)

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Le workflow tourne ~5-10 min, crée la release GitHub, upload `.exe` + `.msi` +
`latest.json` signé. Le bouton "Télécharger Desktop" de la landing pointe déjà
sur `https://github.com/Manuxv3-dev/nexus/releases/latest` → l'utilisateur
récupère automatiquement la dernière version.

## Conséquences

### Positif

- **Build reproductible** : tag git → release GitHub auto en ~10 min
- **Auto-update silencieux** : l'utilisateur reste à jour sans intervention.
  Critique pour MVP : on va casser/évoluer souvent
- **Coût zéro** : GitHub Actions free pour repos publics, pas de cert
- **Cross-platform-ready** : matrix prête pour macOS + Linux, juste à
  dé-commenter dans le workflow
- **Pas de bandwidth VPS** : downloads servis par GitHub CDN

### Négatif

- **SmartScreen warning premier lancement** : friction modérée, à
  monitorer via feedback. Si bloquant, on passera à un certif EV (~500€/an)
- **Pas de fallback si la signing key est perdue** : si on perd la clé
  privée, on ne peut plus pousser d'updates aux versions installées (elles
  refuseront les payloads non-signées par la même clé). Solution : sauvegarde
  hors-repo (Bitwarden / coffre-fort)
- **Pas d'enrôlement code-signing OS** : on ne peut pas être ajouté sur
  l'allowlist Microsoft Defender, ni publier sur le Microsoft Store sans
  redo un cert plus tard

### Neutre

- ADR-026 (Tauri 2 desktop shell) reste valide, ADR-031 ajoute juste la
  pipeline release par-dessus
- Le bouton "Télécharger Desktop" de la landing pointe déjà sur GitHub
  Releases — aucune modif côté landing nécessaire

## Suivi

- Après le premier release `desktop-v0.1.0` : valider sur une machine
  Windows neuve (VM Hyper-V ou Win11 réelle) que :
  - Install fonctionne (passive ou silent install via .msi)
  - App connecte à `api.nexusapp.chat` (pas localhost)
  - WebSockets se connectent (`wss://api.nexusapp.chat/ws`)
  - L'updater détecte une fausse `0.2.0` poussée derrière (test)
- Plus tard : brancher macOS + Linux dans la matrix (juste dé-commenter)
- Plus tard : envisager certificat OV/EV si SmartScreen bloque trop
