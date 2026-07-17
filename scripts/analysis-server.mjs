import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.MTG_ANALYSIS_PORT ?? 8787);
const RUNNER = process.env.MTG_ANALYSIS_RUNNER ?? "scaffold";
const CODEX_BIN = process.env.CODEX_BIN ?? "/Applications/Codex.app/Contents/Resources/codex";
const CODEX_TIMEOUT_MS = Number(process.env.MTG_CODEX_TIMEOUT_MS ?? 120_000);
const DEFAULT_CODEX_MODEL = process.env.MTG_CODEX_MODEL ?? "gpt-5.4";
const DEFAULT_CODEX_REASONING_EFFORT = process.env.MTG_CODEX_REASONING_EFFORT ?? "low";
const EDGE_FUNCTION_ATTRIBUTE_REFERENCE = loadEdgeFunctionAttributeReference();
const COMPACT_EDGE_FUNCTION_ATTRIBUTE_REFERENCE = [
  "Use selector.attributes for selected-card -> matching-card functions, or sourceSelector.attributes with targetId for matching-card -> selected-card/group functions.",
  "Supported virtual paths: card.type_line_all, card.oracle_text_all, card.is_land, card.is_nonland, card.is_commander, card.mana_value.",
  "Scryfall paths are also available directly, including type_line, oracle_text, keywords, colors, color_identity, cmc, produced_mana, and card_faces.*.oracle_text.",
  "Supported ops: exists, equals, notEquals, contains, notContains, includes, notIncludes, >, >=, <, <=.",
  "Selectors are AND-only across attributes; prefer a narrower function over an overbroad one.",
].join("\n");

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/analyze") {
    sendJson(response, 404, { error: "Use POST /analyze." });
    return;
  }

  try {
    const body = await readJson(request);
    const result = await runCodexAnalysis(body);
    sendJson(response, 200, result);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Analysis failed.",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MTG analysis endpoint listening on http://127.0.0.1:${PORT}/analyze`);
  console.log(`Analysis runner: ${RUNNER}`);
});

async function runCodexAnalysis(request) {
  const { action, input, options } = request ?? {};
  if (!["analyzeDeck", "analyzeCard", "analyzeDeckGraph", "analyzeCardGraph", "answerQuestion"].includes(action)) {
    throw new Error("Invalid action.");
  }

  const deck = input?.deck;
  if (!deck?.entries?.length) {
    throw new Error("Request input must include a deck snapshot.");
  }

  if (RUNNER === "codex") {
    return runCodexExecAnalysis(action, input, options);
  }

  if (action === "analyzeDeckGraph") {
    return makeDeckGraphPatch(deck, input.graph, input.prompt);
  }

  if (action === "analyzeCardGraph") {
    return makeCardGraphPatch(deck, input.cardId, input.graph, input.prompt);
  }

  if (action === "analyzeCard") {
    const card = deck.entries.find((entry) => entry.id === input.cardId);
    if (!card) throw new Error("Card id was not found in deck snapshot.");
    return makeCardAnalysis(deck, card);
  }

  if (action === "answerQuestion") {
    return makeQuestionAnalysis(deck, input.question ?? "");
  }

  return makeDeckAnalysis(deck);
}

