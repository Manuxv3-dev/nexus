# Tâche en cours

> **Ce fichier est gelé depuis la bascule ADLC du 2026-08-01.**

L'état d'avancement, la reprise et les blockers vivent désormais dans les
tickets Linear :

**<https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7>**

Ne réintroduis pas de suivi de tâches ici : deux sources qui décrivent le même
état finissent toujours par diverger, et c'est le fichier qui pourrit en
premier. Pour reprendre le travail, ouvre le ticket concerné — il porte la
spécification (WHAT), le plan technique (HOW) et le statut.

## Ce qui reste dans `.agent/`

| Fichier | Rôle |
|---|---|
| `adr/` | Décisions structurantes, **immuables** une fois acceptées |
| `roadmap.md` | Cap produit et priorisation long terme |
| `skills/` | Patterns et procédures réutilisables |
| `notes/` | Notes de contexte, recherches, briefs |

## Archive

L'historique complet des sessions jusqu'au 2026-06-02 est conservé dans
[`archive/current-task-2026-06-02.md`](archive/current-task-2026-06-02.md) —
bilans de sessions, état live de la prod, workflows CI/CD, décisions de
release. Il n'est plus tenu à jour.

## Reste à faire, hérité de la dernière session

Un point non repris en ticket parce qu'il n'appartient qu'à Manu :
`main` est **en avance d'un commit sur `origin/main`** (le brief de refonte UI
v3 du 2026-07-07). Un `git push` suffit.
