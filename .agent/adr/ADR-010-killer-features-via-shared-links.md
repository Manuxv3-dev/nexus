# ADR-010 : Killer features via liens Nexus partagés — pas d'auto-envoi

**Date** : 2026-04-30
**Statut** : Accepté (renforcé par ADR-027 le 2026-05-04)

> 📌 **Note 2026-05-04** : avec **ADR-027 (universalisation webview
> messaging)**, Nexus n'a plus accès programmatique aux messageries
> (toutes encapsulées en webview). Le choix acté ici (liens copiables
> partagés manuellement) devient donc la **seule** option viable — la
> décision reste valide, juste pour une raison supplémentaire.

## Contexte

Les killer features Nexus (événements, sondages, dépenses, todos) doivent
fonctionner avec toutes les messageries hébergées (Discord, Messenger,
WhatsApp). Une option naïve serait que Nexus poste **automatiquement** dans
la conversation source un message de suivi (ex: *"J'ai créé l'événement
samedi 20h, RSVP ici"*).

Cette option a deux problèmes :
1. **Risque ToS Meta** — l'auto-envoi est exactement le pattern que Meta
   identifie comme "automation tool" et qui déclenche les bans de comptes.
2. **Complexité d'expérience cross-messagerie** — un événement peut être
   discuté dans Messenger, mais l'utilisateur veut peut-être inviter aussi des
   gens qui sont sur Discord ou WhatsApp. L'auto-post dans une seule
   conversation source enferme l'événement dans une bulle.

Manu a tranché en discussion : **pas d'auto-envoi**. Tout retour vers les
conversations source passe par un **lien Nexus partagé manuellement** par
l'utilisateur.

## Architecture cible

### Pages publiques Nexus

Chaque entité d'organisation (événement, sondage, dépense, todo, liste) est
accessible via une URL publique-via-lien :

```
https://app.nexus.example/e/<slug>     # événement
https://app.nexus.example/p/<slug>     # poll (sondage)
https://app.nexus.example/d/<slug>     # dépense (debt/expense)
https://app.nexus.example/t/<slug>     # todo
https://app.nexus.example/l/<slug>     # liste
```

Caractéristiques :
- **Slug court non-prédictible** (10-12 caractères base62, ~62^10 = 8e17
  combinaisons → enumeration impossible)
- **Pas d'authentification requise** pour voir : qui a le lien voit
- **Authentification requise pour interagir** (RSVP, voter, ajouter une
  ligne) : si l'utilisateur n'a pas de compte Nexus, on lui propose de
  s'inscrire en 30 secondes (auth via Discord OAuth, magic link email, etc.)
- **Permissions paramétrables** par l'auteur :
  - "public-via-lien" (par défaut) : toute personne avec le lien voit et peut interagir
  - "groupe seulement" : nécessite d'être membre du groupe Nexus pour voir
  - "lecture publique, interaction membres" : compromis

### Flow utilisateur typique

```
1. Conv Messenger : "On se voit samedi 20h chez moi ?"
2. Nexus détecte l'intention → propose dans l'UI Nexus :
   "Créer un événement 'Soirée samedi 20h' ?"  [Créer] [Ignorer]
3. Manu clique [Créer] → événement créé dans Nexus
4. Nexus affiche : "Événement créé. [Copier le lien]"
5. Manu copie-colle le lien dans la conv Messenger lui-même
6. Les amis cliquent → page publique Nexus → RSVP (compte Nexus créé si besoin)
```

L'envoi vers Messenger est **un message tapé par l'utilisateur**, pas un
message généré par Nexus, indistinguable d'un client tiers.

### Deep links et apps natives

Les liens Nexus doivent ouvrir l'app native si elle est installée :

- **Desktop Tauri** : custom URL scheme (`nexus://e/<slug>`) déclaré dans Tauri,
  et fallback page web si pas d'app
- **iOS** (V2) : Universal Links via fichier `apple-app-site-association` servi
  par `app.nexus.example`
- **Android** (V2) : App Links via intent filters et `assetlinks.json`
- **Web** : page complète avec bouton "Ouvrir dans Nexus" si user-agent
  detecté + l'app installée

Implémentation MVP : on sert juste les pages web. Les universal/app links
arrivent en V2 avec le mobile. Le custom scheme desktop dès J5.

### Architecture technique côté backend

```
packages/backend/src/public-pages/
├── routes.ts                 # GET /e/:slug, /p/:slug, etc.
├── slug-generator.ts         # base62 random
├── permission-resolver.ts    # quels utilisateurs peuvent voir quoi
└── render/
    ├── event.tsx             # SSR ou template
    ├── poll.tsx
    ├── expense.tsx
    └── shared-layout.tsx
```

Choix de rendering :
- **MVP** : SSR via Fastify (templates simples, pas de framework lourd côté
  page publique). Les pages publiques sont volontairement minimalistes.
- **V2** : on peut basculer sur Next.js / Remix / SolidStart si on veut une UX
  riche (preview meta cards Open Graph, etc.). Pas urgent.

### Schémas DB

Chaque entité métier gagne un champ `slug` :

```ts
events: {
  id: uuid,
  groupId: uuid,
  slug: text unique,           // 10-12 chars base62
  permission: enum('public-link', 'group-only', 'public-read-group-write'),
  // ... autres champs
}
```

Index unique sur `slug`. Génération avec retry en cas de collision (très
improbable mais déterministe). Slugs immuables après création (changer le
slug invaliderait les liens partagés).

### Open Graph cards

Quand un lien Nexus est partagé dans Messenger, WhatsApp, Discord, ces apps
font une requête HEAD/GET pour récupérer les meta tags Open Graph. La page
publique sert :

```html
<meta property="og:title" content="Soirée chez Manu — samedi 20h" />
<meta property="og:description" content="3 participants confirmés. Cliquez pour RSVP." />
<meta property="og:image" content="https://app.nexus.example/og/e/<slug>.png" />
<meta property="og:url" content="https://app.nexus.example/e/<slug>" />
```

L'image `og:image` est générée dynamiquement (worker BullMQ + Satori ou
@vercel/og pour le rendering) et cachée 1h en CDN/local.

