import { DeckEntry, DeckSnapshot, getManaValue, getOracleText, getPrimaryTypeLine } from "./deckModel";

export type DeckGraphNodeKind = "card" | "package" | "strategy" | "resource" | "risk";
export type DeckGraphVariant = "base" | "ai-enriched";
export type DeckGraphEdgeSource = "deterministic" | "ai-enriched";

export type DeckGraphEdgeKind =
  | "supports"
  | "enables"
  | "pays_off"
  | "protects"
  | "answers"
  | "depends_on"
  | "weak_to"
  | "belongs_to";

export type DeckGraphNode = {
  id: string;
  kind: DeckGraphNodeKind;
  label: string;
  summary: string;
  cardId?: string;
  cardIds?: string[];
  weight: number;
};

export type DeckGraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: DeckGraphEdgeKind;
  source: DeckGraphEdgeSource;
  strength: 1 | 2 | 3 | 4 | 5;
  evidence?: string;
  cardIds?: string[];
  generatedByFunctionId?: string;
  connectionGroup?: string;
};

export type GraphCardSelector = {
  attributes?: GraphCardAttributePredicate[];
};

export type GraphCardAttributeOperator =
  | "exists"
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "includes"
  | "notIncludes"
  | ">"
  | ">="
  | "<"
  | "<=";

export type GraphCardAttributeValue = string | number | boolean | string[] | number[];

export type GraphCardAttributePredicate = {
  path: string;
  op: GraphCardAttributeOperator;
  value?: GraphCardAttributeValue;
};

export type GraphEdgeFunction = {
  id: string;
  sourceId?: string;
  targetId?: string;
  kind: DeckGraphEdgeKind;
  selector?: GraphCardSelector;
  sourceSelector?: GraphCardSelector;
  customMessage: string;
  strength: 1 | 2 | 3 | 4 | 5;
  connectionGroup?: string;
};

export type DeckGraph = {
  deckId: string;
  variant: DeckGraphVariant;
  generatedAt: string;
  procedureSummary: string;
  nodes: DeckGraphNode[];
  edges: DeckGraphEdge[];
};

export type DeckGraphPatch = {
  id: string;
  deckId: string;
  cardId: string;
  nodesToUpsert: DeckGraphNode[];
  edgesToUpsert: DeckGraphEdge[];
  edgeFunctions?: GraphEdgeFunction[];
  edgeIdsToRemove?: string[];
  notes: string[];
  generatedAt: string;
  source: "ai";
};

type GraphRule = {
  id: string;
  kind: Extract<DeckGraphNodeKind, "package" | "strategy" | "resource" | "risk">;
  label: string;
  summary: string;
  test: (entry: DeckEntry) => boolean;
};

type RuleMatch = GraphRule & {
  cardIds: string[];
  count: number;
};

type EnrichedRole = {
  id: string;
  kind: Extract<DeckGraphNodeKind, "package" | "strategy" | "resource" | "risk">;
  label: string;
  summary: string;
  edgeKind: DeckGraphEdgeKind;
  test: (profile: CardProfile) => boolean;
};

type CardProfile = {
  entry: DeckEntry;
  text: string;
  typeLine: string;
  oracle: string;
  manaValue: number;
  isCommander: boolean;
  isCreature: boolean;
  isLand: boolean;
  isPermanent: boolean;
  roles: Set<string>;
};