async function runCodexExecAnalysis(action, input, options = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "mtg-analysis-"));
  const outputPath = join(workDir, "analysis-result.json");
  const codexModel = normalizeCodexModel(options.codexModel) ?? DEFAULT_CODEX_MODEL;
  const codexReasoningEffort = normalizeCodexReasoningEffort(options.codexReasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT;

  try {
    const promptRequest = await buildCodexPrompt(action, input, workDir);
    const prompt = promptRequest.prompt;
    const promptUsage = {
      promptChars: prompt.length,
      promptTokensEstimate: estimateTokens(prompt),
      contextFileChars: promptRequest.contextFileChars ?? 0,
      contextFileTokensEstimate: estimateTokensByChars(promptRequest.contextFileChars ?? 0),
    };
    if (action === "analyzeDeckGraph") {
      console.log(
        `Deck graph prompt size for ${input?.deck?.id ?? "unknown"}: ${promptUsage.promptChars.toLocaleString()} prompt chars + ${promptUsage.contextFileChars.toLocaleString()} context-file chars, ~${(promptUsage.promptTokensEstimate + promptUsage.contextFileTokensEstimate).toLocaleString()} input tokens.`,
      );
    }
    if (action === "analyzeCardGraph") {
      console.log(
        `Card graph prompt size for ${input?.cardId ?? "unknown"}: ${promptUsage.promptChars.toLocaleString()} prompt chars + ${promptUsage.contextFileChars.toLocaleString()} context-file chars, ~${(promptUsage.promptTokensEstimate + promptUsage.contextFileTokensEstimate).toLocaleString()} input tokens.`,
      );
    }
    const codexArgs = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-c",
      `model_reasoning_effort="${codexReasoningEffort}"`,
      ...(codexModel ? ["--model", codexModel] : []),
      "--output-last-message",
      outputPath,
      "-",
    ];
    console.log(
      `Codex runner settings: model=${codexModel ?? "config default"}, reasoning_effort=${codexReasoningEffort}, timeout=${CODEX_TIMEOUT_MS}ms.`,
    );
    const commandResult = await runCommand(
      CODEX_BIN,
      codexArgs,
      prompt,
      CODEX_TIMEOUT_MS,
      workDir,
    );

    const raw = await readFile(outputPath, "utf8");
    let parsed;
    try {
      parsed = parseCodexJson(raw);
    } catch (error) {
      if (action === "answerQuestion") {
        return makeQuestionFallbackAnalysis(input.deck, input.question ?? "", raw, error);
      }
      throw error;
    }
    if (action === "analyzeDeckGraph" || action === "analyzeCardGraph") {
      const reportedUsage = parseReportedTokenUsage(`${commandResult.stdout}\n${commandResult.stderr}`);
      return normalizeGraphPatch(parsed, input, makeGraphPatchUsage(promptUsage, raw, reportedUsage));
    }
    return normalizeAnalysisResult(parsed);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function estimateTokens(text) {
  return estimateTokensByChars(text.length);
}

function estimateTokensByChars(charCount) {
  return Math.ceil(charCount / 4);
}

function normalizeCodexModel(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeCodexReasoningEffort(value) {
  if (value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

async function buildCodexPrompt(action, input, workDir) {
  const deck = compactDeck(input.deck, { omitEntryId: action === "analyzeCardGraph" ? input.cardId : undefined });
  const selectedCardDeck = action === "analyzeCard" || action === "analyzeCardGraph" ? compactDeck(input.deck).entries.find((entry) => entry.id === input.cardId) : undefined;
  if (action === "analyzeDeckGraph") {
    const contextFiles = await writeDeckGraphContextFiles(workDir, input, deck);
    return {
      prompt: buildDeckGraphPatchPrompt(input, deck, contextFiles.files),
      contextFileChars: contextFiles.charCount,
    };
  }
  if (action === "analyzeCardGraph") {
    const contextFiles = await writeCardGraphContextFiles(workDir, input, deck, selectedCardDeck);
    return {
      prompt: buildCardGraphPatchPrompt(input, deck, selectedCardDeck, contextFiles.files),
      contextFileChars: contextFiles.charCount,
    };
  }
  return {
    prompt: `You are an MTG Commander synergy analyst for a local deck explorer app.

Return ONLY a single JSON object. Do not wrap it in markdown. Do not include commentary outside JSON.
The JSON must be syntactically valid: double-quote every string, separate every array element with a comma, never use trailing commas, and escape newlines inside string values.

Your task is descriptive and evidence-backed:
- Prioritize synergy discovery.
- For deck analysis, explain the broad strategy, commander context, and support packages.
- For card analysis, explain what the selected card does in this deck and what cards support it.
- For answerQuestion, answer the user's specific question directly. Choose the best supported layout: a paragraph, card list, grouped card list, stats, charts, tabs, or any useful combination.
- Do not make keep/cut or upgrade recommendations.
- Use exact card ids from the provided deck.
- Use query-backed components for objective groups.
- Use explicit cardIds for semantic support groups.
- Every nontrivial claim should have evidence.
- The response is transient in the app and will not be saved; still return one complete AnalysisResult JSON object.
- Evidence items may ONLY use: claim, cardIds, query, note.
- Do not use evidence fields named detail, reason, sourceText, explanation, or cards.

Allowed AnalysisResult shape:
{
  "id": string,
  "kind": "deck-overview" | "card-analysis" | "freeform",
  "subjectCardId"?: string,
  "title": string,
  "summary"?: string,
  "layout": AnalysisLayoutNode,
  "evidence"?: EvidenceItem[],
  "createdAt": ISO string,
  "source": "codex-local"
}

Allowed layout nodes:
- {"type":"stack","children": AnalysisLayoutNode[]}
- {"type":"twoColumn","left": AnalysisLayoutNode[],"right": AnalysisLayoutNode[],"ratio"?: "1:1"|"2:1"|"1:2"}
- {"type":"tabs","tabs":[{"label": string,"children": AnalysisLayoutNode[]}]}
- {"type":"CardDescription","cardId": string}
- {"type":"NarrativePanel","title"?: string,"body": string}
- {"type":"StatBlock","stats":[{"label": string,"value"?: string|number,"query"?: DeckQuery}]}
- {"type":"CardList","title": string,"query"?: DeckQuery,"cardIds"?: string[],"emptyText"?: string}
- {"type":"GroupedCardList","groups": CardList[]}
- {"type":"ManaCurveChart","title"?: string}
- {"type":"ColorPipChart","title"?: string}
- {"type":"TypeBreakdownChart","title"?: string}
- {"type":"TagBreakdown","title"?: string,"tags":[{"label": string,"count": number}]}
- {"type":"EvidenceList","title"?: string}

Allowed DeckQuery fields:
typeLineIncludes, oracleTextIncludes, nameIncludes, colorsInclude, colorIdentityIncludes, manaValue { min, max }, isCommander, isLand, isNonland.

Allowed EvidenceItem shape:
{"claim": string, "cardIds"?: string[], "query"?: DeckQuery, "note"?: string}

Important: every item inside GroupedCardList.groups MUST include "type": "CardList".
Important: if kind is "card-analysis", subjectCardId MUST equal the selected card id.

Request action: ${action}
User question: ${action === "answerQuestion" ? input.question ?? "" : ""}
Selected card id: ${input.cardId ?? ""}
Selected card: ${selectedCardDeck ? JSON.stringify(selectedCardDeck) : "none"}
Available query capabilities: ${JSON.stringify(input.availableQueries ?? [])}
Deck snapshot:
${JSON.stringify(deck)}

Return the JSON now.`,
  };
}

async function writeDeckGraphContextFiles(workDir, input, deck) {
  const graph = compactGraph(input.graph);
  const graphSummary = compactGraphSummary(graph);
  const nodeMap = compactGraphNodeMap(graph);
  const files = {
    deckSeedCards: "deck-seed-cards.jsonl",
    graphNodeMap: "graph-node-map.json",
    graphSummary: "graph-summary.json",
  };
  const fileContents = {
    [files.deckSeedCards]: compactDeckSeedEntries(deck).map((entry) => JSON.stringify(entry)).join("\n"),
    [files.graphNodeMap]: `${JSON.stringify(nodeMap ?? null, null, 2)}\n`,
    [files.graphSummary]: `${JSON.stringify(graphSummary ?? null, null, 2)}\n`,
  };
  await Promise.all(Object.entries(fileContents).map(([fileName, content]) => writeFile(join(workDir, fileName), content, "utf8")));
  console.log(`Deck graph context files for ${input?.deck?.id ?? "unknown"} written to temporary query directory: ${Object.values(files).join(", ")}.`);
  return {
    files,
    charCount: Object.values(fileContents).reduce((total, content) => total + content.length, 0),
  };
}

async function writeCardGraphContextFiles(workDir, input, deck, selectedCard) {
  const graph = compactGraph(input.graph);
  const relatedGraphContext = compactRelatedGraphContext(graph, input.cardId);
  const graphSummary = compactGraphSummary(graph);
  const files = {
    selectedCard: "selected-card.json",
    deckCardPool: "deck-card-pool.jsonl",
    relatedGraphContext: "related-graph-context.json",
    graphSummary: "graph-summary.json",
    edgeFunctionAttributeReference: "edge-function-attribute-reference.md",
  };
  const fileContents = {
    [files.selectedCard]: `${JSON.stringify(selectedCard ?? null, null, 2)}\n`,
    [files.deckCardPool]: compactCardGraphPool(deck, selectedCard).map((entry) => JSON.stringify(entry)).join("\n"),
    [files.relatedGraphContext]: `${JSON.stringify(relatedGraphContext ?? null, null, 2)}\n`,
    [files.graphSummary]: `${JSON.stringify(graphSummary ?? null, null, 2)}\n`,
    [files.edgeFunctionAttributeReference]: COMPACT_EDGE_FUNCTION_ATTRIBUTE_REFERENCE,
  };
  await Promise.all([
    ...Object.entries(fileContents).map(([fileName, content]) => writeFile(join(workDir, fileName), content, "utf8")),
  ]);
  console.log(
    `Card graph context files for ${input?.cardId ?? "unknown"} written to temporary query directory: ${Object.values(files).join(", ")}.`,
  );
  return {
    files,
    charCount: Object.values(fileContents).reduce((total, content) => total + content.length, 0),
  };
}

function buildCardGraphPatchPrompt(input, deck, selectedCard, contextFiles) {
  const customPrompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  return `You are an MTG Commander synergy graph analyst for a local deck explorer app.

Return ONLY a single JSON object. Do not wrap it in markdown. Do not include commentary outside JSON.

Your task: generate a card-level graph patch for the selected card. This patch will be applied on top of an existing deck graph.

The deck and graph context are available as files in your current working directory. Read them as needed instead of relying on the prompt for full context.

Context files:
- ${contextFiles.selectedCard}: compact gameplay-only JSON for the selected card.
- ${contextFiles.deckCardPool}: compact gameplay-only JSONL for every other card in the deck, one card per line.
- ${contextFiles.relatedGraphContext}: existing graph nodes/edges related to the selected card.
- ${contextFiles.graphSummary}: counts and summaries for the current graph.
- ${contextFiles.edgeFunctionAttributeReference}: supported edgeFunction selector paths and examples.

Rules:
- Analyze ONLY relationships created by the selected card's rules text and deck role.
- First account for the related graph context and existing graph edges before changing the graph.
- Add edges this selected card meaningfully creates, enables, supports, protects, answers, pays off, depends on, or is weak to; the selected card may be the source or target when directionality requires it.
- Prefer precise card-to-card edges over vague package edges.
- Add concept nodes only when they clarify this card's role.
- Do not generate edges for unrelated cards unless the selected card is source or target.
- Use the related graph context to understand existing incoming/outgoing relationships before adding new ones.
- Do not duplicate an existing related edge unless the new edge has a clearer kind, stronger evidence, or adds a missing directional counterpart.
- The same two card nodes may have multiple meaningful relationships. Keep each distinct relationship when it has a different operational reason, and separate those visible categories with different connectionGroup values.
- Prefer edgeFunctions over enumerating many similar edges when a rule applies to a class of cards.
- Use sourceId + selector when the selected card creates edges to matching cards.
- Use sourceSelector + targetId when matching cards create edges to the selected card.
- Edge kind is a machine-readable semantic hint. It is not the user-facing category. Use connectionGroup as the expressive, user-facing relationship label whenever possible.
- For AI-generated edges and edgeFunctions, set connectionGroup to a concise phrase that describes the actual relationship, not merely the edge kind. Prefer labels like "Doubles Damage", "Reanimation Targets", "Cannot Reanimate", "Cast From Graveyard", "Feeds Sacrifice", "Death Trigger Payoffs", "Protects Commander", or other deck-specific phrases supported by the selected card text.
- Use the fixed kind values as suggestions for graph semantics: "enables" means turns on access/conditions/triggers, "pays_off" means rewards a class/action, "supports" means softer consistency/access, and so on. The visible connection category should usually come from connectionGroup.
- When two edges share sourceId, targetId, and kind but express different relationships, give each edge a distinct connectionGroup and append a short slug to the edge id after the kind.
- Use edgeFunctions for repeated custom relationships, with connectionGroup set to the same expressive label the user should see in the Connections panel.
- EdgeFunction selectors must describe the smallest meaningful operational class, not the broadest technically true class.
- Avoid overbroad selectors such as all Creatures, all Permanents, all Spells, all Artifacts, all graveyard cards, or all cards with a common word when only a narrower subset actually improves the selected card.
- Prefer narrowing selectors with role-relevant evidence: token makers, expendable bodies, recursive cards, cards with matching triggered text, cards that explicitly mention the selected type/zone/action, low mana value if timing matters, commander-only if protection is commander-specific, or nonland/noncreature filters when the rules text says so.
- Use a broad selector only when the selected card's rules text truly cares about every card in that class and each generated edge would teach useful deck knowledge.
- If a selector would create many weak or obvious edges, skip the edgeFunction or create a concept node/summary edge instead.
- Do not add obvious generic resource edges. Avoid claims like "CardA helps cast CardB", "land helps cast spell", "mana rock supports high mana value card", or "ramp enables finisher" unless the selected card has a non-generic rules-text interaction with that exact card.
- Good edges should teach specific deck knowledge: artifact recursion, casting from graveyard, cards sharing named card types/subtypes, sacrifice/death triggers, token production feeding a payoff, protection preserving a key permanent, removal answering a threat class, or a card explicitly caring about another card's type/zone/action.
- If a custom prompt is provided, satisfy it as an additional instruction while preserving the base rules above.
- Custom prompts may ask for new groupings. In that case, add high-signal concept nodes and edges/functions that make the grouping visible in the graph.
- If the user asks to "add a group", "make a group", "category", "bucket", or similar, create a concept node with that exact requested label when evidence supports it.
- Populate custom groups with direct "belongs_to" edges from each matching card node to the group node. Set connectionGroup to the requested group label on those membership edges.
- A selected-card -> group edge such as "weak_to", "supports", or "depends_on" may be added only as extra interpretation; it must not be the only representation of a requested group.
- Do not satisfy a requested group only with an edgeFunction. EdgeFunctions may supplement the group, but explicit group membership edges should be present for the matching cards. If an edgeFunction supports a custom connection bucket, set connectionGroup on it too.
- Edge kinds like "enables" and "pays_off" are relationship semantics, not the only connection categories. Prefer connectionGroup for every card-specific or user-provided category.
- Do not remove, replace, or omit existing useful relationships for the selected card when satisfying a custom prompt unless the user explicitly asks to clear or replace them.
- Do not blindly create the requested group if the deck evidence does not support it. Prefer a short note explaining what was not found.
- Direction guide: use "enables" for the thing that turns on a trigger, condition, access, or transformation; use "pays_off" for the thing that rewards the deck for doing that action or having that class of card.
- Example of a bad edge: CardA -> CardB only because CardA makes mana.
- Example: Wizards enable CardA's transformation, so use sourceSelector { "attributes": [{ "path": "card.type_line_all", "op": "contains", "value": "Wizard" }] }, targetId "card:<selectedCardId>", kind "enables".
- Example: CardA pays off Wizards by doubling their damage, so use sourceId "card:<selectedCardId>", selector { "attributes": [{ "path": "card.type_line_all", "op": "contains", "value": "Wizard" }] }, kind "pays_off".
- Attribute example: CardA enables cheap artifacts, so use selector { "attributes": [{ "path": "type_line", "op": "contains", "value": "Artifact" }, { "path": "cmc", "op": "<=", "value": 3 }] }.
- Attribute example: cards with any Wizard face enable CardA, so use sourceSelector { "attributes": [{ "path": "card_faces.*.type_line", "op": "contains", "value": "Wizard" }] }.
- Example: sorceries/noncreature spells enable CardA's trigger; CardA pays off casting noncreature spells.
- Example: CardA enables selector { "attributes": [{ "path": "card.type_line_all", "op": "contains", "value": "Artifact" }] } with customMessage "CardA allows you to cast this from the graveyard."
- Example: CardA has "Whenever you cast a noncreature spell, this token deals 1 damage to each opponent", so use pays_off selector { "attributes": [{ "path": "card.is_nonland", "op": "equals", "value": true }, { "path": "card.type_line_all", "op": "notContains", "value": "Creature" }] } with customMessage "CardA rewards casting this noncreature spell by dealing damage to each opponent."
- Use exact card ids and graph node ids from the provided deck/graph whenever referencing existing cards/nodes.
- For card nodes, use id format "card:<cardId>".
- For new concept nodes, use id format "ai:<selectedCardId>:<short-slug>".
- For new AI edges, use source "ai-enriched".
- Keep edges high-signal. Usually 3-12 edges is enough.
- Every edge should have evidence.
- Do not recommend cuts or upgrades.

Allowed node kind: "card" | "package" | "strategy" | "resource" | "risk"
Allowed edge kind: "supports" | "enables" | "pays_off" | "protects" | "answers" | "depends_on" | "weak_to" | "belongs_to"
Allowed edge source: "ai-enriched"
Allowed strength: 1 | 2 | 3 | 4 | 5

Required DeckGraphPatch shape:
{
  "id": string,
  "deckId": "${deck.id}",
  "cardId": "${input.cardId}",
  "nodesToUpsert": [
    {
      "id": string,
      "kind": "card" | "package" | "strategy" | "resource" | "risk",
      "label": string,
      "summary": string,
      "cardId"?: string,
      "cardIds"?: string[],
      "weight": number
    }
  ],
  "edgesToUpsert": [
    {
      "id": string,
      "sourceId": string,
      "targetId": string,
      "kind": "supports" | "enables" | "pays_off" | "protects" | "answers" | "depends_on" | "weak_to" | "belongs_to",
      "source": "ai-enriched",
      "strength": 1 | 2 | 3 | 4 | 5,
      "evidence": string,
      "cardIds"?: string[],
      "generatedByFunctionId"?: string,
      "connectionGroup"?: string
    }
  ],
  "edgeFunctions"?: [
    {
      "id": string,
      "sourceId"?: string,
      "targetId"?: string,
      "kind": "supports" | "enables" | "pays_off" | "protects" | "answers" | "depends_on" | "weak_to" | "belongs_to",
      "selector"?: {
        "attributes"?: [
          {
            "path": string,
            "op": "exists" | "equals" | "notEquals" | "contains" | "notContains" | "includes" | "notIncludes" | ">" | ">=" | "<" | "<=",
            "value"?: string | number | boolean | string[] | number[]
          }
        ]
      },
      "sourceSelector"?: {
        "attributes"?: [
          {
            "path": string,
            "op": "exists" | "equals" | "notEquals" | "contains" | "notContains" | "includes" | "notIncludes" | ">" | ">=" | "<" | "<=",
            "value"?: string | number | boolean | string[] | number[]
          }
        ]
      },
      "customMessage": string,
      "strength": 1 | 2 | 3 | 4 | 5,
      "connectionGroup"?: string
    }
  ],
  "edgeIdsToRemove"?: string[],
  "notes": string[],
  "generatedAt": ISO string,
  "source": "ai"
}

Edge id format:
Use "<sourceId>-><targetId>:<kind>" for a single ungrouped relationship, or "<sourceId>-><targetId>:<kind>:<relationship-slug>" when connectionGroup distinguishes this relationship from another edge between the same nodes.

Edge function id format:
Use "fn:<selectedCardId>:<short-slug>".

Edge function attribute query reference:
Read ${contextFiles.edgeFunctionAttributeReference} before creating edgeFunctions.

Selected card id: ${input.cardId}
Selected card:
Read ${contextFiles.selectedCard}.

Related graph context:
Read ${contextFiles.relatedGraphContext}.

Custom user prompt:
${customPrompt || "(none)"}

Existing graph summary:
Read ${contextFiles.graphSummary}.

Deck card pool:
Read/search ${contextFiles.deckCardPool}. This file intentionally omits the selected card to avoid duplicating ${contextFiles.selectedCard}.

Return the DeckGraphPatch JSON now.`;
}

function buildDeckGraphPatchPrompt(input, deck, contextFiles) {
  const customPrompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  return `You are an MTG Commander synergy graph analyst for a local deck explorer app.

Return ONLY a single JSON object. Do not wrap it in markdown. Do not include commentary outside JSON.

Your task: generate an initial deck-level graph patch. This patch seeds broad, obvious connection groups for the whole deck and can be deleted like any other AI patch.

The deck and graph context are available as files in your current working directory. Read them as needed instead of relying on the prompt for full context.

Context files:
- ${contextFiles.deckSeedCards}: compact seed-pass JSONL for the deck, one card per line.
- ${contextFiles.graphNodeMap}: existing graph node IDs and labels.
- ${contextFiles.graphSummary}: counts and summaries for the current graph.

Rules:
- Generate deck-wide connection groups, not card-level deep dives.
- This is a fast first pass. Prefer 3-6 obvious groups and 3-6 edgeFunctions.
- Keep the current expressive group style. connectionGroup is the user-facing label and should describe what the AI found important.
- Prefer concise deck-specific labels such as "Token Bodies as Fuel", "Death Trigger Payoffs", "Artifact Recursion", "Commander Protection", "Graveyard Setup", or better labels supported by this deck.
- Use concept nodes for meaningful groups.
- Do not enumerate card memberships as direct edges. Use edgeFunctions only.
- Each group should usually have one edgeFunction with targetId set to the group node, kind "belongs_to", sourceSelector matching the card class, and connectionGroup set to the expressive group label.
- Do not fully analyze every individual card. This is a seed patch, meant to be made more granular by later card-level passes.
- Do not recommend cuts or upgrades.
- Do not create rigid taxonomy labels just because they are available. Let the group labels follow the deck.
- Avoid generic mana or color edges such as "land helps cast spell".
- Use exact card ids and graph node ids from the provided deck/graph whenever referencing existing cards/nodes.
- For card nodes, use id format "card:<cardId>".
- For new concept nodes, use id format "ai:deck:<short-slug>".
- Set edgesToUpsert to [].
- Keep selectors high-signal. Use the smallest obvious predicate set that captures the group.
- Every edgeFunction should have a customMessage that explains why matching cards belong.
- If a custom prompt is provided, satisfy it while preserving the base rules above.
- Edge kind is a machine-readable semantic hint. It is not the user-facing category. Prefer connectionGroup for every card-specific, group-specific, or user-provided category.
- EdgeFunction selectors are AND-only. If a group needs OR logic, create a narrower group/function instead.

Allowed node kind: "card" | "package" | "strategy" | "resource" | "risk"
Allowed edge kind: "supports" | "enables" | "pays_off" | "protects" | "answers" | "depends_on" | "weak_to" | "belongs_to"
Allowed strength: 1 | 2 | 3 | 4 | 5
Supported selector paths:
- "card.type_line_all"
- "card.oracle_text_all"
- "card.is_land"
- "card.is_nonland"
- "card.is_commander"
- "card.mana_value"
Supported selector ops:
- "exists" | "equals" | "notEquals" | "contains" | "notContains" | "includes" | "notIncludes" | ">" | ">=" | "<" | "<="

Required DeckGraphPatch shape:
{
  "id": string,
  "deckId": "${deck.id}",
  "nodesToUpsert": [
    {
      "id": string,
      "kind": "card" | "package" | "strategy" | "resource" | "risk",
      "label": string,
      "summary": string,
      "cardId"?: string,
      "cardIds"?: string[],
      "weight": number
    }
  ],
  "edgesToUpsert": [],
  "edgeFunctions": [
    {
      "id": string,
      "targetId": string,
      "kind": "belongs_to",
      "sourceSelector": {
        "attributes": [
          {
            "path": string,
            "op": "exists" | "equals" | "notEquals" | "contains" | "notContains" | "includes" | "notIncludes" | ">" | ">=" | "<" | "<=",
            "value"?: string | number | boolean | string[] | number[]
          }
        ]
      },
      "customMessage": string,
      "strength": 1 | 2 | 3 | 4 | 5,
      "connectionGroup"?: string
    }
  ],
  "edgeIdsToRemove"?: [],
  "notes": string[],
  "generatedAt": ISO string,
  "source": "ai"
}

Edge function id format:
Use "fn:deck:<short-slug>".

Examples:
- A group node "ai:deck:token-bodies-as-fuel" can have an edgeFunction with targetId "ai:deck:token-bodies-as-fuel", kind "belongs_to", sourceSelector {"attributes":[{"path":"card.oracle_text_all","op":"contains","value":"token"}]}, and connectionGroup "Token Bodies as Fuel".
- A group node "ai:deck:graveyard-as-resource" can match {"path":"card.oracle_text_all","op":"contains","value":"graveyard"}.

Custom user prompt:
${customPrompt || "(none)"}

Existing graph:
Read ${contextFiles.graphNodeMap}.

Existing graph summary:
Read ${contextFiles.graphSummary}.

Deck card pool:
Read/search ${contextFiles.deckSeedCards}.

Return the DeckGraphPatch JSON now.`;
}

function loadEdgeFunctionAttributeReference() {
  try {
    return readFileSync(new URL("../docs/graph-edge-function-attributes.md", import.meta.url), "utf8").trim();
  } catch {
    return [
      "Use selector.attributes or sourceSelector.attributes for edgeFunctions.",
      "Each attribute predicate has path, op, and optional value.",
      "Paths resolve against Scryfall by default. Virtual paths include card.type_line_all, card.oracle_text_all, card.is_land, card.is_nonland, and card.is_commander.",
      "Valid ops: exists, equals, notEquals, contains, notContains, includes, notIncludes, >, >=, <, <=.",
    ].join("\n");
  }
}

function compactDeck(deck, options = {}) {
  return {
    id: deck.id,
    format: deck.format,
    commanderId: deck.commanderId,
    entries: deck.entries
      .filter((entry) => entry.id !== options.omitEntryId)
      .map((entry) => compactDeckEntry(entry, deck.commanderId)),
  };
}

function compactDeckEntry(entry, commanderId) {
  const card = entry.scryfall;
  const faces = card?.card_faces?.map((face) =>
    compactObject({
      name: face.name,
      manaCost: face.mana_cost,
      typeLine: face.type_line,
      oracleText: face.oracle_text,
      power: face.power,
      toughness: face.toughness,
      loyalty: face.loyalty,
      defense: face.defense,
    }),
  );
  const hasFaces = Boolean(faces?.length);
  return compactObject({
    id: entry.id,
    name: entry.name,
    quantity: entry.quantity,
    section: entry.section,
    isCommander: entry.id === commanderId || undefined,
    unresolved: entry.unresolved || undefined,
    manaCost: card?.mana_cost,
    manaValue: card?.cmc,
    colors: card?.colors,
    colorIdentity: card?.color_identity,
    typeLine: hasFaces ? undefined : card?.type_line,
    oracleText: hasFaces ? undefined : card?.oracle_text,
    power: card?.power,
    toughness: card?.toughness,
    loyalty: card?.loyalty,
    defense: card?.defense,
    keywords: card?.keywords,
    producedMana: card?.produced_mana,
    faces,
  });
}

function compactDeckSeedEntries(deck) {
  return deck.entries
    .map((entry) => {
      const typeLine = compactEntryTypeLine(entry);
      const oracleText = truncateSeedText(compactEntryOracleText(entry), 320);
      return compactObject({
        id: entry.id,
        name: entry.name,
        quantity: entry.quantity,
        isCommander: entry.id === deck.commanderId || undefined,
        manaValue: entry.manaValue,
        typeLine,
        oracleText,
        keywords: entry.keywords?.slice(0, 8),
        producedMana: entry.producedMana,
      });
    })
    .filter((entry) => entry.isCommander || !String(entry.typeLine ?? "").toLowerCase().includes("basic land") || Boolean(entry.oracleText))
    .slice(0, 110);
}

function compactCardGraphPool(deck, selectedCard) {
  return deck.entries
    .filter((entry) => entry.id !== selectedCard?.id)
    .filter((entry) => !isBasicLandPoolEntry(entry))
    .map(compactCardGraphPoolEntry);
}

function compactCardGraphPoolEntry(entry) {
  return compactObject({
    id: entry.id,
    name: entry.name,
    quantity: entry.quantity,
    isCommander: entry.isCommander || undefined,
    manaValue: entry.manaValue,
    typeLine: compactEntryTypeLine(entry),
    oracleText: truncateSeedText(compactEntryOracleText(entry), 360),
    keywords: entry.keywords?.slice(0, 8),
    producedMana: entry.producedMana,
  });
}

function isBasicLandPoolEntry(entry) {
  const typeLine = String(compactEntryTypeLine(entry) ?? "").toLowerCase();
  return typeLine.includes("basic") && typeLine.includes("land");
}

function compactEntryTypeLine(entry) {
  if (!entry) return undefined;
  return entry.typeLine ?? entry.faces?.map((face) => face.typeLine).filter(Boolean).join(" // ");
}

function compactEntryOracleText(entry) {
  if (!entry) return undefined;
  return entry.oracleText ?? entry.faces?.map((face) => face.oracleText).filter(Boolean).join(" // ");
}

function truncateSeedText(value, maxLength) {
  if (!value) return undefined;
  const singleLine = String(value).replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 3)}...` : singleLine;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null || item === false || item === "") return false;
      if (Array.isArray(item) && item.length === 0) return false;
      return true;
    }),
  );
}

function compactGraphSummary(graph) {
  if (!graph) return undefined;
  const sourceCounts = new Map();
  const kindCounts = new Map();
  (graph.edges ?? []).forEach((edge) => {
    sourceCounts.set(edge.source, (sourceCounts.get(edge.source) ?? 0) + 1);
    kindCounts.set(edge.kind, (kindCounts.get(edge.kind) ?? 0) + 1);
  });
  return {
    deckId: graph.deckId,
    variant: graph.variant,
    nodeCount: graph.nodes?.length ?? 0,
    edgeCount: graph.edges?.length ?? 0,
    edgeSourceCounts: Object.fromEntries(sourceCounts),
    edgeKindCounts: Object.fromEntries(kindCounts),
  };
}

function compactGraph(graph) {
  if (!graph) return undefined;
  return {
    deckId: graph.deckId,
    variant: graph.variant,
    nodes: (graph.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      summary: node.summary,
      cardId: node.cardId,
      cardIds: node.cardIds,
    })),
    edges: (graph.edges ?? []).map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      kind: edge.kind,
      source: edge.source,
      strength: edge.strength,
      evidence: edge.evidence,
      cardIds: edge.cardIds,
      generatedByFunctionId: edge.generatedByFunctionId,
      connectionGroup: edge.connectionGroup,
      ownerCardId: edge.ownerCardId,
      ownerPatchId: edge.ownerPatchId,
    })),
  };
}

function compactGraphNodeMap(graph) {
  if (!graph) return undefined;
  return {
    deckId: graph.deckId,
    nodes: (graph.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      cardId: node.cardId,
    })),
  };
}

function compactRelatedGraphContext(graph, cardId) {
  if (!graph || !cardId) return undefined;
  const selectedNodeId = `card:${cardId}`;
  const nodesById = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  const relatedEdges = (graph.edges ?? [])
    .filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId || edge.cardIds?.includes(cardId))
    .slice(0, 36);
  const relatedNodeIds = new Set([selectedNodeId]);
  relatedEdges.forEach((edge) => {
    relatedNodeIds.add(edge.sourceId);
    relatedNodeIds.add(edge.targetId);
  });
  const compactEdge = (edge) => ({
    id: edge.id,
    sourceId: edge.sourceId,
    sourceLabel: nodesById.get(edge.sourceId)?.label,
    targetId: edge.targetId,
    targetLabel: nodesById.get(edge.targetId)?.label,
    kind: edge.kind,
    source: edge.source,
    strength: edge.strength,
    evidence: edge.evidence,
    cardIds: edge.cardIds?.slice(0, 8),
    generatedByFunctionId: edge.generatedByFunctionId,
    connectionGroup: edge.connectionGroup,
    ownerCardId: edge.ownerCardId,
    ownerPatchId: edge.ownerPatchId,
  });
  const compactNode = (node) =>
    node
      ? {
          id: node.id,
          kind: node.kind,
          label: node.label,
          summary: node.summary,
          cardId: node.cardId,
          cardIds: node.cardIds?.slice(0, 8),
        }
      : undefined;
  return {
    selectedNodeId,
    selectedNode: compactNode(nodesById.get(selectedNodeId)),
    connectedNodes: Array.from(relatedNodeIds)
      .filter((nodeId) => nodeId !== selectedNodeId)
      .map((nodeId) => nodesById.get(nodeId))
      .map(compactNode)
      .filter(Boolean)
      .slice(0, 32),
    incomingEdges: relatedEdges.filter((edge) => edge.targetId === selectedNodeId).map(compactEdge),
    outgoingEdges: relatedEdges.filter((edge) => edge.sourceId === selectedNodeId).map(compactEdge),
    otherRelatedEdges: relatedEdges.filter((edge) => edge.sourceId !== selectedNodeId && edge.targetId !== selectedNodeId).map(compactEdge),
  };
}

function parseCodexJson(raw) {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("Codex runner did not return valid JSON.");
  }
}

function normalizeAnalysisResult(result) {
  return {
    ...result,
    source: "codex-local",
    createdAt: result.createdAt ?? new Date().toISOString(),
    layout: normalizeLayoutNode(result.layout),
  };
}

function makeGraphPatchUsage(promptUsage, rawOutput, reportedUsage) {
  const outputChars = rawOutput.length;
  const outputTokensEstimate = estimateTokens(rawOutput);
  return {
    promptChars: promptUsage.promptChars,
    contextFileChars: promptUsage.contextFileChars,
    outputChars,
    promptTokensEstimate: promptUsage.promptTokensEstimate,
    contextFileTokensEstimate: promptUsage.contextFileTokensEstimate,
    outputTokensEstimate,
    totalTokensEstimate: promptUsage.promptTokensEstimate + promptUsage.contextFileTokensEstimate + outputTokensEstimate,
    ...reportedUsage,
    note: reportedUsage.reportedTotalTokens
      ? "Reported token usage was parsed from the Codex runner output."
      : "Estimated locally as characters / 4 because the Codex runner did not return structured token usage.",
  };
}

function parseReportedTokenUsage(output) {
  const inputMatch = output.match(/(?:input|prompt)\s+tokens?\D+([\d,]+)/i);
  const outputMatch = output.match(/(?:output|completion)\s+tokens?\D+([\d,]+)/i);
  const totalMatch = output.match(/(?:total)\s+tokens?\D+([\d,]+)/i);
  return compactObject({
    reportedInputTokens: parseTokenNumber(inputMatch?.[1]),
    reportedOutputTokens: parseTokenNumber(outputMatch?.[1]),
    reportedTotalTokens: parseTokenNumber(totalMatch?.[1]),
  });
}

function parseTokenNumber(value) {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeGraphPatch(result, input, usage) {
  const now = new Date().toISOString();
  const deckId = input?.deck?.id ?? result.deckId;
  const cardId = input?.cardId ?? result.cardId;
  return {
    id: result.id ?? `patch_${cardId ?? deckId}_${Date.now()}`,
    deckId,
    ...(cardId ? { cardId } : {}),
    nodesToUpsert: (result.nodesToUpsert ?? []).map((node) => ({
      ...node,
      weight: Number(node.weight ?? 5),
    })),
    edgesToUpsert: (result.edgesToUpsert ?? []).map((edge) =>
      normalizeEdgeId({
        ...edge,
        source: "ai-enriched",
        strength: clampPatchStrength(edge.strength),
      }),
    ),
    edgeFunctions: (result.edgeFunctions ?? []).map((edgeFunction) => ({
      ...edgeFunction,
      strength: clampPatchStrength(edgeFunction.strength),
    })),
    edgeIdsToRemove: result.edgeIdsToRemove ?? [],
    usage: result.usage ?? usage,
    notes: result.notes ?? [],
    generatedAt: result.generatedAt ?? now,
    source: "ai",
  };
}

function clampPatchStrength(value) {
  const numeric = Number(value);
  if (numeric <= 1) return 1;
  if (numeric >= 5) return 5;
  return Math.round(numeric);
}

function normalizeEdgeId(edge) {
  const baseId = makeEdgeId(edge.sourceId, edge.targetId, edge.kind);
  if (edge.id !== baseId) return edge;
  const discriminator = edge.connectionGroup ?? edge.generatedByFunctionId;
  return discriminator ? { ...edge, id: makeEdgeId(edge.sourceId, edge.targetId, edge.kind, discriminator) } : edge;
}

function makeEdgeId(sourceId, targetId, kind, relationship) {
  const relationshipSlug = relationship ? slugifyEdgeRelationship(relationship) : "";
  return `${sourceId}->${targetId}:${kind}${relationshipSlug ? `:${relationshipSlug}` : ""}`;
}

function slugifyEdgeRelationship(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeLayoutNode(node) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "stack") {
    return { ...node, children: (node.children ?? []).map(normalizeLayoutNode) };
  }
  if (node.type === "twoColumn") {
    return {
      ...node,
      left: (node.left ?? []).map(normalizeLayoutNode),
      right: (node.right ?? []).map(normalizeLayoutNode),
    };
  }
  if (node.type === "tabs") {
    return {
      ...node,
      tabs: (node.tabs ?? []).map((tab) => ({
        ...tab,
        children: (tab.children ?? []).map(normalizeLayoutNode),
      })),
    };
  }
  if (node.type === "GroupedCardList") {
    return {
      ...node,
      groups: (node.groups ?? []).map((group) => ({
        type: "CardList",
        ...group,
      })),
    };
  }
  return node;
}

function runCommand(command, args, stdin, timeoutMs, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex runner timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Codex runner exited with ${code}. ${stderr.trim()}`));
    });
    child.stdin.end(stdin);
  });
}

