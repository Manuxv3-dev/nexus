# Test E2E manuel des 12 providers Tauri — 2026-05-05

**Contexte** : depuis ADR-027 (universalisation webview messaging), Nexus
encapsule 12 messageries dans des webviews Tauri natives avec
`data_directory` isolé par session. Cette checklist déroule un test runtime
complet pour valider le comportement de chacune et identifier les
providers nécessitant un fix dédié.

**Pré-requis** : app Tauri lancée en dev (`pnpm tauri:dev`) ou en build
(`pnpm tauri:build` puis exécuter le binaire), DB migrée (migration 0009
incluse), backend + workers up.

## Critères communs à chaque provider (7 cases à cocher)

| #   | Étape          | Critère de succès                                                                                                               |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Connect**    | Cliquer "Connecter" depuis Settings → la webview s'ouvre, l'écran d'auth du provider apparaît                                   |
| 2   | **Auth**       | Auth complétée (QR code scanné / login form rempli / OAuth) → la conversation/inbox apparaît                                    |
| 3   | **Lecture**    | Au moins une conversation est lisible (messages affichés correctement)                                                          |
| 4   | **Envoi**      | Envoyer un message texte simple (ex. "ping nexus test") → confirmation côté provider                                            |
| 5   | **Switch**     | Basculer sur un autre provider depuis la sidebar → revenir → scroll position et state préservés (pas de reload, pas de re-auth) |
| 6   | **Restart**    | Quitter l'app Tauri (Cmd/Alt+Q), relancer → la session est encore connectée (pas de re-QR / re-login)                           |
| 7   | **Disconnect** | Supprimer la session depuis Settings → la webview disparaît, la pill sidebar disparaît                                          |

**Légende remontée** : ✅ OK · ⚠️ OK avec friction · ❌ KO · ⏭️ Pas testé

## Comment remonter

Pour chaque provider, remplir la table dans la section dédiée. Si un
critère est ⚠️ ou ❌, ajouter un paragraphe `**Anomalie** :` juste en
dessous avec :

- Reproduction (steps minimum)
- Symptôme exact (capture si possible)
- Hypothèse sur la cause (ToS, limitation web, fix code potentiel)

À la fin de la passe, je trie les remontées et crée des items backlog
dédiés pour chaque anomalie significative.

---

## 1. Discord

- **URL** : `https://discord.com/channels/@me`
- **Auth** : email + mot de passe + 2FA
- **Spécificités** : provider de référence (le plus mature). Devrait être 100% OK.
- **Edge cases connus** : aucun en V1.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
|✅|✅|✅|✅|✅|✅|✅|
| | | | | | | |

---

## 2. WhatsApp

- **URL** : `https://web.whatsapp.com/`
- **Auth** : QR code scanné depuis le téléphone (auth liée au tel actif)
- **Spécificités** : ToS Meta strictes — pas d'injection JS, pas d'auto-action.
  Le téléphone doit rester connecté à internet (limitation WA web officielle).
- **Edge cases connus** :
  - Si le téléphone perd internet > 14 jours, déconnexion forcée.
  - Multi-device : possibilité de pluser jusqu'à 4 webview en parallèle.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
|✅|✅|✅|✅|✅|✅|✅|
| | | | | | | |

---

## 3. Messenger

- **URL** : `https://www.messenger.com/`
- **Auth** : login Facebook (email + mot de passe + 2FA Facebook)
- **Spécificités** : ToS Meta strictes. Login partagé avec compte Facebook.
- **Edge cases connus** :
  - Si compte récent ou IP "louche" → check captcha à l'auth.
  - Quelques régions exigent une vérification téléphone supplémentaire.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
|✅|✅|✅|✅|✅|✅|✅|
| | | | | | | |

---

## 4. Telegram

- **URL** : `https://web.telegram.org/`
- **Auth** : QR code OU numéro de téléphone + code SMS
- **Spécificités** : Telegram Web K vs Web A (URLs différentes possibles).
  L'URL utilisée renvoie le menu de choix → vérifier qu'on tombe bien
  sur la version K (la plus récente).
- **Edge cases connus** :
  - Plusieurs versions de Telegram Web cohabitent — ne pas se laisser
    surprendre par une redirection vers `web.telegram.org/k/`.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 5. Instagram

- **URL** : `https://www.instagram.com/direct/inbox/`
- **Auth** : login Instagram (email/username + mot de passe + 2FA optionnel)
- **Spécificités** : Meta — DMs Instagram. Si l'user n'est pas authentifié,
  l'URL redirige vers `/accounts/login`.
- **Edge cases connus** :
  - Comptes pro ont parfois des sticky banners qui mangent du vertical.
  - Limitation anti-bot : trop d'actions rapides → captcha temporaire.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 6. Slack

- **URL** : `https://app.slack.com/`
- **Auth** : choix du workspace (URL `xxx.slack.com`) puis login email + magic link
  ou SSO selon workspace
- **Spécificités** : multi-workspace. Une seule session = un workspace
  Slack à la fois (limitation web Slack, pas de notre fait).
- **Edge cases connus** :
  - L'URL initiale `app.slack.com/` propose une liste de workspaces si
    plusieurs cookies, ou un input de workspace sinon.
  - Magic link par email : ne pas cliquer le lien depuis un autre browser
    (sinon la session magique va dans cet autre browser, pas dans Tauri).
    À vérifier : est-ce que le clic depuis Mail desktop revient bien dans
    la webview Tauri ?

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 7. Microsoft Teams

- **URL** : `https://teams.microsoft.com/`
- **Auth** : login Microsoft (compte org ou perso) + 2FA / Authenticator app
- **Spécificités** : tenant organisationnel le plus souvent. Conditional
  Access policies de l'employeur peuvent bloquer ou demander MDM.