const PACKAGE_RULES: GraphRule[] = [
  {
    id: "ramp",
    kind: "package",
    label: "Ramp",
    summary: "Cards that accelerate mana or improve land development.",
    test: (entry) => {
      const text = cardText(entry);
      const name = entry.name.toLowerCase();
      if (isLand(entry)) return text.includes("play an additional land");
      return (
        /\badd \{/.test(text) ||
        text.includes("search your library for a basic land") ||
        text.includes("put a land card") ||
        text.includes("play an additional land") ||
        text.includes("treasure token") ||
        name.includes("signet") ||
        name === "sol ring"
      );
    },
  },
  {
    id: "card-draw",
    kind: "package",
    label: "Card Draw",
    summary: "Cards that draw, investigate, impulse, recur, or otherwise improve card flow.",
    test: (entry) => {
      const text = cardText(entry);
      return text.includes("draw ") || text.includes("investigate") || text.includes("return target card") || text.includes("return a card");
    },
  },
  {
    id: "interaction",
    kind: "package",
    label: "Interaction",
    summary: "Cards that answer opposing permanents, spells, or combat states.",
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
    kind: "package",
    label: "Protection",
    summary: "Cards that keep the commander, board, or key spells alive.",
    test: (entry) => {
      const text = cardText(entry);
      return (
        text.includes("hexproof") ||
        text.includes("indestructible") ||
        text.includes("protection from") ||
        text.includes("phase out") ||
        text.includes("regenerate") ||
        text.includes("can't be countered")
      );
    },
  },
  {
    id: "sacrifice",
    kind: "package",
    label: "Sacrifice",
    summary: "Cards that sacrifice permanents or reward sacrifice events.",
    test: (entry) => cardText(entry).includes("sacrifice"),
  },
];

const STRATEGY_RULES: GraphRule[] = [
  {
    id: "tokens",
    kind: "strategy",
    label: "Token Plan",
    summary: "Token makers, token payoffs, and cards that scale with extra bodies.",
    test: (entry) => cardText(entry).includes("token"),
  },
  {
    id: "graveyard",
    kind: "strategy",
    label: "Graveyard Plan",
    summary: "Cards that use graveyards, mill, recursion, or death as a resource.",
    test: (entry) => {
      const text = cardText(entry);
      return text.includes("graveyard") || text.includes("mill ") || text.includes("return target card");
    },
  },
  {
    id: "artifacts",
    kind: "strategy",
    label: "Artifact Plan",
    summary: "Artifact cards and cards that explicitly reward artifacts.",
    test: (entry) => getPrimaryTypeLine(entry).toLowerCase().includes("artifact") || cardText(entry).includes("artifact"),
  },
  {
    id: "spells",
    kind: "strategy",
    label: "Spells Plan",
    summary: "Instants, sorceries, and cards that care about casting noncreature spells.",
    test: (entry) => {
      const typeLine = getPrimaryTypeLine(entry).toLowerCase();
      const text = cardText(entry);
      return typeLine.includes("instant") || typeLine.includes("sorcery") || text.includes("instant or sorcery") || text.includes("noncreature spell");
    },
  },
];

const RESOURCE_RULES: GraphRule[] = [
  {
    id: "treasure",
    kind: "resource",
    label: "Treasures",
    summary: "Cards that make or care about Treasure tokens.",
    test: (entry) => cardText(entry).includes("treasure"),
  },
  {
    id: "life-total",
    kind: "resource",
    label: "Life Total",
    summary: "Cards that gain, pay, drain, or otherwise use life totals.",
    test: (entry) => {
      const text = cardText(entry);
      return text.includes("gain life") || text.includes("lose life") || text.includes("pay ") && text.includes(" life");
    },
  },
  {
    id: "graveyard-resource",
    kind: "resource",
    label: "Graveyard",
    summary: "The graveyard as a card source, setup zone, or cost.",
    test: (entry) => cardText(entry).includes("graveyard") || cardText(entry).includes("mill "),
  },
];

const RISK_RULES: GraphRule[] = [
  {
    id: "board-wipes",
    kind: "risk",
    label: "Board Wipes",
    summary: "Creature-heavy or token-heavy plans can lose tempo to sweepers.",
    test: (entry) => getPrimaryTypeLine(entry).toLowerCase().includes("creature") || cardText(entry).includes("token"),
  },
  {
    id: "graveyard-hate",
    kind: "risk",
    label: "Graveyard Hate",
    summary: "Graveyard-centered cards can be disrupted by exile and replacement effects.",
    test: (entry) => cardText(entry).includes("graveyard") || cardText(entry).includes("mill "),
  },
  {
    id: "commander-dependency",
    kind: "risk",
    label: "Commander Dependency",
    summary: "Cards that echo the commander's text may become weaker when the commander is removed.",
    test: () => false,
  },
];

const ENRICHED_ROLES: EnrichedRole[] = [
  {
    id: "token-producers",
    kind: "package",
    label: "Token Producers",
    summary: "Cards that create creature or artifact tokens as material for the deck plan.",
    edgeKind: "enables",
    test: (profile) => profile.text.includes("create") && profile.text.includes("token"),
  },
  {
    id: "token-payoffs",
    kind: "strategy",
    label: "Token Payoffs",
    summary: "Cards that multiply, reward, or scale with token production.",
    edgeKind: "pays_off",
    test: (profile) =>
      profile.text.includes("tokens you control") ||
      profile.text.includes("twice that many") ||
      profile.text.includes("for each creature") ||
      profile.text.includes("creatures you control get"),
  },
  {
    id: "sacrifice-outlets",
    kind: "package",
    label: "Sacrifice Outlets",
    summary: "Cards that let the pilot sacrifice permanents on demand.",
    edgeKind: "enables",
    test: (profile) => /sacrifice (a|another|any number of|x) /.test(profile.text) || profile.text.includes("sacrifice a creature:"),
  },
  {
    id: "death-payoffs",
    kind: "strategy",
    label: "Death Payoffs",
    summary: "Cards that reward creatures dying or leaving the battlefield.",
    edgeKind: "pays_off",
    test: (profile) =>
      profile.text.includes("whenever") &&
      (profile.text.includes(" dies") || profile.text.includes("creature dies") || profile.text.includes("is put into a graveyard")),
  },
  {
    id: "recursion",
    kind: "package",
    label: "Recursion",
    summary: "Cards that return cards from graveyards to hand, battlefield, or library.",
    edgeKind: "supports",
    test: (profile) =>
      profile.text.includes("return target card") ||
      profile.text.includes("return target creature") ||
      profile.text.includes("from your graveyard") ||
      profile.text.includes("from a graveyard") ||
      profile.text.includes("reanimate"),
  },
  {
    id: "graveyard-setup",
    kind: "package",
    label: "Graveyard Setup",
    summary: "Cards that mill, discard, loot, or otherwise stock the graveyard.",
    edgeKind: "enables",
    test: (profile) => profile.text.includes("mill ") || profile.text.includes("discard") || profile.text.includes("surveil"),
  },
  {
    id: "tutors-selection",
    kind: "package",
    label: "Tutors and Selection",
    summary: "Cards that search, filter, scry, surveil, or otherwise find the right piece.",
    edgeKind: "supports",
    test: (profile) =>
      profile.text.includes("search your library") ||
      profile.text.includes("scry ") ||
      profile.text.includes("surveil") ||
      profile.text.includes("look at the top"),
  },
  {
    id: "board-wipes",
    kind: "package",
    label: "Sweepers",
    summary: "Cards that reset multiple creatures or permanents.",
    edgeKind: "answers",
    test: (profile) =>
      profile.text.includes("destroy all") ||
      profile.text.includes("exile all") ||
      profile.text.includes("each creature") ||
      profile.text.includes("all creatures get"),
  },
  {
    id: "finishers",
    kind: "strategy",
    label: "Finishers",
    summary: "Cards that can close the game through damage, drain, combat scaling, or overwhelming resources.",
    edgeKind: "pays_off",
    test: (profile) =>
      profile.manaValue >= 6 ||
      profile.text.includes("you win the game") ||
      profile.text.includes("loses life") ||
      profile.text.includes("double") ||
      profile.text.includes("extra combat"),
  },
  {
    id: "mana-sinks",
    kind: "resource",
    label: "Mana Sinks",
    summary: "Cards that convert excess mana into cards, damage, counters, or board presence.",
    edgeKind: "pays_off",
    test: (profile) => /\{x\}/i.test(profile.oracle) || /\{\d+\}/.test(profile.oracle) || profile.text.includes("activate only") && profile.text.includes(":"),
  },
  {
    id: "commander-support",
    kind: "strategy",
    label: "Commander Support",
    summary: "Cards that share important language with the commander or protect its plan.",
    edgeKind: "supports",
    test: (profile) => profile.roles.has("commander-support"),
  },
  {
    id: "single-point-failure",
    kind: "risk",
    label: "Single Point Failure",
    summary: "Important plans may lean heavily on a small number of payoff cards.",
    edgeKind: "depends_on",
    test: (profile) => profile.roles.has("finishers") || profile.roles.has("death-payoffs") || profile.roles.has("token-payoffs"),
  },
];

export function buildDeckGraph(deck: DeckSnapshot): DeckGraph {
  const nodes: DeckGraphNode[] = deck.entries.map((entry) => ({
    id: cardNodeId(entry.id),
    kind: "card",
    label: entry.name,
    summary: getPrimaryTypeLine(entry) || "Unresolved card",
    cardId: entry.id,
    cardIds: [entry.id],
    weight: entry.id === deck.commanderId ? 8 : Math.max(2, Math.min(5, entry.quantity + 1)),
  }));
  const edges: DeckGraphEdge[] = [];
  const matches = [...PACKAGE_RULES, ...STRATEGY_RULES, ...RESOURCE_RULES, ...RISK_RULES]
    .map((rule) => matchRule(rule, deck))
    .filter((match) => match.count > 0);

  matches.forEach((match) => {
    nodes.push({
      id: conceptNodeId(match.kind, match.id),
      kind: match.kind,
      label: match.label,
      summary: match.summary,
      cardIds: match.cardIds,
      weight: Math.min(10, Math.max(4, match.count)),
    });

    match.cardIds.forEach((cardId) => {
      edges.push({
        id: edgeId(cardNodeId(cardId), conceptNodeId(match.kind, match.id), "belongs_to"),
        sourceId: cardNodeId(cardId),
        targetId: conceptNodeId(match.kind, match.id),
        kind: "belongs_to",
        source: "deterministic",
        strength: strengthFromCount(match.count),
        evidence: `${getCardName(deck, cardId)} maps to ${match.label}.`,
        cardIds: [cardId],
      });
    });
  });

  addCommanderEdges(deck, matches, edges);
  addPackageStrategyEdges(matches, edges);
  addRiskEdges(matches, edges);

  return {
    deckId: deck.id,
    variant: "base",
    generatedAt: new Date().toISOString(),
    procedureSummary: "Base graph generated from direct type-line, Oracle text, commander-language, package, resource, and risk rules.",
    nodes,
    edges: dedupeEdges(edges),
  };
}

export function buildEnrichedDeckGraph(deck: DeckSnapshot): DeckGraph {
  const baseGraph = buildDeckGraph(deck);
  const nodes = [...baseGraph.nodes];
  const edges = [...baseGraph.edges];
  const profiles = createCardProfiles(deck);
  const roleMatches = new Map<string, CardProfile[]>();

  profiles.forEach((profile) => {
    ENRICHED_ROLES.forEach((role) => {
      if (!role.test(profile)) return;
      profile.roles.add(role.id);
      const matches = roleMatches.get(role.id) ?? [];
      matches.push(profile);
      roleMatches.set(role.id, matches);
    });
  });
  addProfileRoleMatches(profiles, roleMatches, ["ramp", "card-draw", "protection"]);

  ENRICHED_ROLES.forEach((role) => {
    const matches = roleMatches.get(role.id) ?? [];
    if (!matches.length) return;
    const nodeId = conceptNodeId(role.kind, `enriched-${role.id}`);
    upsertNode(nodes, {
      id: nodeId,
      kind: role.kind,
      label: role.label,
      summary: role.summary,
      cardIds: matches.map((profile) => profile.entry.id),
      weight: Math.min(12, Math.max(5, matches.reduce((sum, profile) => sum + profile.entry.quantity, 0))),
    });
    matches.forEach((profile) => {
      edges.push({
        id: edgeId(cardNodeId(profile.entry.id), nodeId, role.edgeKind),
        sourceId: cardNodeId(profile.entry.id),
        targetId: nodeId,
        kind: role.edgeKind,
        source: "deterministic",
        strength: strengthFromCount(matches.length),
        evidence: `${profile.entry.name} was classified as ${role.label} during the enriched graph pass.`,
        cardIds: [profile.entry.id],
      });
    });
  });

  addEnrichedCommanderEdges(deck, profiles, edges);
  addEnrichedCardPairEdges(profiles, edges);
  addEnrichedRoleEdges(roleMatches, edges);

  return {
    deckId: deck.id,
    variant: "ai-enriched",
    generatedAt: new Date().toISOString(),
    procedureSummary:
      "Enriched graph starts from the base graph, profiles every card, assigns semantic roles, links cards to role nodes, and adds inferred card-to-card synergy, payoff, protection, and dependency edges.",
    nodes,
    edges: dedupeEdges(edges),
  };
}

export function applyGraphPatches(graph: DeckGraph, patches: DeckGraphPatch[], deck?: DeckSnapshot): DeckGraph {
  if (!patches.length) return graph;
  const nodes = [...graph.nodes];
  const removedEdgeIds = new Set(patches.flatMap((patch) => patch.edgeIdsToRemove ?? []));
  const edges = graph.edges.filter((edge) => !removedEdgeIds.has(edge.id));

  patches.forEach((patch) => {
    patch.nodesToUpsert.forEach((node) => upsertNode(nodes, node));
    patch.edgesToUpsert.forEach((edge) => {
      if (removedEdgeIds.has(edge.id)) return;
      edges.push(edge);
    });
    expandGraphEdgeFunctions(deck, patch).forEach((edge) => {
      if (removedEdgeIds.has(edge.id)) return;
      edges.push(edge);
    });
  });

  return {
    ...graph,
    procedureSummary: `${graph.procedureSummary} Saved card-level AI graph patches are applied on top.`,
    nodes,
    edges: dedupeEdges(edges),
  };
}

export function generateCardGraphPatch(deck: DeckSnapshot, graph: DeckGraph, cardId: string, prompt?: string): DeckGraphPatch {
  const profile = createCardProfiles(deck).find((item) => item.entry.id === cardId);
  if (!profile) {
    throw new Error("Card must be resolved before graph enrichment can analyze it.");
  }
  const allProfiles = createCardProfiles(deck);
  const nodesToUpsert: DeckGraphNode[] = [];
  const edgesToUpsert: DeckGraphEdge[] = [];
  const edgeFunctions: GraphEdgeFunction[] = [];
  const notes: string[] = [];
  const sourceNodeId = cardNodeId(cardId);
  const addNode = (node: DeckGraphNode) => upsertNode(nodesToUpsert, node);
  const addEdge = (target: CardProfile | string, kind: DeckGraphEdgeKind, strength: 1 | 2 | 3 | 4 | 5, evidence: string, targetCardId?: string) => {
    const targetId = typeof target === "string" ? target : cardNodeId(target.entry.id);
    edgesToUpsert.push({
      id: edgeId(sourceNodeId, targetId, kind),
      sourceId: sourceNodeId,
      targetId,
      kind,
      source: "ai-enriched",
      strength,
      evidence,
      cardIds: targetCardId ? [cardId, targetCardId] : [cardId],
    });
  };

  const customPrompt = prompt?.trim();
  if (customPrompt) {
    const promptNodeId = `ai:${cardId}:custom-prompt`;
    addNode({
      id: promptNodeId,
      kind: "strategy",
      label: "Custom Prompt Group",
      summary: `User-requested grouping for ${profile.entry.name}: ${customPrompt}`,
      cardIds: [cardId],
      weight: Math.max(6, profile.entry.quantity + 5),
    });
    addEdge(promptNodeId, "supports", 4, `${profile.entry.name} was reanalyzed with this custom prompt: ${customPrompt}`);
    notes.push(`Custom prompt considered: ${customPrompt}`);
  }

  ENRICHED_ROLES.forEach((role) => {
    if (!role.test(profile)) return;
    const nodeId = conceptNodeId(role.kind, `card-ai-${role.id}`);
    addNode({
      id: nodeId,
      kind: role.kind,
      label: role.label,
      summary: `${role.summary} Added from card-level analysis of ${profile.entry.name}.`,
      cardIds: [cardId],
      weight: Math.max(5, profile.entry.quantity + 4),
    });
    addEdge(nodeId, role.edgeKind, 4, `${profile.entry.name} directly matches the card-level role "${role.label}".`);
    notes.push(`${profile.entry.name} was assigned to ${role.label}.`);
  });

  const relationships = inferCardPatchRelationships(profile, allProfiles);
  relationships.forEach(({ target, kind, strength, evidence }) => {
    addEdge(target, kind, strength, evidence, target.entry.id);
  });
  notes.push(...relationships.slice(0, 8).map((relationship) => relationship.evidence));

  if (profile.text.includes("whenever you cast a noncreature spell")) {
    edgeFunctions.push({
      id: `fn:${cardId}:noncreature-spells`,
      sourceId: sourceNodeId,
      kind: "pays_off",
      selector: {
        attributes: [
          { path: "card.is_nonland", op: "equals", value: true },
          { path: "card.type_line_all", op: "notContains", value: "Creature" },
        ],
      },
      customMessage: `${profile.entry.name} rewards casting this noncreature spell.`,
      strength: 5,
    });
    notes.push(`${profile.entry.name} pays off noncreature spells through a reusable selector function.`);
  }
  if (profile.text.includes("four or more wizards") || (profile.text.includes("wizard") && profile.text.includes("transform"))) {
    edgeFunctions.push({
      id: `fn:${cardId}:wizard-threshold`,
      targetId: sourceNodeId,
      kind: "enables",
      sourceSelector: { attributes: [{ path: "card.type_line_all", op: "contains", value: "Wizard" }] },
      customMessage: `This Wizard helps ${profile.entry.name} reach its Wizard threshold.`,
      strength: 4,
    });
    notes.push(`${profile.entry.name} can now model Wizard threshold support with selector-to-card edges.`);
  }

  const existingConnections = getConnectedGraphItems(graph, sourceNodeId);
  existingConnections.nodes
    .filter((node) => node.kind !== "card")
    .slice(0, 8)
    .forEach((node) => {
      edgesToUpsert.push({
        id: edgeId(sourceNodeId, node.id, "supports"),
        sourceId: sourceNodeId,
        targetId: node.id,
        kind: "supports",
        source: "ai-enriched",
        strength: 3,
        evidence: `${profile.entry.name} was already near ${node.label}; card-level analysis preserved it as an AI-relevant connection.`,
        cardIds: [cardId],
      });
    });

  return {
    id: `patch_${cardId}_${Date.now()}`,
    deckId: deck.id,
    cardId,
    nodesToUpsert,
    edgesToUpsert: dedupeEdges(edgesToUpsert),
    edgeFunctions,
    notes: notes.length ? notes : [`${profile.entry.name} did not produce additional card-level AI edges from the current heuristics.`],
    generatedAt: new Date().toISOString(),
    source: "ai",
  };
}

export function getConnectedGraphItems(graph: DeckGraph, nodeId: string): { nodes: DeckGraphNode[]; edges: DeckGraphEdge[] } {
  const edges = graph.edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
  const ids = new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]).filter((id) => id !== nodeId));
  return {
    nodes: graph.nodes.filter((node) => ids.has(node.id)),
    edges,
  };
}