function makeDeckAnalysis(deck) {
  const commander = deck.entries.find((entry) => entry.id === deck.commanderId);
  const landQuery = { typeLineIncludes: "Land" };
  const creatureQuery = { typeLineIncludes: "Creature" };
  const artifactQuery = { typeLineIncludes: "Artifact" };
  const graveyardQuery = { oracleTextIncludes: "graveyard" };
  const tokenQuery = { oracleTextIncludes: "token" };

  return {
    id: makeId("local_deck"),
    kind: "deck-overview",
    title: `${deck.name} Local Analysis`,
    summary: commander
      ? `${commander.name} is the commander. This local scaffold is returning validated, contract-shaped analysis.`
      : "This local scaffold is returning validated, contract-shaped analysis.",
    layout: {
      type: "stack",
      children: [
        {
          type: "NarrativePanel",
          title: "Local Endpoint Scaffold",
          body:
            "This response came from the local analysis endpoint. The next step is to replace this stub with a Codex-powered runner that reasons about synergy and returns the same JSON contract.",
        },
        {
          type: "StatBlock",
          stats: [
            { label: "Creatures", query: creatureQuery },
            { label: "Lands", query: landQuery },
            { label: "Artifacts", query: artifactQuery },
            { label: "Graveyard Text", query: graveyardQuery },
            { label: "Token Text", query: tokenQuery },
          ],
        },
        {
          type: "GroupedCardList",
          groups: [
            { type: "CardList", title: "Creature Package", query: creatureQuery },
            { type: "CardList", title: "Graveyard Signals", query: graveyardQuery, emptyText: "No graveyard text found." },
            { type: "CardList", title: "Token Signals", query: tokenQuery, emptyText: "No token text found." },
          ],
        },
        { type: "ManaCurveChart", title: "Mana Curve" },
        { type: "EvidenceList", title: "Evidence" },
      ],
    },
    evidence: [
      ...(commander ? [{ claim: `${commander.name} is saved as the commander.`, cardIds: [commander.id] }] : []),
      { claim: "Creature, land, artifact, graveyard, and token sections are backed by app-side queries.", note: "Local endpoint scaffold." },
    ],
    createdAt: new Date().toISOString(),
    source: "codex-local",
  };
}

