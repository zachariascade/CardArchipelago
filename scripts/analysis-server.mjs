import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.MTG_ANALYSIS_PORT ?? 8787);
const RUNNER = process.env.MTG_ANALYSIS_RUNNER ?? "scaffold";
const CODEX_BIN = process.env.CODEX_BIN ?? "/Applications/Codex.app/Contents/Resources/codex";
const CODEX_TIMEOUT_MS = Number(process.env.MTG_CODEX_TIMEOUT_MS ?? 120_000);
const EDGE_FUNCTION_ATTRIBUTE_REFERENCE = loadEdgeFunctionAttributeReference();

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
  const { action, input } = request ?? {};
  if (!["analyzeDeck", "analyzeCard", "analyzeCardGraph", "answerQuestion"].includes(action)) {
    throw new Error("Invalid action.");
  }

  const deck = input?.deck;
  if (!deck?.entries?.length) {
    throw new Error("Request input must include a deck snapshot.");
  }

  if (RUNNER === "codex") {
    return runCodexExecAnalysis(action, input);
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

async function runCodexExecAnalysis(action, input) {
  const prompt = buildCodexPrompt(action, input);
  if (action === "analyzeCardGraph") {
    console.log(
      `Card graph prompt size for ${input?.cardId ?? "unknown"}: ${prompt.length.toLocaleString()} chars, ~${estimateTokens(prompt).toLocaleString()} tokens.`,
    );
  }
  const workDir = await mkdtemp(join(tmpdir(), "mtg-analysis-"));
  const outputPath = join(workDir, "analysis-result.json");

  try {
    await runCommand(
      CODEX_BIN,
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        outputPath,
        "-",
      ],
      prompt,
      CODEX_TIMEOUT_MS,
    );

    const raw = await readFile(outputPath, "utf8");
    const parsed = parseCodexJson(raw);
    return action === "analyzeCardGraph" ? normalizeGraphPatch(parsed, input) : normalizeAnalysisResult(parsed);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function buildCodexPrompt(action, input) {
  const deck = compactDeck(input.deck);
  const selectedCard = action === "analyzeCard" || action === "analyzeCardGraph" ? deck.entries.find((entry) => entry.id === input.cardId) : undefined;
  if (action === "analyzeCardGraph") {
    return buildCardGraphPatchPrompt(input, deck, selectedCard);
  }
  return `You are an MTG Commander synergy analyst for a local deck explorer app.

Return ONLY a single JSON object. Do not wrap it in markdown. Do not include commentary outside JSON.

Your task is descriptive and evidence-backed:
- Prioritize synergy discovery.
- For deck analysis, explain the broad strategy, commander context, and support packages.
- For card analysis, explain what the selected card does in this deck and what cards support it.
- Do not make keep/cut or upgrade recommendations.
- Use exact card ids from the provided deck.
- Use query-backed components for objective groups.
- Use explicit cardIds for semantic support groups.
- Every nontrivial claim should have evidence.
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
Selected card id: ${input.cardId ?? ""}
Selected card: ${selectedCard ? JSON.stringify(selectedCard) : "none"}
Available query capabilities: ${JSON.stringify(input.availableQueries ?? [])}
Deck snapshot:
${JSON.stringify(deck)}

Return the JSON now.`;
}

function buildCardGraphPatchPrompt(input, deck, selectedCard) {
  const graph = compactGraph(input.graph);
  const relatedGraphContext = compactRelatedGraphContext(graph, input.cardId);
  const graphSummary = compactGraphSummary(graph);
  const customPrompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  return `You are an MTG Commander synergy graph analyst for a local deck explorer app.

Return ONLY a single JSON object. Do not wrap it in markdown. Do not include commentary outside JSON.

Your task: generate a card-level graph patch for the selected card. This patch will be applied on top of an existing deck graph.

Rules:
- Analyze ONLY relationships created by the selected card's rules text and deck role.
- First account for the related graph context and existing graph edges before changing the graph.
- Add edges this selected card meaningfully creates, enables, supports, protects, answers, pays off, depends on, or is weak to; the selected card may be the source or target when directionality requires it.
- Prefer precise card-to-card edges over vague package edges.
- Add concept nodes only when they clarify this card's role.
- Do not generate edges for unrelated cards unless the selected card is source or target.
- Use the related graph context to understand existing incoming/outgoing relationships before adding new ones.
- Do not duplicate an existing related edge unless the new edge has a clearer kind, stronger evidence, or adds a missing directional counterpart.
- Prefer edgeFunctions over enumerating many similar edges when a rule applies to a class of cards.
- Use sourceId + selector when the selected card creates edges to matching cards.
- Use sourceSelector + targetId when matching cards create edges to the selected card.
- Edge kind is a machine-readable semantic hint. It is not the user-facing category. Use connectionGroup as the expressive, user-facing relationship label whenever possible.
- For AI-generated edges and edgeFunctions, set connectionGroup to a concise phrase that describes the actual relationship, not merely the edge kind. Prefer labels like "Doubles Damage", "Reanimation Targets", "Cannot Reanimate", "Cast From Graveyard", "Feeds Sacrifice", "Death Trigger Payoffs", "Protects Commander", or other deck-specific phrases supported by the selected card text.
- Use the fixed kind values as suggestions for graph semantics: "enables" means turns on access/conditions/triggers, "pays_off" means rewards a class/action, "supports" means softer consistency/access, and so on. The visible connection category should usually come from connectionGroup.
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
- Do not use edge source "deterministic".
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
Use "<sourceId>-><targetId>:<kind>".

Edge function id format:
Use "fn:<selectedCardId>:<short-slug>".

Edge function attribute query reference:
${EDGE_FUNCTION_ATTRIBUTE_REFERENCE}

Selected card id: ${input.cardId}
Selected card:
${selectedCard ? JSON.stringify(selectedCard) : "none"}

Related graph context:
${JSON.stringify(relatedGraphContext)}

Custom user prompt:
${customPrompt || "(none)"}

Existing graph summary:
${JSON.stringify(graphSummary)}

Deck card pool:
${JSON.stringify(deck)}

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

function compactDeck(deck) {
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    commanderId: deck.commanderId,
    entries: deck.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      quantity: entry.quantity,
      isCommander: entry.id === deck.commanderId,
      manaCost: entry.scryfall?.mana_cost,
      manaValue: entry.scryfall?.cmc,
      colors: entry.scryfall?.colors,
      colorIdentity: entry.scryfall?.color_identity,
      typeLine: entry.scryfall?.type_line ?? entry.scryfall?.card_faces?.map((face) => face.type_line).filter(Boolean).join(" // "),
      oracleText: [entry.scryfall?.oracle_text, ...(entry.scryfall?.card_faces?.map((face) => face.oracle_text) ?? [])]
        .filter(Boolean)
        .join("\n"),
      keywords: entry.scryfall?.keywords,
      producedMana: entry.scryfall?.produced_mana,
      faces: entry.scryfall?.card_faces?.map((face) => ({
        name: face.name,
        manaCost: face.mana_cost,
        typeLine: face.type_line,
        oracleText: face.oracle_text,
        power: face.power,
        toughness: face.toughness,
        loyalty: face.loyalty,
        defense: face.defense,
      })),
    })),
  };
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
    })),
  };
}

function compactRelatedGraphContext(graph, cardId) {
  if (!graph || !cardId) return undefined;
  const selectedNodeId = `card:${cardId}`;
  const nodesById = new Map((graph.nodes ?? []).map((node) => [node.id, node]));
  const relatedEdges = (graph.edges ?? [])
    .filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId || edge.cardIds?.includes(cardId))
    .slice(0, 80);
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
      .slice(0, 60),
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

function normalizeGraphPatch(result, input) {
  const now = new Date().toISOString();
  const deckId = input?.deck?.id ?? result.deckId;
  const cardId = input?.cardId ?? result.cardId;
  return {
    id: result.id ?? `patch_${cardId}_${Date.now()}`,
    deckId,
    cardId,
    nodesToUpsert: (result.nodesToUpsert ?? []).map((node) => ({
      ...node,
      weight: Number(node.weight ?? 5),
    })),
    edgesToUpsert: (result.edgesToUpsert ?? []).map((edge) => ({
      ...edge,
      source: "ai-enriched",
      strength: clampPatchStrength(edge.strength),
    })),
    edgeFunctions: (result.edgeFunctions ?? []).map((edgeFunction) => ({
      ...edgeFunction,
      strength: clampPatchStrength(edgeFunction.strength),
    })),
    edgeIdsToRemove: result.edgeIdsToRemove ?? [],
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

function runCommand(command, args, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex runner timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
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