export function describeGraphNode(node: DeckGraphNode, graph: DeckGraph): string {
  const connected = getConnectedGraphItems(graph, node.id);
  const connectionText = connected.nodes.length
    ? `Connected to ${connected.nodes.slice(0, 5).map((item) => item.label).join(", ")}${connected.nodes.length > 5 ? " and more" : ""}.`
    : "No graph connections are currently visible.";
  return `${node.summary} ${connectionText}`;
}

function createCardProfiles(deck: DeckSnapshot): CardProfile[] {
  const commander = deck.entries.find((entry) => entry.id === deck.commanderId);
  return deck.entries
    .filter((entry) => !entry.unresolved)
    .map((entry) => {
      const typeLine = getPrimaryTypeLine(entry).toLowerCase();
      const oracle = getOracleText(entry);
      const text = `${entry.name} ${typeLine} ${oracle}`.toLowerCase();
      const roles = new Set<string>();
      if (commander && entry.id !== commander.id && sharesRelevantLanguage(entry, commander)) roles.add("commander-support");
      addBaseProfileRoles(entry, text, typeLine, roles);
      return {
        entry,
        text,
        typeLine,
        oracle,
        manaValue: getManaValue(entry),
        isCommander: entry.id === deck.commanderId,
        isCreature: typeLine.includes("creature"),
        isLand: typeLine.includes("land"),
        isPermanent: !typeLine.includes("instant") && !typeLine.includes("sorcery"),
        roles,
      };
    });
}