function makeCardAnalysis(deck, card) {
  const text = cardText(card);
  const supportQueries = [];
  if (text.includes("graveyard")) supportQueries.push({ title: "Graveyard Support", query: { oracleTextIncludes: "graveyard" } });
  if (text.includes("artifact")) supportQueries.push({ title: "Artifact Support", query: { typeLineIncludes: "Artifact" } });
  if (text.includes("token")) supportQueries.push({ title: "Token Support", query: { oracleTextIncludes: "token" } });
  if (text.includes("draw")) supportQueries.push({ title: "Draw Support", query: { oracleTextIncludes: "draw" } });
  if (text.includes("land")) supportQueries.push({ title: "Land Text", query: { oracleTextIncludes: "land" } });

  const groups = supportQueries.length
    ? supportQueries.map((item) => ({ type: "CardList", title: item.title, query: item.query }))
    : [{ type: "CardList", title: "Same Card Type", query: { typeLineIncludes: firstType(card) } }];

  return {
    id: makeId("local_card"),
    kind: "card-analysis",
    subjectCardId: card.id,
    title: card.name,
    summary: `${card.name} was analyzed by the local endpoint scaffold.`,
    layout: {
      type: "stack",
      children: [
        { type: "CardDescription", cardId: card.id },
        {
          type: "NarrativePanel",
          title: "What This Card Does Here",
          body:
            "This is a local endpoint scaffold response. A Codex-powered runner will replace this with synergy reasoning while keeping the same structured component contract.",
        },
        { type: "GroupedCardList", groups },
        { type: "EvidenceList", title: "Evidence" },
      ],
    },
    evidence: [
      { claim: "The selected card is the basis for this analysis.", cardIds: [card.id] },
      ...supportQueries.map((item) => ({ claim: `${item.title} is query-backed.`, query: item.query })),
    ],
    createdAt: new Date().toISOString(),
    source: "codex-local",
  };
}

