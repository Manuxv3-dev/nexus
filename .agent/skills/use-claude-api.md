# Skill — Utiliser l'API Claude (intent detection et au-delà)

> ⚠️ **DÉPRÉCIÉ (2026-06-02, cf. ADR-032)** — le détecteur d'intention (J6) a
> été abandonné : depuis le pivot webview (ADR-027), Nexus ne lit plus le contenu
> des messages, donc plus de surface d'intent detection. Le produit n'utilise
> plus l'API Claude. Ce skill est conservé pour historique et reste valable si
> une feature IA **sur du contenu first-party** (saisi nativement dans Nexus)
> émerge un jour. Ne pas l'appliquer en l'état.

**Quand utiliser ce skill** : à chaque appel à l'API Anthropic (Claude) depuis
le backend Nexus, principalement pour le détecteur d'intention (J6) mais aussi
pour toute future feature IA.

## Principes

- **Source de vérité Zod** : tout retour de Claude est validé par un schéma Zod
  strict. Si la validation échoue, on retombe sur `intent: 'none'` plutôt que
  de polluer le moteur de coordination.
- **Cache agressif** : un message déjà analysé ne doit pas être réanalysé.
  Clé de cache = `sha256(messageBody + groupContextVersion)`.
- **Quotas par groupe** : rate-limit + budget mensuel max, surveillés et
  visibles côté admin.
- **Modèles** : par défaut `claude-haiku-4-5` pour le coût/latence, escalade
  vers `claude-sonnet-4-6` si l'analyse haiku est ambiguë (signal de
  confidence sous un seuil).
- **Prompt versioning** : chaque prompt utilisé est versionné (`prompts/intent/v1.ts`)
  pour pouvoir mesurer l'effet des changements.

## Pattern type — détecteur d'intention

```ts
// packages/backend/src/coordination/intent.ts
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { intentPromptV1 } from './prompts/intent/v1';

const IntentResultSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('date-proposal'),
    confidence: z.number().min(0).max(1),
    payload: z.object({
      proposedAt: z.string().datetime().optional(),
      title: z.string().optional(),
      participants: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    intent: z.literal('expense'),
    confidence: z.number().min(0).max(1),
    payload: z.object({
      amount: z.number(),
      currency: z.string().length(3),
      description: z.string(),
      paidBy: z.string().optional(),
    }),
  }),
  z.object({
    intent: z.literal('poll'),
    confidence: z.number().min(0).max(1),
    payload: z.object({
      question: z.string(),
      options: z.array(z.string()).min(2),
    }),
  }),
  z.object({
    intent: z.literal('todo'),
    confidence: z.number().min(0).max(1),
    payload: z.object({
      title: z.string(),
      assignee: z.string().optional(),
    }),
  }),
  z.object({ intent: z.literal('none'), confidence: z.number().min(0).max(1) }),
]);
export type IntentResult = z.infer<typeof IntentResultSchema>;

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export async function detectIntent(
  message: string,
  groupContext: GroupContext
): Promise<IntentResult> {
  const cacheKey = await hashIntentInput(message, groupContext);
  const cached = await intentCache.get(cacheKey);
  if (cached) return cached;

  await quotas.consume(groupContext.id, 1);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: intentPromptV1.system(groupContext),
    messages: [{ role: 'user', content: intentPromptV1.user(message) }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('');

  const parsed = safeParseJsonBlock(text);
  const result = IntentResultSchema.safeParse(parsed);

  if (!result.success) {
    log.warn({ groupId: groupContext.id, raw: text }, 'intent parse failed');
    const fallback: IntentResult = { intent: 'none', confidence: 0 };
    await intentCache.set(cacheKey, fallback, { ttl: 60 });
    return fallback;
  }

  await intentCache.set(cacheKey, result.data, { ttl: 24 * 60 * 60 });
  return result.data;
}
```

## Conventions sur les prompts

- Prompts dans `packages/backend/src/coordination/prompts/<feature>/v<n>.ts`
- Toujours **demander un JSON** strict en sortie, dans un bloc `<output>` ou
  équivalent qu'on parse avec `safeParseJsonBlock`.
- **Few-shot examples** dans le system prompt pour stabiliser le format,
  surtout sur des cas ambigus.
- Garder le prompt **en français** : le détecteur d'intention raisonne sur des
  conversations en français entre amis.
- Pas de PII/sensibilité dans le prompt (ne pas envoyer des numéros de carte,
  passwords, etc. — filtre regex à appliquer en amont).

## Quotas et coût

- Compteur Redis `claude:quota:{groupId}:{yyyy-mm}` incrémenté à chaque appel.
- Limites par défaut (à ajuster) :
  - 500 appels/jour/groupe
  - Budget mensuel max paramétrable côté admin
- Quand quota atteint : intent retourne `none` avec un flag `quotaExceeded: true`
  dans la réponse, et un log `warn`.

## Checklist avant merge d'une feature qui appelle Claude

- [ ] Schéma Zod strict pour la sortie attendue
- [ ] Fallback `none` / safe en cas de parsing failed
- [ ] Cache par contenu (clé déterministe)
- [ ] Quota consommé avant l'appel, pas après
- [ ] Prompt versionné dans `prompts/<feature>/v<n>.ts`
- [ ] Test unitaire avec mock du SDK Anthropic
- [ ] Logs structurés (`groupId`, `latency`, `inputTokens`, `outputTokens`, `model`)
- [ ] Pas de PII envoyée à Claude (filtre amont)

## Anti-patterns à éviter

- ❌ Faire confiance au texte de sortie sans Zod
- ❌ Appeler Claude depuis le request-response (toujours via worker BullMQ
  pour les analyses non-bloquantes)
- ❌ Stocker la conversation entière dans le prompt à chaque message (utiliser
  un résumé glissant ou un contexte de groupe court)
- ❌ Re-prompter en boucle si la sortie est invalide — un fallback est mieux
  qu'une boucle qui consomme le quota