function addBaseProfileRoles(entry: DeckEntry, text: string, typeLine: string, roles: Set<string>): void {
  if (isLand(entry)) return;
  const name = entry.name.toLowerCase();
  if (/\badd \{/.test(text) || text.includes("search your library for a basic land") || text.includes("treasure token") || name.includes("signet") || name === "sol ring") {
    roles.add("ramp");
  }
  if (text.includes("draw ") || text.includes("investigate") || text.includes("return target card") || text.includes("return a card")) {
    roles.add("card-draw");
  }
  if (text.includes("hexproof") || text.includes("indestructible") || text.includes("protection from") || text.includes("phase out") || text.includes("can't be countered")) {
    roles.add("protection");
  }
  if (typeLine.includes("instant") || typeLine.includes("sorcery")) roles.add("spell");
}

function expandGraphEdgeFunctions(deck: DeckSnapshot | undefined, patch: DeckGraphPatch): DeckGraphEdge[] {
  if (!deck || !patch.edgeFunctions?.length) return [];
  const entriesByNodeId = new Map(deck.entries.map((entry) => [cardNodeId(entry.id), entry]));
  return patch.edgeFunctions.flatMap((edgeFunction) => {
    const targetSelector = edgeFunction.selector;
    const sourceSelector = edgeFunction.sourceSelector;
    if (edgeFunction.sourceId && targetSelector) {
      const sourceEntry = entriesByNodeId.get(edgeFunction.sourceId);
      return deck.entries
        .filter((entry) => cardNodeId(entry.id) !== edgeFunction.sourceId)
        .filter((entry) => matchesGraphCardSelector(deck, entry, targetSelector))
        .map((entry) => makeExpandedFunctionEdge(edgeFunction, edgeFunction.sourceId!, cardNodeId(entry.id), [sourceEntry?.id, entry.id]));
    }

    if (edgeFunction.targetId && sourceSelector) {
      const targetEntry = entriesByNodeId.get(edgeFunction.targetId);
      return deck.entries
        .filter((entry) => cardNodeId(entry.id) !== edgeFunction.targetId)
        .filter((entry) => matchesGraphCardSelector(deck, entry, sourceSelector))
        .map((entry) => makeExpandedFunctionEdge(edgeFunction, cardNodeId(entry.id), edgeFunction.targetId!, [entry.id, targetEntry?.id]));
    }

    return [];
  });
}

function makeExpandedFunctionEdge(edgeFunction: GraphEdgeFunction, sourceId: string, targetId: string, cardIds: (string | undefined)[]): DeckGraphEdge {
  return {
    id: edgeId(sourceId, targetId, edgeFunction.kind),
    sourceId,
    targetId,
    kind: edgeFunction.kind,
    source: "ai-enriched",
    strength: edgeFunction.strength,
    evidence: edgeFunction.customMessage,
    cardIds: cardIds.filter((cardId): cardId is string => Boolean(cardId)),
    generatedByFunctionId: edgeFunction.id,
    connectionGroup: edgeFunction.connectionGroup,
  };
}

function matchesGraphCardSelector(deck: DeckSnapshot, entry: DeckEntry, selector: GraphCardSelector): boolean {
  if (selector.attributes?.some((predicate) => !matchesGraphCardAttributePredicate(deck, entry, predicate))) return false;
  return true;
}

function matchesGraphCardAttributePredicate(deck: DeckSnapshot, entry: DeckEntry, predicate: GraphCardAttributePredicate): boolean {
  const values = getGraphCardAttributeValues(deck, entry, predicate.path);
  const comparisonValues = Array.isArray(predicate.value) ? predicate.value : predicate.value === undefined ? [] : [predicate.value];

  switch (predicate.op) {
    case "exists":
      return values.some((value) => value !== undefined && value !== null && value !== "");
    case "equals":
      return values.some((value) => comparisonValues.some((comparisonValue) => attributeValuesEqual(value, comparisonValue)));
    case "notEquals":
      return !values.some((value) => comparisonValues.some((comparisonValue) => attributeValuesEqual(value, comparisonValue)));
    case "contains":
      return values.some((value) => comparisonValues.some((comparisonValue) => attributeValueContains(value, comparisonValue)));
    case "notContains":
      return !values.some((value) => comparisonValues.some((comparisonValue) => attributeValueContains(value, comparisonValue)));
    case "includes":
      return comparisonValues.every((comparisonValue) => values.some((value) => attributeValueIncludes(value, comparisonValue)));
    case "notIncludes":
      return !comparisonValues.some((comparisonValue) => values.some((value) => attributeValueIncludes(value, comparisonValue)));
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const op = predicate.op;
      return values.some((value) => comparisonValues.some((comparisonValue) => compareNumericAttributeValue(value, comparisonValue, op)));
    }
    default:
      return false;
  }
}

