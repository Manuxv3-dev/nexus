# Backlog Nexus

> **Ce fichier est gelé depuis la bascule ADLC du 2026-08-01.**

Les tâches ouvertes sont devenues des issues Linear :

**<https://linear.app/manuxv3-dev/project/nexus-718f0a412fc7>**

Une nouvelle idée, dette ou tâche se crée avec `/adlc:refine` (ou
`/adlc:quick`, `/adlc:chore`, `/adlc:bug-fix` pour les tâches courtes), pas ici.

## Ce qui a été migré le 2026-08-01

18 tickets créés à partir de ce fichier, de `roadmap.md` et de
`current-task.md`, après vérification dans le code de ce qui était encore
réellement ouvert :

| Sujet                                                          | Label     |
| -------------------------------------------------------------- | --------- |
| Images Open Graph cassées pour les dépenses et todos partagées | `bug`     |
| Validations manuelles V1 non couvertes par le smoke E2E        | `chore`   |
| Refonte UI v3 — arbitrage et ADR remplaçant ADR-021            | `feature` |
| Matrix desktop 4 cibles au prochain tag                        | `chore`   |
| Durcissement Traefik et audit sécurité du VPS                  | `chore`   |
| Persistance de la waitlist                                     | `feature` |
| Infra de test sur `@nexus/web` (Vitest + Playwright)           | `chore`   |
| Schémas Zod partagés via `@nexus/shared`                       | `chore`   |
| Notifications push PWA                                         | `feature` |
| SSR des meta-tags Open Graph                                   | `feature` |
| Densification des dashboards                                   | `feature` |
| Persistance du thème                                           | `feature` |
| Cache CI (pnpm + Turborepo)                                    | `chore`   |
| Finition du branding                                           | `chore`   |
| Internationalisation                                           | `feature` |
| Export d'un groupe en JSON (RGPD)                              | `feature` |
| Mode « vacances »                                              | `feature` |
| Nombre de membres dans le DTO de groupe                        | `feature` |

## Ce qui n'a pas été migré

Les items devenus **sans objet depuis ADR-027 et ADR-032** : astreinte des
bridges Messenger/WhatsApp, rotation de `PROVIDER_SESSIONS_KEY`, POC Conduit +
mautrix-meta, skills d'intégration Baileys/mautrix/Discord, circuit breaker et
métriques `bridge-rpc`, pool de subscribers Redis RPC, idempotency-key sur
`sendMessage`, persistance des messages en base, purge des messages bridgés,
Nexus comme client Matrix natif. Nexus n'a plus de bridge server-side et ne lit
plus les messages : ces dettes ont disparu avec l'architecture qui les portait.

Les bilans de sessions closes et les dettes déjà résorbées restent dans
l'archive.

## Archive

[`archive/backlog-2026-06-02.md`](archive/backlog-2026-06-02.md) — 609 lignes,
historique complet. N'est plus tenu à jour.