- **Edge cases connus** :
  - Auth peut rebondir sur `login.microsoftonline.com` puis revenir.
  - Vérifier que les cookies tenant survivent au restart.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
|✅|✅|✅|✅|✅|✅|✅|
| | | | | | | |

---

## 8. LinkedIn

- **URL** : `https://www.linkedin.com/messaging/`
- **Auth** : login LinkedIn (email + mot de passe)
- **Spécificités** : la home messaging est OK, mais si non auth, redirige
  vers `/login` avec returnUrl.
- **Edge cases connus** :
  - LinkedIn affiche souvent un overlay "Get LinkedIn for desktop" — vérifier
    qu'on peut le fermer.
  - Limites anti-bot agressives : éviter le scroll rapide en infinite.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 9. X (Twitter)

- **URL** : `https://x.com/messages`
- **Auth** : login X (username/email + mot de passe + 2FA optionnel)
- **Spécificités** : DMs réservés aux abonnés mutuels par défaut (sauf
  si l'user a ouvert ses DMs publiquement).
- **Edge cases connus** :
  - X Premium / Blue affichent des modals d'upsell — vérifier que ça ne
    bloque pas le flow.
  - Migration twitter.com → x.com : l'URL passe par une redirection,
    cookies à dédupliquer.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 10. Reddit

- **URL** : `https://chat.reddit.com/`
- **Auth** : redirige vers `https://www.reddit.com/login` si non auth.
  Reddit a son propre chat (Matrix-based) séparé du reddit principal.
- **Spécificités** : interface chat dédiée (`chat.reddit.com`), pas le
  reddit "classique". Tout le reddit principal n'est pas accessible
  depuis cette URL.
- **Edge cases connus** :
  - Login Reddit déclenche parfois un captcha (hcaptcha).
  - Si l'user vient de créer son compte, l'accès au chat peut être
    différé (vérification email).

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 11. TikTok

- **URL** : `https://www.tiktok.com/messages`
- **Auth** : login TikTok (téléphone / email / Google / Facebook / Apple)
- **Spécificités** : DMs sur TikTok web sont **très limités** :
  - Pas d'envoi d'images / vidéos / audio depuis le web (mobile-only).
  - Pas de réactions emoji riches.
  - Notifications en temps réel limitées.
- **Edge cases connus** :
  - L'inbox web est encore récente côté TikTok, des features peuvent
    apparaître/disparaître.
  - Captcha TikTok peut bloquer des séquences répétées.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## 12. Snapchat

- **URL** : `https://web.snapchat.com/`
- **Auth** : QR code scanné depuis l'app Snapchat mobile (similaire WA)
- **Spécificités** : Snapchat web est **très limité** — déjà signalé dans
  le backlog comme item à flagger :
  - **Chats texte uniquement**, pas de Snaps photos/vidéos
  - Pas de Stories, pas de Spotlight, pas de Discover
  - Lens / AR features absentes
- **Edge cases connus** :
  - L'app mobile doit être régulièrement online (modèle proche WA).
  - Si l'user a un compte business, certaines features sont absentes.

| 1 Connect | 2 Auth | 3 Lecture | 4 Envoi | 5 Switch | 6 Restart | 7 Disconnect |
| --------- | ------ | --------- | ------- | -------- | --------- | ------------ |
|           |        |           |         |          |           |              |

---

## Notes transverses à vérifier en marge des tests

Indépendamment du provider, vérifier au moins une fois :

- [ ] **Cookies isolés par session** : si on connecte deux fois le même
      provider (ex : 2 comptes Discord), chaque webview a bien sa propre
      session, pas de fuite cookies. Le `data_directory` doit être
      distinct (label session_id différent).
- [ ] **Persistence post-restart** : sur **un** provider connecté avec
      auth lourde (ex : WhatsApp QR), quitter / relancer Tauri → la
      session reste vivante sans re-QR (ce critère est déjà dans la
      grille mais transverse à tous).
- [ ] **Drag&drop reorder sessions** : ajouté en P4. Drag une pill dans
      la sidebar → l'ordre persiste après reload (localStorage
      `nx:sessionOrder:${groupId}` — note : encore scope groupe, dette
      tracée).
- [ ] **Suppression du data_directory au DELETE** : actuellement
      `destroy_provider_webview` ferme la webview mais **conserve** le
      `data_directory` (cookies). C'est volontaire (cf. commentaire Rust
      l. 195-200). Vérifier qu'au DELETE de la session côté Settings,
      la webview disparaît — mais que si on re-`connect` le même provider
      après, on reprend les cookies (= pas de re-QR/re-login). Si Manu
      veut le comportement inverse (clean slate au DELETE), c'est un
      ADR à rédiger.
- [ ] **Contrôles min/max/close** : visibles top-right en surimpression
      de la webview (P2).
- [ ] **GroupHome 4 hero cards** : clic icône groupe → vue dédiée avec
      teasers events/polls/expenses/todos (P7+P8).

---

## Synthèse à remplir en fin de passe

À la fin du test, remplir cette section pour le récap.

- **Providers 100% OK** : (lister les ids)
- **Providers OK avec friction mineure** : (lister + résumer la friction)
- **Providers KO** : (lister + résumer le blocage)
- **Anomalies transverses** : (problèmes pas attribuables à un provider
  spécifique — ex : webview qui clignote au switch, scroll position
  perdu, etc.)

**Décision suite à la passe** :

- Crée-t-on des items backlog dédiés ? (oui/non)
- Quels providers descopent-on de la V1 publique si KO ? (laisser en
  "early access" / cachés derrière un flag)
- Faut-il un nouvel ADR pour acter une décision structurante (ex : drop
  Snapchat de la liste publique) ?
