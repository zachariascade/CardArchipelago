import { z } from "zod";
import { AnalysisResult } from "./analysisSchema";

const manaColorSchema = z.enum(["W", "U", "B", "R", "G", "C"]);

export const deckQuerySchema = z
  .object({
    typeLineIncludes: z.string().optional(),
    oracleTextIncludes: z.string().optional(),
    nameIncludes: z.string().optional(),
    colorsInclude: z.array(manaColorSchema).optional(),
    colorIdentityIncludes: z.array(manaColorSchema).optional(),
    manaValue: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional(),
    isCommander: z.boolean().optional(),
    isLand: z.boolean().optional(),
    isNonland: z.boolean().optional(),
    tagsInclude: z.array(z.string()).optional(),
  })
  .strict();

const cardDescriptionNodeSchema = z.object({
  type: z.literal("CardDescription"),
  cardId: z.string(),
});

const cardListNodeSchema = z.object({
  type: z.literal("CardList"),
  title: z.string(),
  query: deckQuerySchema.optional(),
  cardIds: z.array(z.string()).optional(),
  emptyText: z.string().optional(),
});

const groupedCardListNodeSchema = z.object({
  type: z.literal("GroupedCardList"),
  groups: z.array(cardListNodeSchema),
});

const statBlockNodeSchema = z.object({
  type: z.literal("StatBlock"),
  stats: z.array(
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()]).optional(),
      query: deckQuerySchema.optional(),
    }),
  ),
});

const chartNodeSchemas = [
  z.object({ type: z.literal("ManaCurveChart"), title: z.string().optional() }),
  z.object({ type: z.literal("ColorPipChart"), title: z.string().optional() }),
  z.object({ type: z.literal("TypeBreakdownChart"), title: z.string().optional() }),
] as const;

const tagBreakdownNodeSchema = z.object({
  type: z.literal("TagBreakdown"),
  title: z.string().optional(),
  tags: z.array(z.object({ label: z.string(), count: z.number() })),
});

const evidenceListNodeSchema = z.object({
  type: z.literal("EvidenceList"),
  title: z.string().optional(),
});

const narrativePanelNodeSchema = z.object({
  type: z.literal("NarrativePanel"),
  title: z.string().optional(),
  body: z.string(),
});

export const analysisLayoutNodeSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("stack"),
      children: z.array(analysisLayoutNodeSchema),
    }),
    z.object({
      type: z.literal("twoColumn"),
      left: z.array(analysisLayoutNodeSchema),
      right: z.array(analysisLayoutNodeSchema),
      ratio: z.enum(["1:1", "2:1", "1:2"]).optional(),
    }),
    z.object({
      type: z.literal("tabs"),
      tabs: z.array(
        z.object({
          label: z.string(),
          children: z.array(analysisLayoutNodeSchema),
        }),
      ),
    }),
    cardDescriptionNodeSchema,
    cardListNodeSchema,
    groupedCardListNodeSchema,
    statBlockNodeSchema,
    ...chartNodeSchemas,
    tagBreakdownNodeSchema,
    evidenceListNodeSchema,
    narrativePanelNodeSchema,
  ]),
);

const evidenceItemSchema = z.object({
  claim: z.string(),
  cardIds: z.array(z.string()).optional(),
  query: deckQuerySchema.optional(),
  note: z.string().optional(),
});

const cardMemorySchema = z.object({
  oracleId: z.string(),
  tags: z.array(z.string()),
  roleNotes: z.array(z.string()),
  relatedQueries: z.array(deckQuerySchema),
  generatedAt: z.string(),
  source: z.enum(["mock", "codex-local", "openai", "custom", "user"]),
});

export const analysisResultSchema = z.object({
  id: z.string(),
  kind: z.enum(["deck-overview", "card-analysis", "graph-node-analysis", "freeform"]),
  subjectCardId: z.string().optional(),
  subjectGraphNodeId: z.string().optional(),
  title: z.string(),
  summary: z.string().optional(),
  generationTimeMs: z.number().optional(),
  promptText: z.string().optional(),
  reasoningSummary: z.string().optional(),
  layout: analysisLayoutNodeSchema,
  evidence: z.array(evidenceItemSchema).optional(),
  suggestedCardMemory: z.array(cardMemorySchema).optional(),
  createdAt: z.string(),
  source: z.enum(["mock", "codex-local", "openai", "custom"]),
});

export function validateAnalysisResult(value: unknown): AnalysisResult {
  const result = analysisResultSchema.safeParse(value);
  if (!result.success) {
    const issueText = result.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Local endpoint returned invalid analysis JSON. ${issueText}`);
  }
  return result.data as AnalysisResult;
}
