# Brief Claude design — Refonte UI Nexus v3 : trois directions originales

> **Date** : 2026-07-05 · **Commanditaire** : Manu
> **Statut du DS actuel** : ADR-021 (« true Apple ») est mis en exploration
> libre par ce brief. Tu n'es tenu ni par Apple HIG, ni par le thème
> « Neon Dusk » historique. Si une direction est retenue, un nouvel ADR
> remplacera ADR-021.

---

## 1. Ta mission

Produire **trois directions de design concurrentes et réellement
orthogonales** pour la refonte complète de Nexus : app desktop/web, pages
publiques de partage, landing, et branding (logo, iconographie, identité).

Trois variations d'un même dark theme ne comptent pas comme trois
directions. Chaque direction doit être défendable comme le travail d'un
studio qui a une conviction.

**Cadrage important** : le résultat doit ressembler à une **application
moderne**. Pas d'expérimentation print, brutalist ou rétro — les
références sont les meilleurs logiciels contemporains (Linear, Arc,
Things, Family, Raycast, Notion Calendar…), c'est-à-dire des apps qui
ont une identité forte **dans** l'idiome du logiciel moderne.
L'originalité attendue vient du craft : typographie choisie, détails
d'exécution, motion signature, couleur avec intention — pas d'une
rupture formelle avec ce qu'est une app en 2026.

Manu choisira une direction (ou un croisement) ; la phase 2 (déclinaison
écran par écran, tokens, migration) fera l'objet d'une mission séparée.

## 2. Le produit

**Nexus** réunit deux choses dans une seule app :

1. **Un agrégateur de messageries** — 12 services (WhatsApp, Messenger,
   Discord, Teams…) encapsulés en **webview** dans un shell Tauri. Nexus
   ne lit pas les messages : il héberge les pages web officielles.
2. **Une couche d'organisation pour bandes d'amis** — événements avec
   RSVP, sondages, dépenses partagées (style Tricount), todos/listes.
   Chaque objet est partageable par **lien public** que l'on colle dans
   n'importe quelle conversation.

**L'utilisateur type** : un groupe de potes qui organise un week-end, un
anniversaire, un semi-marathon. Pas une équipe corporate. Pas un power
user B2B. L'app est ouverte 2h/jour comme hub de messageries — elle doit
être **habitable**, pas juste photogénique.

**La tension centrale du design** : l'UI de Nexus cohabite en permanence
avec des webviews tierces (WhatsApp vert et blanc, Discord blurple,
Messenger dégradé bleu). Le shell doit avoir une identité assez forte
pour exister à côté d'elles, et assez calme pour ne pas hurler par-dessus.

## 3. Liste noire — les marqueurs « UI générée par IA »

C'est la raison d'être de ce brief. L'UI actuelle de Nexus (et sa v2
Apple) coche les cases du design par défaut que produisent les
générateurs. **Tout ce qui suit est interdit, sauf détournement
manifestement volontaire et argumenté** :

### Palette et surfaces

- Violet/indigo sur fond navy sombre, dégradés bleu→violet, accents néon
  pastel — le « dark SaaS 2024 ».
- Glassmorphism systématique : blur + transparence comme unique idée de
  matière.
- Dégradés radiaux « blob » flous en arrière-plan de hero.
- Une couleur vive par feature dans des carrés arrondis — le code couleur
  arc-en-ciel de dashboard générique.
- Aplats parfaits partout : zéro texture, zéro grain, zéro matière.

### Typographie

- Inter par défaut. Space Grotesk « pour faire différent ». Toute
  géométrique sans-serif interchangeable.
- Hiérarchie exprimée uniquement par la graisse et la taille, jamais par
  le style, la casse, la chasse ou la composition.
- Titre en dégradé de texte.

### Layout et composants

- La grille de cards identiques : coins `rounded-2xl`, ombre douce, icône
  dans un carré coloré en haut à gauche, titre, sous-titre gris. Répétée
  en 2×2 ou 3×3. _(C'est exactement le Home actuel de Nexus — il sert de
  contre-exemple.)_