function makeQuestionAnalysis(deck, question) {
  return {
    id: makeId("local_question"),
    kind: "freeform",
    title: "Local Endpoint Question",
    summary: question,
    layout: {
      type: "stack",
      children: [
        {
          type: "NarrativePanel",
          title: "Question Endpoint Ready",
          body: "The local endpoint received the question. Freeform reasoning can be wired to the Codex runner later.",
        },
        { type: "EvidenceList", title: "Evidence" },
      ],
    },
    evidence: [{ claim: `The deck snapshot included ${deck.entries.length} unique entries.` }],
    createdAt: new Date().toISOString(),
    source: "codex-local",
  };
}

function makeQuestionFallbackAnalysis(deck, question, raw, parseError) {
  const answerBody = extractFallbackAnswerBody(raw);
  const parseMessage = parseError instanceof Error ? parseError.message : "The response was not valid JSON.";
  return {
    id: makeId("local_question_fallback"),
    kind: "freeform",
    title: "AI Answer",
    summary: question,
    layout: {
      type: "stack",
      children: [
        {
          type: "NarrativePanel",
          title: "Answer",
          body:
            answerBody ||
            `The AI returned malformed structured JSON, so the app could not render cards or charts from it. Raw response excerpt: ${trimForPanel(stripCodeFence(raw), 1800)}`,
        },
        { type: "EvidenceList", title: "Evidence" },
      ],
    },
    evidence: [
      {
        claim: "The app recovered from a malformed structured AI response and displayed a transient text answer instead.",
        note: parseMessage,
      },
      { claim: `The deck snapshot included ${deck.entries.length} unique entries.` },
    ],
    createdAt: new Date().toISOString(),
    source: "codex-local",
  };
}