Bénéfice : quand Manu colle le lien dans Messenger, ses amis voient une
preview riche au lieu d'une URL nue. Augmente le taux de clic.

## Anti-patterns explicitement interdits

Cet ADR pose des règles dures :

1. ❌ **Aucun message envoyé automatiquement par Nexus** dans une conversation
   source. Pas même un message de "bienvenue" ou de "récap quotidien".
2. ❌ Pas de **mass DM** : Nexus n'envoie jamais de message à plusieurs
   destinataires en parallèle, sauf si l'utilisateur tape lui-même un message
   à plusieurs (ce qui passe par les fonctionnalités natives de la messagerie,
   pas par une boucle Nexus).
3. ❌ Pas de **réactions automatiques** (emoji, ack, read receipts non
   sollicités).
4. ❌ Pas de **résumé périodique** posté dans la conversation source.

Tous les retours dans la conversation source = un message tapé par
l'utilisateur, qui peut contenir un lien Nexus.

## Conséquences

**Positif** :
- Risque ToS Messenger/WhatsApp réduit au minimum (cf. ADR-007/008)
- Architecture cross-messagerie naturelle : un événement n'est pas lié à une
  conversation source précise, il est partageable partout
- Une seule source de vérité (la page Nexus), pas de drift entre la conv
  source et l'état Nexus
- Pages publiques utilisables par des non-utilisateurs Nexus → onboarding viral
  (un ami clique sur le lien, voit l'événement, crée son compte pour RSVP)
- UX cohérente avec les patterns familiers (Doodle, Tricount, Calendly...)

**Négatif** :
- L'utilisateur doit **explicitement copier-coller** le lien dans la conv —
  une étape de plus que l'auto-post
- Si la conv source est très active, le lien peut se faire enterrer par les
  messages suivants (à mitiger : encourager l'utilisateur à épingler le
  message, ou afficher la preview Open Graph riche)
- Slugs courts → potentiel guessable theoretically (mitigation : 10-12 chars
  base62, audit logging des accès, possibilité de révoquer un slug compromis)

**Neutre** :
- Pages publiques = surface d'attaque minimale (pas de mutation sans auth,
  rate-limit aggressif sur le slug, monitoring des accès anormaux)
- Possibilité future : intégrer un raccourcisseur d'URL maison
  (`nx.app/e/abc123`) pour des liens plus courts dans les messageries
- Skill à créer en J5 : `add-public-page-route.md`

## Action requise de Manu

✅ Validé en discussion — passage en "Accepté" lors de la validation
groupée des ADR.