- Layout 3 colonnes SaaS sans remise en question.
- Hero centré : titre, sous-titre, deux boutons pill, mockup flottant
  incliné.
- Boutons et badges pill par défaut, partout, sans logique.
- Radius identique sur tous les éléments, spacing uniforme 16/24 px.
- Empty states avec illustration générique et phrase mignonne.

### Ton et détails

- Emoji en guise d'icônes. Étincelles ✨. Micro-copy sur-enthousiaste
  (« 🎉 Bravo ! »).
- Icônes Lucide/Phosphor posées sans direction iconographique.
- Toute interface qui pourrait sortir telle quelle de v0, Lovable ou Bolt.

**Le test final** : montre l'écran à un designer sans contexte. S'il dit
« c'est de l'IA », la direction est refusée, quelle que soit sa qualité
d'exécution.

## 4. Ce qu'on cherche

- **Une fondation typographique.** Choisis des caractères qui ont une
  voix — éditoriale, technique, vernaculaire — et fais-en le squelette de
  la hiérarchie. Fontes libres de qualité exigées (Google Fonts,
  Fontshare, Velvetyne, etc.), imports fournis. Justifie chaque choix.
- **Une vraie composition.** Grille assumée ou asymétrie maîtrisée,
  densité pensée pour un outil du quotidien. La densité n'est pas
  l'ennemi : un tableau d'affichage de bande de potes peut être dense et
  vivant.
- **La couleur avec intention.** Oser un light mode franc, un monochrome
  radical, une bichromie, une couleur signature — n'importe quoi qui
  résulte d'une décision plutôt que d'un défaut.
- **Une matière subtile.** Élévations, bordures, ombres et fonds qui
  résultent d'un système pensé — pas l'aplat parfait par défaut, pas le
  blur systématique non plus. Regarde comment Linear ou Things
  construisent la profondeur avec presque rien.
- **Une signature motion.** Deux ou trois animations qui appartiennent à
  cette direction et à elle seule (spécifiées en CSS, pas en vidéo).
- **Un ton.** Nexus organise des barbecues et des semi-marathons entre
  amis. Chaleureux sans être infantile, personnel sans être mignon.
- **Des références produit précises.** Cite des apps réelles et ce que
  tu leur empruntes exactement (la profondeur de Linear, la chaleur de
  Family, les moments ludiques d'Arc…) — pas des moodboards Dribbble ni
  des landing pages SaaS génériques.

### Pistes d'axes (exemples, pas des commandes)

Pour garantir l'orthogonalité, voici trois familles possibles — toutes
dans l'idiome de l'app moderne. Tu peux les suivre, les croiser ou
proposer mieux :

1. **Craft minimal / outil précis** — sobriété radicale, une couleur
   signature, profondeur construite au pixel, motion impeccable ;
   l'app comme un bel instrument du quotidien (pensée Linear, Things,
   Notion Calendar).
2. **Chaleureux moderne** — light assumé, typographie de caractère,
   couleur et illustration avec intention, ton personnel ; l'app comme
   l'endroit où vit le groupe (pensée Family, Partiful, Airbnb récent).
3. **Expressif contemporain** — couleur franche, personnalité affirmée,
   moments ludiques dans un shell rigoureux ; l'app qui a un caractère
   reconnaissable en une frame (pensée Arc, Raycast, Amie).

## 5. Contraintes non négociables

Techniques et produit — tout le reste est ouvert :

- **Implémentable en React + Tailwind + CSS variables.** Pas de WebGL ni
  de canvas requis pour l'identité de base. Fontes libres uniquement.
- **Dark ET light**, les deux au même niveau de finition. Le choix du
  thème par défaut t'appartient et doit être argumenté.
- **Structure de tokens conservée** : les noms `--nx-*` et le mapping
  shadcn-compatible restent (cf. `design-current-state.md` §2 et §6) ;
  toutes les valeurs sont libres.