function getGraphCardAttributeValues(deck: DeckSnapshot, entry: DeckEntry, path: string): unknown[] {
  const normalizedPath = path.trim();
  if (!normalizedPath) return [];

  const virtualValues = getVirtualGraphCardAttributeValues(deck, entry, normalizedPath);
  if (virtualValues) return virtualValues;

  const scryfallPath = normalizedPath.startsWith("scryfall.") ? normalizedPath.slice("scryfall.".length) : normalizedPath;
  if (!entry.scryfall) return [];
  return resolveAttributePath(entry.scryfall, scryfallPath.split("."));
}

function getVirtualGraphCardAttributeValues(deck: DeckSnapshot, entry: DeckEntry, path: string): unknown[] | undefined {
  switch (path) {
    case "card.id":
      return [entry.id];
    case "card.name":
      return [entry.name];
    case "card.quantity":
      return [entry.quantity];
    case "card.section":
      return [entry.section];
    case "card.is_commander":
      return [entry.id === deck.commanderId];
    case "card.is_land":
      return [getPrimaryTypeLine(entry).toLowerCase().includes("land")];
    case "card.is_nonland":
      return [!getPrimaryTypeLine(entry).toLowerCase().includes("land")];
    case "card.type_line_all":
      return [getPrimaryTypeLine(entry)];
    case "card.oracle_text_all":
      return [getOracleText(entry)];
    case "card.mana_value":
      return [getManaValue(entry)];
    default:
      return undefined;
  }
}

function resolveAttributePath(value: unknown, segments: string[]): unknown[] {
  if (!segments.length) return Array.isArray(value) ? value : [value];
  if (value === undefined || value === null) return [];

  const [segment, ...rest] = segments;
  if (segment === "*") {
    const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    return values.flatMap((item) => resolveAttributePath(item, rest));
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => resolveAttributePath(item, segments));
  }

  if (typeof value !== "object") return [];
  return resolveAttributePath((value as Record<string, unknown>)[segment], rest);
}

function attributeValuesEqual(value: unknown, comparisonValue: unknown): boolean {
  if (typeof value === "string" && typeof comparisonValue === "string") {
    return value.toLowerCase() === comparisonValue.toLowerCase();
  }
  return value === comparisonValue;
}

function attributeValueContains(value: unknown, comparisonValue: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => attributeValueContains(item, comparisonValue));
  if (typeof value !== "string" && typeof value !== "number") return false;
  return String(value).toLowerCase().includes(String(comparisonValue).toLowerCase());
}

function attributeValueIncludes(value: unknown, comparisonValue: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => attributeValuesEqual(item, comparisonValue));
  return attributeValuesEqual(value, comparisonValue);
}