function extractFallbackAnswerBody(raw) {
  const text = stripCodeFence(raw);
  const bodyMatch = text.match(/"body"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (bodyMatch?.[1]) return decodeJsonString(bodyMatch[1]);
  const summaryMatch = text.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (summaryMatch?.[1]) return decodeJsonString(summaryMatch[1]);
  if (!text.trim().startsWith("{")) return trimForPanel(text, 2400);
  return undefined;
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
}

function stripCodeFence(value) {
  return String(value ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function trimForPanel(value, maxLength) {
  const text = String(value ?? "").replace(/\s+\n/g, "\n").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function makeDeckGraphPatch(deck, graph, prompt) {
  const now = Date.now();
  const customPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const groups = [
    {
      id: "token-bodies-as-fuel",
      kind: "strategy",
      label: "Token Bodies as Fuel",
      summary: "Cards that create or use tokens as material for the deck's engine.",
      selector: { attributes: [{ path: "card.oracle_text_all", op: "contains", value: "token" }] },
      test: (entry) => cardText(entry).includes("token"),
    },
    {
      id: "death-and-sacrifice-engine",
      kind: "package",
      label: "Death and Sacrifice Engine",
      summary: "Cards that sacrifice permanents, care about dying, or convert deaths into value.",
      selector: { attributes: [{ path: "card.oracle_text_all", op: "contains", value: "sacrifice" }] },
      test: (entry) => cardText(entry).includes("sacrifice") || cardText(entry).includes(" dies") || cardText(entry).includes("creature dies"),
    },
    {
      id: "graveyard-as-resource",
      kind: "resource",
      label: "Graveyard as Resource",
      summary: "Cards that stock, reuse, or care about graveyards.",
      selector: { attributes: [{ path: "card.oracle_text_all", op: "contains", value: "graveyard" }] },
      test: (entry) => cardText(entry).includes("graveyard") || cardText(entry).includes("mill ") || cardText(entry).includes("return target"),
    },
    {
      id: "card-flow",
      kind: "package",
      label: "Card Flow",
      summary: "Cards that draw, filter, investigate, recur, or otherwise keep resources moving.",
      selector: { attributes: [{ path: "card.oracle_text_all", op: "contains", value: "draw " }] },
      test: (entry) => cardText(entry).includes("draw ") || cardText(entry).includes("investigate") || cardText(entry).includes("scry ") || cardText(entry).includes("surveil"),
    },
    {
      id: "protection-and-resilience",
      kind: "package",
      label: "Protection and Resilience",
      summary: "Cards that keep important permanents alive or blunt removal.",
      selector: { attributes: [{ path: "card.oracle_text_all", op: "contains", value: "indestructible" }] },
      test: (entry) => {
        const text = cardText(entry);
        return text.includes("hexproof") || text.includes("indestructible") || text.includes("protection from") || text.includes("phase out");
      },
    },
  ]
    .map((group) => ({ ...group, cards: deck.entries.filter(group.test) }))
    .filter((group) => group.cards.length >= 2);

  const nodesToUpsert = groups.map((group) => ({
    id: `ai:deck:${group.id}`,
    kind: group.kind,
    label: group.label,
    summary: group.summary,
    cardIds: group.cards.map((entry) => entry.id),
    weight: Math.min(10, Math.max(4, group.cards.length)),
  }));

  const edgeFunctions = groups.map((group) => ({
    id: `fn:deck:${group.id}`,
    targetId: `ai:deck:${group.id}`,
    kind: "belongs_to",
    sourceSelector: group.selector,
    customMessage: `This card belongs in the deck-level "${group.label}" connection group.`,
    strength: clampPatchStrength(group.cards.length >= 8 ? 4 : 3),
    connectionGroup: group.label,
  }));

  return {
    id: `patch_${deck.id}_deck_${now}`,
    deckId: deck.id,
    nodesToUpsert,
    edgesToUpsert: [],
    edgeFunctions,
    edgeIdsToRemove: [],
    notes: [
      "This deck-level graph patch came from the local endpoint scaffold. Start the server with MTG_ANALYSIS_RUNNER=codex for actual model-generated connection groups.",
      ...groups.map((group) => `${group.label}: ${group.cards.length} card${group.cards.length === 1 ? "" : "s"} found.`),
      ...(customPrompt ? [`Custom prompt considered: ${customPrompt}`] : []),
    ],
    generatedAt: new Date().toISOString(),
    source: "ai",
  };
}

function makeCardGraphPatch(deck, cardId, graph, prompt) {
  const card = deck.entries.find((entry) => entry.id === cardId);
  if (!card) throw new Error("Card id was not found in deck snapshot.");
  const text = cardText(card);
  const edgesToUpsert = [];
  const nodesToUpsert = [];
  const edgeFunctions = [];
  const sourceId = `card:${cardId}`;
  const now = Date.now();
  const customPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const relatedCards = deck.entries
    .filter((entry) => entry.id !== cardId)
    .filter((entry) => hasSpecificScaffoldConnection(card, entry))
    .slice(0, 8);

  relatedCards.forEach((entry) => {
    const kind = chooseScaffoldEdgeKind(text, cardText(entry));
    edgesToUpsert.push({
      id: `${sourceId}->card:${entry.id}:${kind}`,
      sourceId,
      targetId: `card:${entry.id}`,
      kind,
      source: "ai-enriched",
      strength: 3,
      evidence: describeScaffoldConnection(card, entry),
      cardIds: [cardId, entry.id],
    });
  });

  if (customPrompt) {
    nodesToUpsert.push({
      id: `ai:${cardId}:custom-prompt`,
      kind: "strategy",
      label: "Custom Prompt Group",
      summary: `User-requested grouping for ${card.name}: ${customPrompt}`,
      cardIds: [cardId],
      weight: 6,
    });
    edgesToUpsert.push({
      id: `${sourceId}->ai:${cardId}:custom-prompt:supports`,
      sourceId,
      targetId: `ai:${cardId}:custom-prompt`,
      kind: "supports",
      source: "ai-enriched",
      strength: 4,
      evidence: `${card.name} was reanalyzed with this custom prompt: ${customPrompt}`,
      cardIds: [cardId],
    });
  }

  if (text.includes("token")) {
    nodesToUpsert.push({
      id: `ai:${cardId}:token-context`,
      kind: "strategy",
      label: "Token Context",
      summary: `${card.name} was identified as token-relevant by the local endpoint scaffold.`,
      cardIds: [cardId],
      weight: 5,
    });
    edgesToUpsert.push({
      id: `${sourceId}->ai:${cardId}:token-context:supports`,
      sourceId,
      targetId: `ai:${cardId}:token-context`,
      kind: "supports",
      source: "ai-enriched",
      strength: 4,
      evidence: `${card.name} contains token text.`,
      cardIds: [cardId],
    });
  }

  if (text.includes("artifact") && text.includes("graveyard")) {
    edgeFunctions.push({
      id: `fn:${cardId}:artifact-graveyard`,
      sourceId,
      kind: "enables",
      selector: { attributes: [{ path: "card.type_line_all", op: "contains", value: "Artifact" }] },
      customMessage: `${card.name} specifically references artifact cards in the graveyard.`,
      strength: 5,
    });
  }

  if (text.includes("whenever you cast a noncreature spell")) {
    edgeFunctions.push({
      id: `fn:${cardId}:noncreature-spells`,
      sourceId,
      kind: "pays_off",
      selector: {
        attributes: [
          { path: "card.is_nonland", op: "equals", value: true },
          { path: "card.type_line_all", op: "notContains", value: "Creature" },
        ],
      },
      customMessage: `${card.name} rewards casting this noncreature spell.`,
      strength: 5,
    });
  }

  if (text.includes("four or more wizards") || (text.includes("wizard") && text.includes("transform"))) {
    edgeFunctions.push({
      id: `fn:${cardId}:wizard-threshold`,
      targetId: sourceId,
      kind: "enables",
      sourceSelector: { attributes: [{ path: "card.type_line_all", op: "contains", value: "Wizard" }] },
      customMessage: `This Wizard helps ${card.name} reach its Wizard threshold.`,
      strength: 4,
    });
  }

  return {
    id: `patch_${cardId}_${now}`,
    deckId: deck.id,
    cardId,
    nodesToUpsert,
    edgesToUpsert,
    edgeFunctions,
    edgeIdsToRemove: [],
    notes: [
      "This graph patch came from the local endpoint scaffold. Start the server with MTG_ANALYSIS_RUNNER=codex for actual model-generated graph patches.",
      ...(customPrompt ? [`Custom prompt considered: ${customPrompt}`] : []),
    ],
    generatedAt: new Date().toISOString(),
    source: "ai",
  };
}

function hasSpecificScaffoldConnection(sourceCard, targetCard) {
  const sourceText = cardText(sourceCard);
  const targetText = cardText(targetCard);
  const targetType = targetCard?.scryfall?.type_line?.toLowerCase() ?? "";
  if (sourceText.includes("artifact") && sourceText.includes("graveyard") && targetType.includes("artifact")) return true;
  if (sourceText.includes("creature") && sourceText.includes("graveyard") && targetType.includes("creature")) return true;
  if (sourceText.includes("token") && (targetText.includes("sacrifice") || targetText.includes(" dies") || targetText.includes("whenever a creature dies"))) return true;
  if (sourceText.includes("sacrifice") && (targetText.includes(" dies") || targetText.includes("graveyard"))) return true;
  if ((sourceText.includes("hexproof") || sourceText.includes("indestructible") || sourceText.includes("protection from")) && isLikelyKeyPermanent(targetCard)) return true;
  if ((sourceText.includes("destroy target") || sourceText.includes("exile target") || sourceText.includes("counter target")) && targetCard.id !== sourceCard.id) return true;
  return false;
}

function describeScaffoldConnection(sourceCard, targetCard) {
  const sourceText = cardText(sourceCard);
  const targetType = targetCard?.scryfall?.type_line?.toLowerCase() ?? "";
  if (sourceText.includes("artifact") && sourceText.includes("graveyard") && targetType.includes("artifact")) {
    return `${sourceCard.name} can interact with ${targetCard.name} because it specifically references artifact cards in the graveyard.`;
  }
  if (sourceText.includes("creature") && sourceText.includes("graveyard") && targetType.includes("creature")) {
    return `${sourceCard.name} can interact with ${targetCard.name} because it specifically references creature cards in the graveyard.`;
  }
  return `${sourceCard.name} has a specific rules-text interaction with ${targetCard.name}.`;
}

function chooseScaffoldEdgeKind(sourceText, targetText) {
  if (sourceText.includes("protect") || sourceText.includes("hexproof") || sourceText.includes("indestructible")) return "protects";
  if (sourceText.includes("destroy") || sourceText.includes("exile") || sourceText.includes("counter target")) return "answers";
  if (sourceText.includes("token") && (targetText.includes("sacrifice") || targetText.includes("dies"))) return "enables";
  if (sourceText.includes("draw") || sourceText.includes("search your library")) return "supports";
  if (sourceText.includes("whenever") && targetText.includes("token")) return "pays_off";
  return "supports";
}

function isLikelyKeyPermanent(card) {
  const typeLine = card?.scryfall?.type_line?.toLowerCase() ?? "";
  return typeLine.includes("legendary") || typeLine.includes("planeswalker") || card?.scryfall?.cmc >= 5;
}

function firstType(card) {
  const typeLine = card?.scryfall?.type_line ?? "";
  return typeLine.split(" ")[0] || "Creature";
}

function cardText(card) {
  return [
    card.name,
    card?.scryfall?.type_line,
    card?.scryfall?.oracle_text,
    ...(card?.scryfall?.card_faces?.flatMap((face) => [face.type_line, face.oracle_text]) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    request.on("error", reject);
  });
}