- **Couleurs sources messageries reconnaissables** : les pastilles
  WhatsApp/Messenger/Discord/Teams de la sidebar doivent rester
  identifiables d'un coup d'œil (les valeurs exactes peuvent être
  réinterprétées dans ta palette).
- **5 familles à différencier** : Events, Polls, Expenses, Todos, Chat.
  La différenciation par couleur n'est pas obligatoire — forme, glyphe,
  position ou matière peuvent faire le travail — mais elle doit exister
  et fonctionner en un coup d'œil.
- **Cohabitation webview** : le shell (sidebar, top bar, fenêtre Tauri
  custom) entoure des pages tierces non stylables. Prévois cette
  frontière dans les protos (une webview figurée suffit).
- **Pages publiques** : `/e /p /d /t /l` sont vues par des invités sans
  compte, depuis un lien collé dans WhatsApp. Rendu SSR + OG cards
  (ADR-018) à préserver. C'est la vitrine du produit — soigne-les autant
  que l'app.
- **Accessibilité** : contrastes AA, focus visibles, cibles tactiles
  44px (le mobile arrive en V2, ne le rends pas impossible).
- **Branding dans le scope** : le logo « Atome » et l'iconographie
  Phosphor sont remis en question. Chaque direction propose son
  logo/wordmark et sa direction iconographique.

## 6. Livrables — par direction (×3)

1. **Manifeste** (1 page) : nom de la direction, parti pris en deux
   phrases, références réelles (studios, imprimés, produits, lieux),
   pourquoi ça colle à Nexus, et ce que quelqu'un pourrait détester.
2. **Moodboard structuré** (HTML) : palette light+dark, spécimen
   typographique complet (échelle, styles, casse), matières/textures,
   composants clés (bouton, input, card event, badge RSVP).
3. **Tokens draft** : palette, échelle typo, radius, spacing, ombres,
   motion (durées + easings) — au format CSS variables `--nx-*`.
4. **Trois protos HTML statiques** (fichiers autonomes, light + dark) :
   - **Home Nexus** — feed personnel trans-groupes (l'écran d'accueil) ;
   - **Events** — dashboard + détail d'un événement avec RSVP ;
   - **Page publique d'un event** — vue invité sans compte.
5. **Branding** : logo/wordmark, favicon, direction iconographique
   (set existant réinterprété ou remplacé), OG card type.

En bonus si le temps le permet : hero de landing.

**Format de rendu** : un dossier par direction, protos HTML autonomes
(CSS inline ou fichier unique), aucune dépendance build.

## 7. Critères d'évaluation

1. **Test du flou** : écran flouté, logo masqué — reconnaît-on Nexus ?
2. **Test v0** : un générateur d'UI aurait-il pu produire cet écran ?
   Si oui, éliminé.
3. **Test de cohabitation** : l'identité tient-elle à côté d'une webview
   WhatsApp ouverte en plein écran ?
4. **Test du quotidien** : habitable 2h/jour ? Les protos doivent montrer
   des états denses et réels (12 events, un solde négatif, un sondage
   fermé) — pas des états de démo à 1 item.
5. **Test de la bande de potes** : est-ce qu'on a envie d'y organiser un
   barbecue, ou de y faire un daily standup ?

## 8. Contexte repo et annexes

- **État actuel détaillé** : `.agent/notes/design-current-state.md`
  (stack, tokens, composants, écrans, contraintes héritées).
- **Screenshots UI actuelle** : `.agent/notes/current-ui-preview/`
  — à traiter comme contre-exemple (cf. §3).
- **ADR-021** : `.agent/adr/ADR-021-design-system-v2-apple.md` — la
  direction Apple abandonnée par ce brief ; utile pour comprendre
  l'historique, pas comme contrainte.
- **Écrans existants** : `packages/web/src/screens/` (auth, app 3-pane,
  4 dashboards features, 5 pages publiques, settings, landing).
- **Décisions produit intangibles** : pas de lecture des messages
  (ADR-027/032), partage par liens publics (ADR-010), jamais d'auto-post
  dans la messagerie source.