function compareNumericAttributeValue(value: unknown, comparisonValue: unknown, op: ">" | ">=" | "<" | "<="): boolean {
  const numberValue = Number(value);
  const numberComparisonValue = Number(comparisonValue);
  if (!Number.isFinite(numberValue) || !Number.isFinite(numberComparisonValue)) return false;
  if (op === ">") return numberValue > numberComparisonValue;
  if (op === ">=") return numberValue >= numberComparisonValue;
  if (op === "<") return numberValue < numberComparisonValue;
  return numberValue <= numberComparisonValue;
}

function inferCardPatchRelationships(
  profile: CardProfile,
  allProfiles: CardProfile[],
): { target: CardProfile; kind: DeckGraphEdgeKind; strength: 1 | 2 | 3 | 4 | 5; evidence: string }[] {
  const relationships: { target: CardProfile; kind: DeckGraphEdgeKind; strength: 1 | 2 | 3 | 4 | 5; evidence: string }[] = [];
  const others = allProfiles.filter((target) => target.entry.id !== profile.entry.id);
  const addMatches = (targets: CardProfile[], kind: DeckGraphEdgeKind, strength: 1 | 2 | 3 | 4 | 5, evidence: (target: CardProfile) => string, limit = 10) => {
    targets.slice(0, limit).forEach((target) => relationships.push({ target, kind, strength, evidence: evidence(target) }));
  };

  if (profile.roles.has("token-producers")) {
    addMatches(
      others.filter((target) => target.roles.has("token-payoffs") || target.roles.has("sacrifice-outlets") || target.roles.has("death-payoffs")),
      "enables",
      5,
      (target) => `${profile.entry.name} creates tokens that can feed ${target.entry.name}.`,
    );
  }
  if (profile.roles.has("token-payoffs")) {
    addMatches(
      others.filter((target) => target.roles.has("token-producers")),
      "pays_off",
      5,
      (target) => `${profile.entry.name} rewards token production from ${target.entry.name}.`,
    );
  }
  if (profile.roles.has("sacrifice-outlets")) {
    addMatches(
      others.filter((target) => target.roles.has("death-payoffs") || target.roles.has("recursion")),
      "enables",
      5,
      (target) => `${profile.entry.name} can sacrifice permanents to enable ${target.entry.name}.`,
    );
  }
  if (profile.roles.has("death-payoffs")) {
    addMatches(
      others.filter((target) => target.roles.has("sacrifice-outlets") || target.roles.has("token-producers")),
      "pays_off",
      5,
      (target) => `${profile.entry.name} pays off death events created or supplied by ${target.entry.name}.`,
    );
  }
  if (profile.roles.has("graveyard-setup")) {
    addMatches(
      others.filter((target) => target.roles.has("recursion") || target.roles.has("death-payoffs")),
      "enables",
      4,
      (target) => `${profile.entry.name} puts cards in the graveyard for ${target.entry.name}.`,
    );
  }
  if (profile.roles.has("recursion")) {
    addMatches(
      others.filter((target) => target.roles.has("graveyard-setup") || recursionSpecificallyReferencesTarget(profile, target)),
      "supports",
      4,
      (target) => `${profile.entry.name} can recover or reuse graveyard resources connected to ${target.entry.name}.`,
    );
  }
  if (profile.text.includes("artifact") && profile.text.includes("graveyard") && canReuseFromGraveyard(profile)) {
    addMatches(
      others.filter((target) => target.typeLine.includes("artifact")),
      "enables",
      5,
      (target) => `${profile.entry.name} can reuse ${target.entry.name} because it is an artifact card and ${profile.entry.name} references artifacts in the graveyard.`,
      12,
    );
  }
  if (profile.roles.has("card-draw")) {
    addMatches(
      others.filter((target) => target.roles.has("finishers") || target.roles.has("sacrifice-outlets") || target.roles.has("token-payoffs")),
      "supports",
      3,
      (target) => `${profile.entry.name} improves access to ${target.entry.name}.`,
      12,
    );
  }
  if (profile.roles.has("protection")) {
    addMatches(
      others.filter((target) => target.isCommander || target.roles.has("finishers") || target.roles.has("token-payoffs") || target.roles.has("death-payoffs")),
      "protects",
      4,
      (target) => `${profile.entry.name} can protect key card ${target.entry.name}.`,
      12,
    );
  }
  if (profile.roles.has("tutors-selection")) {
    addMatches(
      others.filter((target) => target.roles.has("finishers") || target.roles.has("sacrifice-outlets") || target.roles.has("token-payoffs") || target.roles.has("recursion")),
      "supports",
      4,
      (target) => `${profile.entry.name} can help find or set up ${target.entry.name}.`,
      12,
    );
  }
  if (profile.roles.has("board-wipes")) {
    addMatches(
      others.filter((target) => target.isCreature || target.roles.has("token-producers")),
      "answers",
      3,
      (target) => `${profile.entry.name} can reset board states involving ${target.entry.name}.`,
      10,
    );
  }

  return dedupeProfileRelationships(relationships);
}

function canReuseFromGraveyard(profile: CardProfile): boolean {
  return (
    profile.text.includes("from your graveyard") ||
    profile.text.includes("from a graveyard") ||
    profile.text.includes("from graveyard") ||
    profile.text.includes("cast target") ||
    profile.text.includes("return target")
  );
}

function recursionSpecificallyReferencesTarget(profile: CardProfile, target: CardProfile): boolean {
  if (!profile.text.includes("graveyard")) return false;
  if (profile.text.includes("artifact") && target.typeLine.includes("artifact")) return true;
  if (profile.text.includes("creature") && target.typeLine.includes("creature")) return true;
  if (profile.text.includes("enchantment") && target.typeLine.includes("enchantment")) return true;
  if (profile.text.includes("permanent") && target.isPermanent) return true;
  return false;
}

