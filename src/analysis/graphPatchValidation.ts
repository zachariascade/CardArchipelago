import { z } from "zod";
import { DeckGraphPatch } from "../deck/deckGraph";

const graphNodeKindSchema = z.enum(["card", "package", "strategy", "resource", "risk"]);
const graphEdgeKindSchema = z.enum(["supports", "enables", "pays_off", "protects", "answers", "depends_on", "weak_to", "belongs_to"]);
const graphEdgeSourceSchema = z.literal("ai-enriched");

const deckGraphNodeSchema = z.object({
  id: z.string(),
  kind: graphNodeKindSchema,
  label: z.string(),
  summary: z.string(),
  cardId: z.string().optional(),
  cardIds: z.array(z.string()).optional(),
  weight: z.number(),
});

const deckGraphEdgeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  kind: graphEdgeKindSchema,
  source: graphEdgeSourceSchema,
  strength: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  evidence: z.string().optional(),
  cardIds: z.array(z.string()).optional(),
  generatedByFunctionId: z.string().optional(),
  connectionGroup: z.string().optional(),
  ownerCardId: z.string().optional(),
  ownerPatchId: z.string().optional(),
});

const graphCardAttributePredicateSchema = z
  .object({
    path: z.string(),
    op: z.enum(["exists", "equals", "notEquals", "contains", "notContains", "includes", "notIncludes", ">", ">=", "<", "<="]),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]).optional(),
  })
  .strict();

const graphCardSelectorSchema = z
  .object({
    attributes: z.array(graphCardAttributePredicateSchema).optional(),
  })
  .strict();

const graphEdgeFunctionSchema = z.object({
  id: z.string(),
  sourceId: z.string().optional(),
  targetId: z.string().optional(),
  kind: graphEdgeKindSchema,
  selector: graphCardSelectorSchema.optional(),
  sourceSelector: graphCardSelectorSchema.optional(),
  customMessage: z.string(),
  strength: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  connectionGroup: z.string().optional(),
});

const deckGraphPatchUsageSchema = z.object({
  promptChars: z.number(),
  contextFileChars: z.number(),
  outputChars: z.number(),
  promptTokensEstimate: z.number(),
  contextFileTokensEstimate: z.number(),
  outputTokensEstimate: z.number(),
  totalTokensEstimate: z.number(),
  reportedInputTokens: z.number().optional(),
  reportedOutputTokens: z.number().optional(),
  reportedTotalTokens: z.number().optional(),
  note: z.string().optional(),
});

export const deckGraphPatchSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  cardId: z.string().optional(),
  nodesToUpsert: z.array(deckGraphNodeSchema),
  edgesToUpsert: z.array(deckGraphEdgeSchema),
  edgeFunctions: z.array(graphEdgeFunctionSchema).optional(),
  edgeIdsToRemove: z.array(z.string()).optional(),
  usage: deckGraphPatchUsageSchema.optional(),
  notes: z.array(z.string()),
  generatedAt: z.string(),
  source: z.literal("ai"),
});

export function validateDeckGraphPatch(value: unknown): DeckGraphPatch {
  const result = deckGraphPatchSchema.safeParse(value);
  if (!result.success) {
    const issueText = result.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Local endpoint returned invalid graph patch JSON. ${issueText}`);
  }
  return result.data as DeckGraphPatch;
}
