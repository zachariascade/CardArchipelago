import { DeckEntry, DeckSnapshot, getManaValue, getOracleText, getPrimaryTypeLine } from "../deck/deckModel";
import { DeckGraphPatch, generateCardGraphPatch } from "../deck/deckGraph";
import {
  availableQueries,
  countQuery,
  getCardById,
  getCommander,
  manaCurve,
  queryDeck,
  type DeckQuery,
} from "../deck/deckQueries";
import { AnalysisProvider } from "./AnalysisProvider";
import { AnalysisResult, CardAnalysisInput, CardGraphAnalysisInput, DeckAnalysisInput, FreeformDeckQuestionInput } from "./analysisSchema";

type SemanticBucket = {
  id: string;
  title: string;
  summary: string;
  test: (entry: DeckEntry) => boolean;
};

type BucketResult = {
  id: string;
  title: string;
  summary: string;
  count: number;
  cardIds: string[];
};

const SEMANTIC_BUCKETS: SemanticBucket[] = [
  {
    id: "ramp",
    title: "Ramp and Mana Development",
    summary: "Cards that add mana, search lands, or accelerate land drops.",
    test: (entry) => {
      const text = cardText(entry);
      const name = entry.name.toLowerCase();
      if (isLand(entry)) return text.includes("play an additional land");
      return (
        /\badd \{/.test(text) ||
        text.includes("search your library for a basic land") ||
        text.includes("search your library for up to") ||
        text.includes("put a land card") ||
        text.includes("play an additional land") ||
        text.includes("treasure token") ||
        name.includes("signet") ||
        name === "sol ring"
      );
    },
  },
  {
    id: "draw",
    title: "Card Advantage",
    summary: "Cards that draw, investigate, impulse, or return cards to hand.",
    test: (entry) => {
      const text = cardText(entry);
      return text.includes("draw ") || text.includes("investigate") || text.includes("return target card") || text.includes("return a card");
    },
  },
  {
    id: "interaction",
    title: "Interaction and Removal",
    summary: "Cards that counter, destroy, exile, bounce, fight, or otherwise answer opposing cards.",
    test: (entry) => {
      const text = cardText(entry);
      return (
        text.includes("counter target") ||
        text.includes("destroy target") ||
        text.includes("exile target") ||
        text.includes("return target") ||
        text.includes("deals damage to target") ||
        text.includes("fights target")
      );
    },
  },
  {
    id: "protection",
    title: "Protection",
    summary: "Cards that protect permanents, spells, or the commander.",
    test: (entry) => {
      const text = cardText(entry);
      return (
        text.includes("hexproof") ||
        text.includes("indestructible") ||
        text.includes("protection from") ||
        text.includes("phase out") ||
        text.includes("regenerate") ||
        text.includes("counter target spell") ||
        text.includes("can't be countered")
      );
    },
  },
  {
    id: "tokens",
    title: "Token Package",
    summary: "Cards that make or reward tokens.",
    test: (entry) => cardText(entry).includes("token"),
  },
  {
    id: "graveyard",
    title: "Graveyard Package",
    summary: "Cards that reference cards in graveyards, recursion, or milling.",
    test: (entry) => {
      const text = cardText(entry);
      return text.includes("graveyard") || text.includes("mill ") || text.includes("return target card");
    },
  },
  {
    id: "sacrifice",
    title: "Sacrifice Package",
    summary: "Cards that sacrifice permanents or benefit from sacrifices.",
    test: (entry) => cardText(entry).includes("sacrifice"),
  },
];

const OBJECTIVE_THEMES = [
  "land",
  "draw",
  "token",
  "treasure",
  "graveyard",
  "artifact",
  "enchantment",
  "sacrifice",
  "mill",
  "counter",
  "copy",
  "exile",
];

export class MockAnalysisProvider implements AnalysisProvider {
  async analyzeDeck(input: DeckAnalysisInput): Promise<AnalysisResult> {
    const { deck } = input;
    const commander = getCommander(deck);
    const buckets = analyzeBuckets(deck);
    const strongestBuckets = buckets.filter((bucket) => bucket.count > 0).slice(0, 5);
    const subtypeClusters = getCreatureSubtypeClusters(deck);
    const commanderQueries = commander ? inferCommanderQueries(commander) : [];
    const objectiveThemes = getObjectiveThemes(deck);
    const curveNotes = getCurveNotes(deck, buckets);
    const landCount = countQuery(deck, { typeLineIncludes: "Land" });
    const nonlandCount = deck.entries.reduce((sum, entry) => sum + entry.quantity, 0) - landCount;

    return {
      id: createAnalysisId("deck"),
      kind: "deck-overview",
      title: `${deck.name} Overview`,
      summary: commander
        ? `${commander.name} leads a ${summarizeIdentity(commander)} list with ${deck.entries.length} unique cards loaded.`
        : `This Commander deck has ${deck.entries.length} unique cards loaded.`,
      layout: {
        type: "stack",
        children: [
          {
            type: "twoColumn",
            ratio: "1:1",
            left: [
              { type: "NarrativePanel", title: "Strategic Read", body: makeDeckRead(deck, strongestBuckets, subtypeClusters, curveNotes, commander) },
              {
                type: "GroupedCardList",
                groups: strongestBuckets.slice(0, 4).map((bucket) => ({
                  type: "CardList",
                  title: bucket.title,
                  cardIds: bucket.cardIds,
                  emptyText: "No matching cards found.",
                })),
              },
              ...(commanderQueries.length
                ? [
                    {
                      type: "GroupedCardList" as const,
                      groups: commanderQueries.map(({ title, query }) => ({
                        type: "CardList" as const,
                        title,
                        query,
                        emptyText: "No matching cards found.",
                      })),
                    },
                  ]
                : []),
            ],
            right: [
              {
                type: "StatBlock",
                stats: [
                  { label: "Lands", value: landCount },
                  { label: "Nonlands", value: nonlandCount },
                  { label: "Ramp", value: bucketCount(buckets, "ramp") },
                  { label: "Draw", value: bucketCount(buckets, "draw") },
                  { label: "Interaction", value: bucketCount(buckets, "interaction") },
                  { label: "Avg Nonland MV", value: getAverageNonlandManaValue(deck).toFixed(1) },
                ],
              },
              { type: "ManaCurveChart", title: "Mana Curve" },
              { type: "TypeBreakdownChart", title: "Type Breakdown" },
              { type: "ColorPipChart", title: "Color Identity" },
              {
                type: "TagBreakdown",
                title: "Detected Themes",
                tags: [
                  ...strongestBuckets.map((bucket) => ({ label: bucket.title.replace(" and ", " + "), count: bucket.count })),
                  ...subtypeClusters.slice(0, 3).map((cluster) => ({ label: `${cluster.subtype} creatures`, count: cluster.count })),
                ].slice(0, 8),
              },
            ],
          },
          { type: "EvidenceList", title: "Evidence" },
        ],
      },
      evidence: [
        ...(commander ? [{ claim: `${commander.name} is selected as the commander.`, cardIds: [commander.id] }] : []),
        { claim: `The deck currently shows ${landCount} lands and ${nonlandCount} nonlands.`, query: { typeLineIncludes: "Land" } },
        ...strongestBuckets.slice(0, 4).map((bucket) => ({
          claim: `${bucket.title} has ${bucket.count} card${bucket.count === 1 ? "" : "s"}: ${bucket.summary}`,
          cardIds: bucket.cardIds.slice(0, 8),
        })),
        ...objectiveThemes.slice(0, 3).map((theme) => ({
          claim: `${capitalize(theme.theme)} appears in Oracle text on ${theme.count} card${theme.count === 1 ? "" : "s"}.`,
          query: theme.query,
        })),
        ...subtypeClusters.slice(0, 2).map((cluster) => ({
          claim: `${cluster.subtype} is the most visible creature subtype cluster with ${cluster.count} card${cluster.count === 1 ? "" : "s"}.`,
          cardIds: cluster.cardIds,
        })),
      ],
      createdAt: new Date().toISOString(),
      source: "mock",
    };
  }

  async analyzeCard(input: CardAnalysisInput): Promise<AnalysisResult> {
    const { deck, cardId } = input;
    const card = getCardById(deck, cardId);
    if (!card) throw new Error("Card was not found in the current deck.");

    const text = cardText(card);
    const typeLine = getPrimaryTypeLine(card);
    const relatedQueries = inferRelatedQueries(card);
    const relatedBuckets = analyzeBuckets(deck)
      .filter((bucket) => bucket.cardIds.includes(card.id) || cardTouchesBucket(card, bucket.id))
      .slice(0, 3);
    const subtypeQueries = inferSubtypeQueries(card);
    const groups = [
      ...relatedBuckets.map((bucket) => ({
        type: "CardList" as const,
        title: bucket.title,
        cardIds: bucket.cardIds,
        emptyText: "No matching cards found.",
      })),
      ...relatedQueries.map(({ title, query }) => ({
        type: "CardList" as const,
        title,
        query,
        emptyText: "No matching cards found.",
      })),
      ...subtypeQueries.map(({ title, query }) => ({
        type: "CardList" as const,
        title,
        query,
        emptyText: "No matching cards found.",
      })),
    ].slice(0, 5);

    return {
      id: createAnalysisId("card"),
      kind: "card-analysis",
      subjectCardId: cardId,
      title: card.name,
      summary: `${card.name} is a ${typeLine || "card"} in this deck. This pass checks role, deck support, and query-backed related cards.`,
      layout: {
        type: "stack",
        children: [
          {
            type: "twoColumn",
            ratio: "1:1",
            left: [
              { type: "CardDescription", cardId },
              {
                type: "NarrativePanel",
                title: "Strategic Role",
                body: makeCardRole(deck, card, relatedBuckets),
              },
            ],
            right: [
              {
                type: "StatBlock",
                stats: [
                  ...relatedBuckets.map((bucket) => ({ label: bucket.title, value: bucket.count })),
                  ...relatedQueries.map(({ title, query }) => ({ label: title, query })),
                ].slice(0, 6),
              },
              { type: "GroupedCardList", groups },
            ],
          },
          { type: "EvidenceList", title: "Evidence" },
        ],
      },
      evidence: [
        { claim: "The card text and type line are the basis for this mock analysis.", cardIds: [cardId] },
        ...(text.includes("land") ? [{ claim: `${card.name} references lands, so the analysis checks lands and ramp support.`, cardIds: [cardId] }] : []),
        ...relatedBuckets.map((bucket) => ({
          claim: `${card.name} maps to ${bucket.title}.`,
          cardIds: [cardId, ...bucket.cardIds.filter((id) => id !== cardId).slice(0, 5)],
        })),
        ...relatedQueries.map(({ title, query }) => ({
          claim: `${title} is backed by a live deck query.`,
          query,
        })),
      ],
      createdAt: new Date().toISOString(),
      source: "mock",
    };
  }

  async analyzeCardGraph(input: CardGraphAnalysisInput): Promise<DeckGraphPatch> {
    return generateCardGraphPatch(input.deck, input.graph, input.cardId, input.prompt);
  }

  async answerQuestion(input: FreeformDeckQuestionInput): Promise<AnalysisResult> {
    return {
      id: createAnalysisId("question"),
      kind: "freeform",
      title: "Mock Answer",
      summary: input.question,
      layout: {
        type: "stack",
        children: [
          {
            type: "NarrativePanel",
            title: "Mock Provider",
            body: "Freeform question answering is wired through the provider contract. A local or remote model can replace this mock response later.",
          },
          { type: "EvidenceList", title: "Evidence" },
        ],
      },
      evidence: [{ claim: "The app sent the current deck snapshot and query capabilities to the provider.", note: availableQueries.map((query) => query.id).join(", ") }],
      createdAt: new Date().toISOString(),
      source: "mock",
    };
  }
}

function analyzeBuckets(deck: DeckSnapshot): BucketResult[] {
  return SEMANTIC_BUCKETS.map((bucket) => {
    const matches = deck.entries.filter(bucket.test);
    return {
      id: bucket.id,
      title: bucket.title,
      summary: bucket.summary,
      count: matches.reduce((sum, entry) => sum + entry.quantity, 0),
      cardIds: matches.map((entry) => entry.id),
    };
  }).sort((a, b) => b.count - a.count);
}

function getObjectiveThemes(deck: DeckSnapshot): { theme: string; count: number; query: DeckQuery }[] {
  return OBJECTIVE_THEMES.map((theme) => ({
    theme,
    count: countQuery(deck, { oracleTextIncludes: theme }),
    query: { oracleTextIncludes: theme } satisfies DeckQuery,
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function getCreatureSubtypeClusters(deck: DeckSnapshot): { subtype: string; count: number; cardIds: string[] }[] {
  const clusters = new Map<string, { count: number; cardIds: string[] }>();
  deck.entries.forEach((entry) => {
    const typeLine = getPrimaryTypeLine(entry);
    if (!typeLine.toLowerCase().includes("creature") || !typeLine.includes("—")) return;
    const [, subtypeText] = typeLine.split("—");
    subtypeText
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => /^[A-Za-z]+$/.test(part))
      .forEach((subtype) => {
        const current = clusters.get(subtype) ?? { count: 0, cardIds: [] };
        current.count += entry.quantity;
        current.cardIds.push(entry.id);
        clusters.set(subtype, current);
      });
  });
  return Array.from(clusters.entries())
    .map(([subtype, cluster]) => ({ subtype, ...cluster }))
    .filter((cluster) => cluster.count >= 2)
    .sort((a, b) => b.count - a.count || a.subtype.localeCompare(b.subtype));
}

function inferCommanderQueries(commander: DeckEntry): { title: string; query: DeckQuery }[] {
  const text = cardText(commander);
  const queries: { title: string; query: DeckQuery }[] = [];
  if (text.includes("land")) queries.push({ title: "Land and Landfall Support", query: { oracleTextIncludes: "land" } });
  if (text.includes("draw")) queries.push({ title: "Other Draw Effects", query: { oracleTextIncludes: "draw" } });
  if (text.includes("token")) queries.push({ title: "Token Support", query: { oracleTextIncludes: "token" } });
  if (text.includes("artifact")) queries.push({ title: "Artifact Support", query: { typeLineIncludes: "Artifact" } });
  if (text.includes("graveyard")) queries.push({ title: "Graveyard Support", query: { oracleTextIncludes: "graveyard" } });
  inferSubtypeQueries(commander).forEach((query) => queries.push(query));
  return dedupeQueries(queries).slice(0, 4);
}

function inferRelatedQueries(card: DeckEntry): { title: string; query: DeckQuery }[] {
  const text = cardText(card);
  const typeLine = getPrimaryTypeLine(card);
  const queries: { title: string; query: DeckQuery }[] = [];
  const add = (title: string, query: DeckQuery) => queries.push({ title, query });

  if (/wizard/i.test(`${text} ${typeLine}`)) add("Wizard Cards", { typeLineIncludes: "Wizard" });
  if (text.includes("artifact")) add("Artifacts", { typeLineIncludes: "Artifact" });
  if (text.includes("enchantment")) add("Enchantments", { typeLineIncludes: "Enchantment" });
  if (text.includes("graveyard")) add("Graveyard Text", { oracleTextIncludes: "graveyard" });
  if (text.includes("token")) add("Token Text", { oracleTextIncludes: "token" });
  if (text.includes("land")) add("Land Text", { oracleTextIncludes: "land" });
  if (text.includes("instant") || text.includes("sorcery")) add("Instant/Sorcery Text", { oracleTextIncludes: "instant" });
  if (text.includes("draw")) add("Draw Effects", { oracleTextIncludes: "draw" });
  if (text.includes("sacrifice")) add("Sacrifice Effects", { oracleTextIncludes: "sacrifice" });
  if (text.includes("counter")) add("Counter Text", { oracleTextIncludes: "counter" });
  if (!queries.length && typeLine) add("Same Card Type", { typeLineIncludes: typeLine.split(" ")[0] || "Creature" });
  return dedupeQueries(queries).slice(0, 4);
}

function inferSubtypeQueries(card: DeckEntry): { title: string; query: DeckQuery }[] {
  const typeLine = getPrimaryTypeLine(card);
  if (!typeLine.toLowerCase().includes("creature") || !typeLine.includes("—")) return [];
  const [, subtypeText] = typeLine.split("—");
  return subtypeText
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z]+$/.test(part))
    .slice(0, 2)
    .map((subtype) => ({ title: `${subtype} Cards`, query: { typeLineIncludes: subtype } }));
}

function getCurveNotes(deck: DeckSnapshot, buckets: BucketResult[]): string[] {
  const landCount = countQuery(deck, { typeLineIncludes: "Land" });
  const rampCount = bucketCount(buckets, "ramp");
  const drawCount = bucketCount(buckets, "draw");
  const interactionCount = bucketCount(buckets, "interaction");
  const averageMv = getAverageNonlandManaValue(deck);
  const highMvCount = manaCurve(deck)
    .filter((point) => point.manaValue >= 5)
    .reduce((sum, point) => sum + point.count, 0);
  const notes: string[] = [];

  if (landCount < 34) notes.push(`Land count looks light for a typical Commander shell at ${landCount}.`);
  else if (landCount > 39) notes.push(`Land count is on the higher side at ${landCount}.`);
  else notes.push(`Land count is in a normal Commander band at ${landCount}.`);

  if (rampCount < 8) notes.push(`Ramp count is modest at ${rampCount}; many Commander decks want about 8-12 accelerants.`);
  else notes.push(`Ramp support looks healthy at ${rampCount} detected cards.`);

  if (drawCount < 8) notes.push(`Card advantage is modest at ${drawCount} detected cards.`);
  else notes.push(`Card advantage looks supported with ${drawCount} detected cards.`);

  if (interactionCount < 6) notes.push(`Interaction is a little thin at ${interactionCount} detected cards.`);
  else notes.push(`Interaction has a reasonable base at ${interactionCount} detected cards.`);

  notes.push(`Average nonland mana value is ${averageMv.toFixed(1)}, with ${highMvCount} card${highMvCount === 1 ? "" : "s"} at five or more mana.`);
  return notes;
}

function makeDeckRead(
  deck: DeckSnapshot,
  buckets: BucketResult[],
  subtypeClusters: { subtype: string; count: number }[],
  curveNotes: string[],
  commander?: DeckEntry,
): string {
  const bucketText = buckets.length
    ? `The strongest functional packages are ${buckets.map((bucket) => `${bucket.title} (${bucket.count})`).join(", ")}.`
    : "No major functional package surfaced from the mock heuristics yet.";
  const subtypeText = subtypeClusters.length
    ? `Creature subtype clustering is led by ${subtypeClusters.slice(0, 3).map((cluster) => `${cluster.subtype} (${cluster.count})`).join(", ")}.`
    : "No repeated creature subtype cluster was detected.";
  const commanderText = commander
    ? `${commander.name} is the strategic anchor; the deck read checks cards that echo its rules text and subtype line.`
    : "Choose a commander during import to give the analysis a sharper anchor.";
  return `${commanderText} ${bucketText} ${subtypeText} ${curveNotes.join(" ")}`;
}

function makeCardRole(deck: DeckSnapshot, card: DeckEntry, buckets: BucketResult[]): string {
  const text = cardText(card);
  const typeLine = getPrimaryTypeLine(card);
  const commander = getCommander(deck);
  const role = buckets.length
    ? `${card.name} maps most clearly to ${buckets.map((bucket) => bucket.title).join(", ")}.`
    : `${card.name} is evaluated from its printed type line (${typeLine || "unknown"}) and rules text.`;
  const commanderTie =
    commander && card.id !== commander.id && sharesCommanderLanguage(card, commander)
      ? `It also appears to share language with ${commander.name}, so it may be part of the commander-facing plan.`
      : "";
  if (text.includes("land")) return `${role} Because it references lands, the related panels check land text, land count, and ramp support. ${commanderTie}`.trim();
  if (text.includes("draw")) return `${role} It contributes to card advantage, which is one of the easiest roles to validate with Oracle text. ${commanderTie}`.trim();
  if (text.includes("token")) return `${role} It points toward token production or token payoffs, so the related sections look for other token text. ${commanderTie}`.trim();
  if (text.includes("graveyard")) return `${role} It asks the deck to care about the graveyard, so the support groups check recursion, mill, and graveyard text. ${commanderTie}`.trim();
  return `${role} ${commanderTie}`.trim();
}

function cardTouchesBucket(card: DeckEntry, bucketId: string): boolean {
  const bucket = SEMANTIC_BUCKETS.find((item) => item.id === bucketId);
  return bucket ? bucket.test(card) : false;
}

function sharesCommanderLanguage(card: DeckEntry, commander: DeckEntry): boolean {
  const commanderText = cardText(commander);
  const cardTextValue = cardText(card);
  return ["land", "draw", "token", "artifact", "graveyard", "sacrifice", "counter"].some(
    (word) => commanderText.includes(word) && cardTextValue.includes(word),
  );
}

function getAverageNonlandManaValue(deck: DeckSnapshot): number {
  let totalValue = 0;
  let totalCards = 0;
  deck.entries.forEach((entry) => {
    if (isLand(entry)) return;
    totalValue += getManaValue(entry) * entry.quantity;
    totalCards += entry.quantity;
  });
  return totalCards ? totalValue / totalCards : 0;
}

function isLand(entry: DeckEntry): boolean {
  return getPrimaryTypeLine(entry).toLowerCase().includes("land");
}

function bucketCount(buckets: BucketResult[], bucketId: string): number {
  return buckets.find((bucket) => bucket.id === bucketId)?.count ?? 0;
}

function cardText(entry: DeckEntry): string {
  return `${entry.name} ${getPrimaryTypeLine(entry)} ${getOracleText(entry)}`.toLowerCase();
}

function dedupeQueries(queries: { title: string; query: DeckQuery }[]): { title: string; query: DeckQuery }[] {
  const seen = new Set<string>();
  return queries.filter((item) => {
    const key = JSON.stringify(item.query);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeIdentity(card: { scryfall?: { color_identity?: string[] } }): string {
  const identity = card.scryfall?.color_identity ?? [];
  return identity.length ? identity.join("") : "colorless";
}

function createAnalysisId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