function dedupeProfileRelationships(
  relationships: { target: CardProfile; kind: DeckGraphEdgeKind; strength: 1 | 2 | 3 | 4 | 5; evidence: string }[],
): { target: CardProfile; kind: DeckGraphEdgeKind; strength: 1 | 2 | 3 | 4 | 5; evidence: string }[] {
  const seen = new Set<string>();
  return relationships.filter((relationship) => {
    const key = `${relationship.target.entry.id}:${relationship.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addEnrichedCommanderEdges(deck: DeckSnapshot, profiles: CardProfile[], edges: DeckGraphEdge[]): void {
  if (!deck.commanderId) return;
  const commander = profiles.find((profile) => profile.entry.id === deck.commanderId);
  if (!commander) return;
  profiles
    .filter((profile) => profile.entry.id !== commander.entry.id)
    .filter((profile) => profile.roles.has("commander-support") || profile.roles.has("protection") || profile.roles.has("token-producers"))
    .slice(0, 20)
    .forEach((profile) => {
      edges.push({
        id: edgeId(cardNodeId(profile.entry.id), cardNodeId(commander.entry.id), "supports"),
        sourceId: cardNodeId(profile.entry.id),
        targetId: cardNodeId(commander.entry.id),
        kind: profile.roles.has("protection") ? "protects" : "supports",
        source: "deterministic",
        strength: profile.roles.has("commander-support") ? 4 : 3,
        evidence: `${profile.entry.name} shares commander-relevant language with ${commander.entry.name}.`,
        cardIds: [profile.entry.id, commander.entry.id],
      });
    });
}

function addEnrichedCardPairEdges(profiles: CardProfile[], edges: DeckGraphEdge[]): void {
  const commanders = profiles.filter((profile) => profile.isCommander);
  const tokenProducers = profiles.filter((profile) => profile.roles.has("token-producers"));
  const tokenPayoffs = profiles.filter((profile) => profile.roles.has("token-payoffs"));
  const sacrificeOutlets = profiles.filter((profile) => profile.roles.has("sacrifice-outlets"));
  const deathPayoffs = profiles.filter((profile) => profile.roles.has("death-payoffs"));
  const recursion = profiles.filter((profile) => profile.roles.has("recursion"));
  const graveyardSetup = profiles.filter((profile) => profile.roles.has("graveyard-setup"));
  const protection = profiles.filter((profile) => profile.roles.has("protection"));
  const ramp = profiles.filter((profile) => profile.roles.has("ramp"));
  const cardDraw = profiles.filter((profile) => profile.roles.has("card-draw"));
  const finishers = profiles.filter((profile) => profile.roles.has("finishers"));
  const manaSinks = profiles.filter((profile) => profile.roles.has("mana-sinks"));
  const keyPayoffs = uniqueProfiles([...commanders, ...tokenPayoffs, ...deathPayoffs, ...finishers]).slice(0, 12);

  connectProfileGroups(tokenProducers, tokenPayoffs, edges, "enables", 4, "Token production feeds token payoffs.");
  connectProfileGroups(sacrificeOutlets, deathPayoffs, edges, "enables", 5, "Sacrifice outlets trigger death payoffs on demand.");
  connectProfileGroups(graveyardSetup, recursion, edges, "enables", 4, "Graveyard setup gives recursion meaningful targets.");
  connectProfileGroups(ramp, [...finishers, ...manaSinks], edges, "supports", 3, "Mana acceleration helps deploy or activate expensive payoffs.");
  connectProfileGroups(cardDraw, [...finishers, ...sacrificeOutlets, ...tokenPayoffs], edges, "supports", 3, "Card flow improves access to the payoff package.");
  connectProfileGroups(protection, keyPayoffs, edges, "protects", 4, "Protection keeps commander or payoff cards online.");
}

function addEnrichedRoleEdges(roleMatches: Map<string, CardProfile[]>, edges: DeckGraphEdge[]): void {
  const has = (id: string) => Boolean(roleMatches.get(id)?.length);
  const add = (sourceId: string, sourceKind: DeckGraphNodeKind, targetId: string, targetKind: DeckGraphNodeKind, kind: DeckGraphEdgeKind, evidence: string) => {
    if (!has(sourceId) || !has(targetId)) return;
    edges.push({
      id: edgeId(roleConceptNodeId(sourceKind, sourceId), roleConceptNodeId(targetKind, targetId), kind),
      sourceId: roleConceptNodeId(sourceKind, sourceId),
      targetId: roleConceptNodeId(targetKind, targetId),
      kind,
      source: "deterministic",
      strength: 4,
      evidence,
      cardIds: [...(roleMatches.get(sourceId) ?? []), ...(roleMatches.get(targetId) ?? [])].map((profile) => profile.entry.id).slice(0, 12),
    });
  };

  add("token-producers", "package", "token-payoffs", "strategy", "enables", "Token producers provide the objects that token payoffs reward.");
  add("sacrifice-outlets", "package", "death-payoffs", "strategy", "enables", "Sacrifice outlets turn death payoffs into repeatable engines.");
  add("graveyard-setup", "package", "recursion", "package", "enables", "Graveyard setup increases the quality of recursion effects.");
  add("tutors-selection", "package", "finishers", "strategy", "supports", "Tutors and selection improve access to closing threats.");
  add("ramp", "package", "mana-sinks", "resource", "supports", "Ramp can be converted into mana-sink activations.");
  add("protection", "package", "single-point-failure", "risk", "protects", "Protection lowers exposure to key-card dependency.");
}

function addProfileRoleMatches(profiles: CardProfile[], roleMatches: Map<string, CardProfile[]>, roleIds: string[]): void {
  roleIds.forEach((roleId) => {
    const matches = profiles.filter((profile) => profile.roles.has(roleId));
    if (matches.length) roleMatches.set(roleId, matches);
  });
}

function roleConceptNodeId(kind: DeckGraphNodeKind, roleId: string): string {
  return ["ramp", "card-draw", "protection", "sacrifice"].includes(roleId) ? conceptNodeId(kind, roleId) : conceptNodeId(kind, `enriched-${roleId}`);
}

function connectProfileGroups(
  sources: CardProfile[],
  targets: CardProfile[],
  edges: DeckGraphEdge[],
  kind: DeckGraphEdgeKind,
  strength: 1 | 2 | 3 | 4 | 5,
  evidence: string,
): void {
  sources.slice(0, 16).forEach((source) => {
    targets
      .filter((target) => target.entry.id !== source.entry.id)
      .slice(0, 12)
      .forEach((target) => {
        edges.push({
          id: edgeId(cardNodeId(source.entry.id), cardNodeId(target.entry.id), kind),
          sourceId: cardNodeId(source.entry.id),
          targetId: cardNodeId(target.entry.id),
          kind,
          source: "deterministic",
          strength,
          evidence: `${source.entry.name} -> ${target.entry.name}: ${evidence}`,
          cardIds: [source.entry.id, target.entry.id],
        });
      });
  });
}

function uniqueProfiles(profiles: CardProfile[]): CardProfile[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.entry.id)) return false;
    seen.add(profile.entry.id);
    return true;
  });
}

function upsertNode(nodes: DeckGraphNode[], node: DeckGraphNode): void {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index === -1) nodes.push(node);
  else nodes[index] = { ...nodes[index], ...node };
}

function matchRule(rule: GraphRule, deck: DeckSnapshot): RuleMatch {
  const matches = deck.entries.filter(rule.test);
  return {
    ...rule,
    cardIds: matches.map((entry) => entry.id),
    count: matches.reduce((sum, entry) => sum + entry.quantity, 0),
  };
}

function addCommanderEdges(deck: DeckSnapshot, matches: RuleMatch[], edges: DeckGraphEdge[]): void {
  if (!deck.commanderId) return;
  const commander = deck.entries.find((entry) => entry.id === deck.commanderId);
  if (!commander) return;
  const commanderText = cardText(commander);
  const commanderNode = cardNodeId(commander.id);

  matches
    .filter((match) => match.kind !== "risk")
    .filter((match) => commanderTouchesMatch(commanderText, match))
    .forEach((match) => {
      edges.push({
        id: edgeId(conceptNodeId(match.kind, match.id), commanderNode, "supports"),
        sourceId: conceptNodeId(match.kind, match.id),
        targetId: commanderNode,
        kind: "supports",
        source: "deterministic",
        strength: strengthFromCount(match.count),
        evidence: `${match.label} appears to support ${commander.name}'s text or type line.`,
        cardIds: match.cardIds.slice(0, 8),
      });
    });

  const similarCards = deck.entries.filter((entry) => entry.id !== commander.id && sharesRelevantLanguage(entry, commander)).slice(0, 12);
  if (similarCards.length >= 4) {
    const riskId = conceptNodeId("risk", "commander-dependency");
    edges.push({
      id: edgeId(riskId, commanderNode, "depends_on"),
      sourceId: riskId,
      targetId: commanderNode,
      kind: "depends_on",
      source: "deterministic",
      strength: strengthFromCount(similarCards.length),
      evidence: `${similarCards.length} cards appear to share key language with ${commander.name}.`,
      cardIds: similarCards.map((entry) => entry.id),
    });
  }
}

function addPackageStrategyEdges(matches: RuleMatch[], edges: DeckGraphEdge[]): void {
  const has = (kind: DeckGraphNodeKind, id: string) => matches.some((match) => match.kind === kind && match.id === id);
  const add = (sourceKind: DeckGraphNodeKind, sourceId: string, targetKind: DeckGraphNodeKind, targetId: string, kind: DeckGraphEdgeKind, evidence: string) => {
    if (!has(sourceKind, sourceId) || !has(targetKind, targetId)) return;
    edges.push({
      id: edgeId(conceptNodeId(sourceKind, sourceId), conceptNodeId(targetKind, targetId), kind),
      sourceId: conceptNodeId(sourceKind, sourceId),
      targetId: conceptNodeId(targetKind, targetId),
      kind,
      source: "deterministic",
      strength: 4,
      evidence,
    });
  };

  add("package", "sacrifice", "strategy", "graveyard", "enables", "Sacrifice effects often enable graveyard recursion and death triggers.");
  add("resource", "treasure", "package", "ramp", "supports", "Treasures add burst mana to the ramp package.");
  add("package", "protection", "risk", "board-wipes", "protects", "Protection cards help blunt board wipes and removal.");
  add("package", "card-draw", "strategy", "spells", "supports", "Card draw keeps spell-heavy plans supplied.");
  add("strategy", "tokens", "package", "sacrifice", "enables", "Extra bodies can fuel sacrifice outlets and sacrifice payoffs.");
}

function addRiskEdges(matches: RuleMatch[], edges: DeckGraphEdge[]): void {
  const has = (kind: DeckGraphNodeKind, id: string) => matches.some((match) => match.kind === kind && match.id === id);
  if (has("strategy", "tokens") && has("risk", "board-wipes")) {
    edges.push({
      id: edgeId(conceptNodeId("strategy", "tokens"), conceptNodeId("risk", "board-wipes"), "weak_to"),
      sourceId: conceptNodeId("strategy", "tokens"),
      targetId: conceptNodeId("risk", "board-wipes"),
      kind: "weak_to",
      source: "deterministic",
      strength: 4,
      evidence: "Token plans tend to commit multiple permanents to the battlefield.",
    });
  }
  if (has("strategy", "graveyard") && has("risk", "graveyard-hate")) {
    edges.push({
      id: edgeId(conceptNodeId("strategy", "graveyard"), conceptNodeId("risk", "graveyard-hate"), "weak_to"),
      sourceId: conceptNodeId("strategy", "graveyard"),
      targetId: conceptNodeId("risk", "graveyard-hate"),
      kind: "weak_to",
      source: "deterministic",
      strength: 5,
      evidence: "Graveyard plans can be disrupted by graveyard exile or replacement effects.",
    });
  }
}

function commanderTouchesMatch(commanderText: string, match: RuleMatch): boolean {
  const label = match.label.toLowerCase();
  return label
    .split(/\s+/)
    .some((word) => word.length > 4 && commanderText.includes(word)) ||
    ["token", "graveyard", "artifact", "sacrifice", "draw", "land", "treasure"].some((word) => commanderText.includes(word) && match.label.toLowerCase().includes(word));
}

function sharesRelevantLanguage(entry: DeckEntry, commander: DeckEntry): boolean {
  const text = cardText(entry);
  const commanderText = cardText(commander);
  return ["land", "draw", "token", "artifact", "graveyard", "sacrifice", "counter", "treasure"].some(
    (word) => text.includes(word) && commanderText.includes(word),
  );
}

function strengthFromCount(count: number): 1 | 2 | 3 | 4 | 5 {
  if (count >= 12) return 5;
  if (count >= 8) return 4;
  if (count >= 5) return 3;
  if (count >= 2) return 2;
  return 1;
}

function dedupeEdges(edges: DeckGraphEdge[]): DeckGraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  });
}

function cardText(entry: DeckEntry): string {
  return `${entry.name} ${getPrimaryTypeLine(entry)} ${getOracleText(entry)}`.toLowerCase();
}

function isLand(entry: DeckEntry): boolean {
  return getPrimaryTypeLine(entry).toLowerCase().includes("land");
}

function getCardName(deck: DeckSnapshot, cardId: string): string {
  return deck.entries.find((entry) => entry.id === cardId)?.name ?? "Card";
}

function cardNodeId(cardId: string): string {
  return `card:${cardId}`;
}

function conceptNodeId(kind: DeckGraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function edgeId(sourceId: string, targetId: string, kind: DeckGraphEdgeKind): string {
  return `${sourceId}->${targetId}:${kind}`;
}
