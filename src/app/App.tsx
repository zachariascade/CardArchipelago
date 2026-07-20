import { useEffect, useMemo, useState } from "react";
import { Brain, MoreHorizontal, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { AnalysisLayoutNode, AnalysisResult } from "../analysis/analysisSchema";
import { LocalEndpointAnalysisProvider } from "../analysis/LocalEndpointAnalysisProvider";
import { MockAnalysisProvider } from "../analysis/MockAnalysisProvider";
import { AnalysisRenderer, type AnalysisNodePath } from "../components/analysis-renderer/AnalysisRenderer";
import { DeckGraphView } from "../components/deck-graph/DeckGraphView";
import { DeckGrid, FilterMode, SortMode } from "../components/deck-grid/DeckGrid";
import { DEFAULT_DECKLIST, ImportPanel } from "../components/import/ImportPanel";
import { UnresolvedResolverPanel } from "../components/unresolved-resolver/UnresolvedResolverPanel";
import { ArchidektImport, fetchArchidektDeck } from "../deck/archidekt";
import { DeckBoard, DeckEntry, DeckSnapshot, ScryfallCard, getImageUri, getPrimaryTypeLine } from "../deck/deckModel";
import { DeckGraph, DeckGraphPatch, applyGraphPatches, buildDeckGraph, getConnectedGraphItems, normalizeDeckGraphEdgeId } from "../deck/deckGraph";
import { availableQueries, getCardById, getCommander } from "../deck/deckQueries";
import { ParsedDecklist, parseDecklist } from "../deck/parseDecklist";
import { fetchCardAutocompleteNames, fetchFuzzyCardByName, hydrateDeckEntries, slugify } from "../deck/scryfall";
import { ProviderConfig, QuestionThread, StoredDeckGraphState, loadStoredState, saveStoredState } from "../storage/localDeckStorage";

const EDGE_DELETIONS_PATCH_KEY = "__edge_deletions__";
const NODE_DELETIONS_PATCH_KEY = "__node_deletions__";
const DECK_ANALYSIS_PATCH_KEY = "__deck_analysis__";

export type HoverPreviewHandlers = {
  show: (cardId: string, anchor: HTMLElement) => void;
  hide: () => void;
};

type CardPreviewState = {
  cardId: string;
  left: number;
  top: number;
};

export function App() {
  const [deckText, setDeckText] = useState(DEFAULT_DECKLIST);
  const [archidektUrl, setArchidektUrl] = useState("");
  const [decks, setDecks] = useState<DeckSnapshot[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | undefined>();
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [modalCardId, setModalCardId] = useState<string | undefined>();
  const [analysesByDeckId, setAnalysesByDeckId] = useState<Record<string, AnalysisResult[]>>({});
  const [graphStateByDeckId, setGraphStateByDeckId] = useState<Record<string, StoredDeckGraphState>>({});
  const [graphPatchesByDeckId, setGraphPatchesByDeckId] = useState<Record<string, Record<string, DeckGraphPatch>>>({});
  const [graphPatchErrorsByCardId, setGraphPatchErrorsByCardId] = useState<Record<string, string>>({});
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    mode: "mock",
    endpointUrl: "http://localhost:8787/analyze",
    codexModel: "gpt-5.4",
    codexReasoningEffort: "low",
  });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingArchidekt, setIsImportingArchidekt] = useState(false);
  const [isSyncingArchidekt, setIsSyncingArchidekt] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingDeckGraph, setIsAnalyzingDeckGraph] = useState(false);
  const [deckGraphPatchStatus, setDeckGraphPatchStatus] = useState<string>();
  const [deckGraphPatchError, setDeckGraphPatchError] = useState<string>();
  const [deckGraphPrompt, setDeckGraphPrompt] = useState("");
  const [graphAnalyzingCardId, setGraphAnalyzingCardId] = useState<string>();
  const [questionText, setQuestionText] = useState("");
  const [questionError, setQuestionError] = useState<string>();
  const [isAnsweringQuestion, setIsAnsweringQuestion] = useState(false);
  const [questionThreadsByDeckId, setQuestionThreadsByDeckId] = useState<Record<string, QuestionThread[]>>({});
  const [activeQuestionThreadIdByDeckId, setActiveQuestionThreadIdByDeckId] = useState<Record<string, string | undefined>>({});
  const [openQuestionThreadMenuId, setOpenQuestionThreadMenuId] = useState<string>();
  const [pendingImport, setPendingImport] = useState<{ deck: DeckSnapshot; candidates: DeckEntry[] }>();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("category");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortAscending, setSortAscending] = useState(true);
  const [addCardStatus, setAddCardStatus] = useState<string>();
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [cardPreview, setCardPreview] = useState<CardPreviewState>();
  const [activeView, setActiveView] = useState<"import" | "deck" | "analysis" | "ask" | "graph">("deck");

  useEffect(() => {
    const stored = loadStoredState();
    setDecks(stored.decks);
    setActiveDeckId(stored.activeDeckId);
    setSelectedCardId(stored.selectedCardId);
    setAnalysesByDeckId(stored.analysesByDeckId);
    setGraphStateByDeckId(stored.graphStateByDeckId);
    setGraphPatchesByDeckId(stored.graphPatchesByDeckId);
    setQuestionThreadsByDeckId(stored.questionThreadsByDeckId);
    setActiveQuestionThreadIdByDeckId(stored.activeQuestionThreadIdByDeckId);
    setProviderConfig(stored.providerConfig);
    setHasLoadedStorage(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage) return;
    saveStoredState({
      decks,
      activeDeckId,
      analysesByDeckId,
      graphStateByDeckId,
      graphPatchesByDeckId,
      questionThreadsByDeckId,
      activeQuestionThreadIdByDeckId,
      selectedCardId,
      selectedGraphNodeId: activeDeckId ? graphStateByDeckId[activeDeckId]?.selectedNodeId : undefined,
      analyses: [],
      providerConfig,
    });
  }, [
    decks,
    activeDeckId,
    analysesByDeckId,
    graphStateByDeckId,
    graphPatchesByDeckId,
    questionThreadsByDeckId,
    activeQuestionThreadIdByDeckId,
    selectedCardId,
    providerConfig,
    hasLoadedStorage,
  ]);

  const provider = useMemo(() => {
    if (providerConfig.mode === "local") {
      return new LocalEndpointAnalysisProvider(providerConfig.endpointUrl, {
        codexModel: providerConfig.codexModel,
        codexReasoningEffort: providerConfig.codexReasoningEffort,
      });
    }
    return new MockAnalysisProvider();
  }, [providerConfig]);

  const deck = useMemo(() => decks.find((savedDeck) => savedDeck.id === activeDeckId), [decks, activeDeckId]);
  const analyses = deck ? analysesByDeckId[deck.id] ?? [] : [];
  const activeGraphState = deck ? graphStateByDeckId[deck.id] ?? {} : {};
  const deckGraphPatches = useMemo(() => (deck ? Object.values(graphPatchesByDeckId[deck.id] ?? {}) : []), [deck, graphPatchesByDeckId]);
  const deckGraphPatchCount = deck
    ? Object.keys(graphPatchesByDeckId[deck.id] ?? {}).filter((key) => key !== EDGE_DELETIONS_PATCH_KEY && key !== NODE_DELETIONS_PATCH_KEY).length
    : 0;
  const deckAnalysisGraphPatch = deck ? graphPatchesByDeckId[deck.id]?.[DECK_ANALYSIS_PATCH_KEY] : undefined;
  const deckGraph = useMemo(() => (deck ? applyGraphPatches(buildDeckGraph(deck), deckGraphPatches, deck) : undefined), [deck, deckGraphPatches]);
  const modalCard = deck && modalCardId ? getCardById(deck, modalCardId) : undefined;
  const previewCard = deck && cardPreview ? getCardById(deck, cardPreview.cardId) : undefined;
  const questionThreads = deck ? questionThreadsByDeckId[deck.id] ?? [] : [];
  const activeQuestionThreadId = deck ? activeQuestionThreadIdByDeckId[deck.id] : undefined;
  const activeQuestionThread = activeQuestionThreadId ? questionThreads.find((thread) => thread.id === activeQuestionThreadId) : undefined;
  const commander = deck ? getCommander(deck) : undefined;
  const latestDeckAnalysis = analyses.find((analysis) => analysis.kind === "deck-overview");
  const modalCardAnalysis = modalCard ? findLatestCardAnalysis(analyses, modalCard.id) : undefined;
  const selectedGraphNodeId = activeGraphState.selectedNodeId ?? deckGraph?.nodes[0]?.id;
  const selectedGraphNode = selectedGraphNodeId ? deckGraph?.nodes.find((node) => node.id === selectedGraphNodeId) : undefined;
  const latestGraphNodeAnalysis = selectedGraphNode?.cardId
    ? findLatestCardAnalysis(analyses, selectedGraphNode.cardId)
    : selectedGraphNodeId
      ? findLatestGraphNodeAnalysis(analyses, selectedGraphNodeId)
      : undefined;

  useEffect(() => {
    if (!modalCardId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalCardId(undefined);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalCardId]);

  useEffect(() => {
    setQuestionError(undefined);
    setOpenQuestionThreadMenuId(undefined);
  }, [activeDeckId]);

  useEffect(() => {
    if (!openQuestionThreadMenuId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".question-thread-menu")) return;
      setOpenQuestionThreadMenuId(undefined);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenQuestionThreadMenuId(undefined);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openQuestionThreadMenuId]);

  async function importDeck() {
    setIsImporting(true);
    setImportMessage("Parsing decklist...");
    setWarnings([]);
    setUnresolvedNames([]);
    try {
      const parsed = parseDecklist(deckText);
      await importParsedDeck({
        parsed,
        originalText: deckText,
        deckName: "Imported Commander Deck",
        inferredNameFromCommander: true,
      });
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  async function importArchidektDeck() {
    setIsImportingArchidekt(true);
    setImportMessage("Fetching Archidekt deck...");
    setWarnings([]);
    setUnresolvedNames([]);
    try {
      const imported = await fetchArchidektDeck(archidektUrl);
      setDeckText(imported.originalText);
      await importParsedDeck({
        parsed: imported.parsed,
        originalText: imported.originalText,
        deckName: imported.name,
        source: makeArchidektSource(imported),
      });
      setArchidektUrl(imported.url);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Archidekt import failed.");
    } finally {
      setIsImportingArchidekt(false);
    }
  }

  async function importParsedDeck({
    parsed,
    originalText,
    deckName,
    source,
    inferredNameFromCommander = false,
  }: {
    parsed: ParsedDecklist;
    originalText: string;
    deckName: string;
    source?: DeckSnapshot["source"];
    inferredNameFromCommander?: boolean;
  }) {
    setWarnings(parsed.warnings);
    setImportMessage("Fetching Scryfall card data...");
    const result = await hydrateDeckEntries(parsed);
    setUnresolvedNames(result.unresolvedNames);
    const commanderEntry = findCommander(result.entries, parsed.commanderName);
    const now = new Date().toISOString();
    const nextDeck: DeckSnapshot = {
      id: `deck_${Date.now()}`,
      name: inferredNameFromCommander && commanderEntry ? `${commanderEntry.name} Deck` : deckName,
      format: "commander",
      originalText,
      commanderId: commanderEntry?.id,
      entries: result.entries,
      importedAt: now,
      updatedAt: now,
      source,
    };
    if (!commanderEntry) {
      const candidates = findCommanderCandidates(result.entries);
      if (candidates.length > 0) {
        setPendingImport({ deck: nextDeck, candidates });
        setImportMessage("Choose the commander to finish import.");
        return;
      }
    }
    saveImportedDeck(nextDeck, commanderEntry?.id ?? result.entries[0]?.id);
    setImportMessage(`Imported ${result.entries.length} unique card${result.entries.length === 1 ? "" : "s"}.`);
  }

  async function syncArchidektDeck() {
    if (!deck?.source || deck.source.type !== "archidekt") return;
    setIsSyncingArchidekt(true);
    setAddCardStatus("Syncing from Archidekt...");
    setWarnings([]);
    setUnresolvedNames([]);
    try {
      const imported = await fetchArchidektDeck(deck.source.url);
      setWarnings(imported.parsed.warnings);
      const result = await hydrateDeckEntries(imported.parsed);
      setUnresolvedNames(result.unresolvedNames);
      const commanderEntry = findCommander(result.entries, imported.parsed.commanderName);
      const candidates = commanderEntry ? [] : findCommanderCandidates(result.entries);
      const chosenCommanderId = commanderEntry?.id ?? (deck.commanderId && result.entries.some((entry) => entry.id === deck.commanderId) ? deck.commanderId : candidates[0]?.id);
      const now = new Date().toISOString();
      const nextDeck: DeckSnapshot = {
        ...deck,
        name: imported.name || deck.name,
        originalText: imported.originalText,
        commanderId: chosenCommanderId,
        entries: result.entries,
        updatedAt: now,
        source: makeArchidektSource(imported, now),
      };
      replaceDeckSnapshot(nextDeck, chosenCommanderId ?? result.entries[0]?.id);
      setDeckText(imported.originalText);
      setArchidektUrl(imported.url);
      setAddCardStatus(`Synced ${result.entries.length} unique card${result.entries.length === 1 ? "" : "s"} from Archidekt.`);
    } catch (error) {
      setAddCardStatus(error instanceof Error ? error.message : "Archidekt sync failed.");
    } finally {
      setIsSyncingArchidekt(false);
    }
  }

  function completeCommanderChoice(cardId: string) {
    if (!pendingImport) return;
    const chosen = pendingImport.deck.entries.find((entry) => entry.id === cardId);
    const nextDeck = {
      ...pendingImport.deck,
      commanderId: cardId,
      name: chosen ? `${chosen.name} Deck` : pendingImport.deck.name,
      updatedAt: new Date().toISOString(),
    };
    saveImportedDeck(nextDeck, cardId);
    setPendingImport(undefined);
    setImportMessage(`Imported ${nextDeck.entries.length} unique card${nextDeck.entries.length === 1 ? "" : "s"}.`);
  }

  function saveImportedDeck(nextDeck: DeckSnapshot, nextSelectedCardId?: string) {
    setDecks((current) => [nextDeck, ...current.filter((savedDeck) => savedDeck.id !== nextDeck.id)]);
    setActiveDeckId(nextDeck.id);
    setSelectedCardId(nextSelectedCardId);
    setModalCardId(undefined);
    setCardPreview(undefined);
    setAnalysesByDeckId((current) => ({ ...current, [nextDeck.id]: [] }));
    setGraphStateByDeckId((current) => ({
      ...current,
      [nextDeck.id]: {
        selectedNodeId: nextSelectedCardId ? `card:${nextSelectedCardId}` : undefined,
        hiddenNodeIds: [],
      },
    }));
    setActiveView("deck");
  }

  function replaceDeckSnapshot(nextDeck: DeckSnapshot, nextSelectedCardId?: string) {
    setDecks((current) => current.map((savedDeck) => (savedDeck.id === nextDeck.id ? nextDeck : savedDeck)));
    setSelectedCardId(nextSelectedCardId);
    setModalCardId(undefined);
    setCardPreview(undefined);
    setGraphStateByDeckId((current) => ({
      ...current,
      [nextDeck.id]: {
        selectedNodeId: nextSelectedCardId ? `card:${nextSelectedCardId}` : undefined,
        hiddenNodeIds: current[nextDeck.id]?.hiddenNodeIds?.filter((nodeId) => nextDeck.entries.some((entry) => nodeId === `card:${entry.id}`)) ?? [],
      },
    }));
  }

  function selectSavedDeck(deckId: string) {
    const nextDeck = decks.find((savedDeck) => savedDeck.id === deckId);
    setActiveDeckId(deckId);
    setSelectedCardId(nextDeck?.commanderId ?? nextDeck?.entries[0]?.id);
    setCardPreview(undefined);
    setGraphStateByDeckId((current) => ({
      ...current,
      [deckId]: {
        hiddenNodeIds: current[deckId]?.hiddenNodeIds ?? [],
        selectedNodeId:
          current[deckId]?.selectedNodeId ??
          (nextDeck?.commanderId ? `card:${nextDeck.commanderId}` : nextDeck?.entries[0] ? `card:${nextDeck.entries[0].id}` : undefined),
      },
    }));
    setModalCardId(undefined);
    setSearch("");
  }

  async function analyzeDeck() {
    if (!deck) return;
    await runAnalysis(() => provider.analyzeDeck({ deck, availableQueries }));
    setActiveView("analysis");
  }

  async function answerDeckQuestion() {
    if (!deck) return;
    const question = questionText.trim();
    if (!question) {
      setQuestionError("Ask a question first.");
      return;
    }
    setIsAnsweringQuestion(true);
    setQuestionError(undefined);
    const startedAt = performance.now();
    try {
      const result = await provider.answerQuestion({ deck, availableQueries, question });
      saveQuestionThreadMessage(deck.id, question, {
        ...result,
        generationTimeMs: result.generationTimeMs ?? Math.max(0, Math.round(performance.now() - startedAt)),
      });
      setQuestionText("");
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : "Question failed.");
    } finally {
      setIsAnsweringQuestion(false);
    }
  }

  function startNewQuestionThread() {
    if (!deck) return;
    setActiveQuestionThreadIdByDeckId((current) => ({ ...current, [deck.id]: undefined }));
    setQuestionText("");
    setQuestionError(undefined);
    setOpenQuestionThreadMenuId(undefined);
  }

  function selectQuestionThread(threadId: string) {
    if (!deck) return;
    setActiveQuestionThreadIdByDeckId((current) => ({ ...current, [deck.id]: threadId }));
    setQuestionError(undefined);
    setOpenQuestionThreadMenuId(undefined);
  }

  function deleteQuestionThread(threadId: string) {
    if (!deck) return;
    const thread = questionThreads.find((item) => item.id === threadId);
    const confirmed = window.confirm(`Delete "${thread?.title ?? "this thread"}"?`);
    if (!confirmed) return;
    const remainingThreads = questionThreads.filter((item) => item.id !== threadId);
    setQuestionThreadsByDeckId((current) => ({ ...current, [deck.id]: remainingThreads }));
    setActiveQuestionThreadIdByDeckId((current) => ({
      ...current,
      [deck.id]: current[deck.id] === threadId ? remainingThreads[0]?.id : current[deck.id],
    }));
    setOpenQuestionThreadMenuId(undefined);
  }

  function saveQuestionThreadMessage(deckId: string, question: string, response: AnalysisResult) {
    const now = new Date().toISOString();
    const threadId = activeQuestionThread?.id ?? `question_thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message = {
      id: `question_message_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question,
      response,
      createdAt: now,
    };
    setQuestionThreadsByDeckId((current) => {
      const threads = current[deckId] ?? [];
      const existingThread = threads.find((thread) => thread.id === threadId);
      const nextThread: QuestionThread = existingThread
        ? {
            ...existingThread,
            messages: [...existingThread.messages, message],
            updatedAt: now,
          }
        : {
            id: threadId,
            deckId,
            title: makeQuestionThreadTitle(question),
            messages: [message],
            createdAt: now,
            updatedAt: now,
          };
      return {
        ...current,
        [deckId]: [nextThread, ...threads.filter((thread) => thread.id !== threadId)],
      };
    });
    setActiveQuestionThreadIdByDeckId((current) => ({ ...current, [deckId]: threadId }));
  }

  async function analyzeCard(cardId = selectedCardId) {
    if (!deck || !cardId) return;
    setSelectedCardId(cardId);
    await runAnalysis(() => provider.analyzeCard({ deck, cardId, availableQueries }));
  }

  async function analyzeGraphNode(nodeId = selectedGraphNodeId) {
    if (!deck || !deckGraph || !nodeId) return;
    const node = deckGraph.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    selectGraphNode(nodeId);
    if (node.cardId) {
      await analyzeCard(node.cardId);
      return;
    }
    const connected = getConnectedGraphItems(deckGraph, node.id);
    const connectedNodeText = connected.nodes
      .slice(0, 18)
      .map((item) => `${item.label} (${item.kind}${item.cardId ? `, cardId ${item.cardId}` : ""})`)
      .join("; ");
    const edgeText = connected.edges
      .slice(0, 18)
      .map((edge) => `${edge.kind}${edge.connectionGroup ? ` / ${edge.connectionGroup}` : ""}: ${edge.sourceId} -> ${edge.targetId}${edge.evidence ? `; evidence: ${edge.evidence}` : ""}`)
      .join("\n");
    await runAnalysis(async () => {
      const result = await provider.answerQuestion({
        deck,
        availableQueries,
        question: [
          `Analyze the graph node "${node.label}" (${node.kind}) in this Commander deck.`,
          `Node summary: ${node.summary}`,
          connectedNodeText ? `Connected nodes/cards: ${connectedNodeText}` : "Connected nodes/cards: none visible.",
          edgeText ? `Visible relationships:\n${edgeText}` : "Visible relationships: none visible.",
          "Explain what this strategy/package/resource/risk represents, what cards make it work, the strongest connections, weak points, and what to inspect next.",
        ].join("\n\n"),
      });
      return {
        ...result,
        id: `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "graph-node-analysis",
        subjectGraphNodeId: node.id,
        title: `${node.label} Graph Analysis`,
        summary: result.summary ?? node.summary,
      };
    });
  }

  async function analyzeCardGraph(cardId: string, prompt?: string) {
    if (!deck || !deckGraph) return;
    const trimmedPrompt = prompt?.trim();
    const startedAt = performance.now();
    setGraphAnalyzingCardId(cardId);
    try {
      const patch = withGraphPatchRunFallbacks(
        await provider.analyzeCardGraph({ deck, graph: deckGraph, cardId, availableQueries, prompt: trimmedPrompt }),
        Math.max(0, Math.round(performance.now() - startedAt)),
        makeClientGraphPatchPromptText("Analyze card graph", deck.name, cardId, trimmedPrompt),
        makeClientGraphPatchReasoning("card"),
      );
      setGraphPatchesByDeckId((current) => ({
        ...current,
        [deck.id]: {
          ...(current[deck.id] ?? {}),
          [cardId]: trimmedPrompt ? mergeDeckGraphPatches(current[deck.id]?.[cardId], patch) : patch,
        },
      }));
      setGraphPatchErrorsByCardId((current) => {
        const next = { ...current };
        delete next[cardId];
        return next;
      });
      setGraphStateByDeckId((current) => ({
        ...current,
        [deck.id]: {
          ...current[deck.id],
          selectedNodeId: `card:${cardId}`,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Card graph analysis failed.";
      setGraphPatchErrorsByCardId((current) => ({ ...current, [cardId]: message }));
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [
          {
            id: `graph_patch_error_${Date.now()}`,
            kind: "freeform",
            title: "Card Graph Analysis Failed",
            summary: message,
            layout: { type: "NarrativePanel", title: "Graph Patch Error", body: message },
            createdAt: new Date().toISOString(),
            source: providerConfig.mode === "local" ? "custom" : "mock",
          },
          ...(current[deck.id] ?? []),
        ],
      }));
    } finally {
      setGraphAnalyzingCardId(undefined);
    }
  }

  async function analyzeCardGraphLite(cardId: string, prompt?: string) {
    if (!deck) return;
    const card = deck.entries.find((entry) => entry.id === cardId);
    if (!card) return;
    const trimmedPrompt = prompt?.trim();
    const startedAt = performance.now();
    setGraphAnalyzingCardId(cardId);
    try {
      const patch = withGraphPatchRunFallbacks(
        await provider.analyzeCardGraphLite({ deckId: deck.id, card, prompt: trimmedPrompt }),
        Math.max(0, Math.round(performance.now() - startedAt)),
        makeClientGraphPatchPromptText("Analyze card graph lite", deck.name, cardId, trimmedPrompt),
        makeClientGraphPatchReasoning("card-lite"),
      );
      setGraphPatchesByDeckId((current) => ({
        ...current,
        [deck.id]: {
          ...(current[deck.id] ?? {}),
          [cardId]: mergeDeckGraphPatches(current[deck.id]?.[cardId], patch),
        },
      }));
      setGraphPatchErrorsByCardId((current) => {
        const next = { ...current };
        delete next[cardId];
        return next;
      });
      setGraphStateByDeckId((current) => ({
        ...current,
        [deck.id]: {
          ...current[deck.id],
          selectedNodeId: `card:${cardId}`,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Card graph lite analysis failed.";
      setGraphPatchErrorsByCardId((current) => ({ ...current, [cardId]: message }));
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [
          {
            id: `graph_patch_error_${Date.now()}`,
            kind: "freeform",
            title: "Card Graph Lite Analysis Failed",
            summary: message,
            layout: { type: "NarrativePanel", title: "Graph Patch Error", body: message },
            createdAt: new Date().toISOString(),
            source: providerConfig.mode === "local" ? "custom" : "mock",
          },
          ...(current[deck.id] ?? []),
        ],
      }));
    } finally {
      setGraphAnalyzingCardId(undefined);
    }
  }

  async function analyzeDeckGraph(prompt?: string) {
    if (!deck || !deckGraph) return;
    const trimmedPrompt = prompt?.trim();
    const startedAt = performance.now();
    setIsAnalyzingDeckGraph(true);
    setDeckGraphPatchError(undefined);
    setDeckGraphPatchStatus("Generating deck patch...");
    try {
      const patch = withGraphPatchRunFallbacks(
        await provider.analyzeDeckGraph({ deck, graph: deckGraph, availableQueries, prompt: trimmedPrompt }),
        Math.max(0, Math.round(performance.now() - startedAt)),
        makeClientGraphPatchPromptText("Analyze deck graph", deck.name, undefined, trimmedPrompt),
        makeClientGraphPatchReasoning("deck"),
      );
      setGraphPatchesByDeckId((current) => ({
        ...current,
        [deck.id]: {
          ...(current[deck.id] ?? {}),
          [DECK_ANALYSIS_PATCH_KEY]: trimmedPrompt ? mergeDeckGraphPatches(current[deck.id]?.[DECK_ANALYSIS_PATCH_KEY], patch) : patch,
        },
      }));
      setDeckGraphPatchStatus(
        `Deck patch saved ${patch.nodesToUpsert.length} group${patch.nodesToUpsert.length === 1 ? "" : "s"}, ${patch.edgeFunctions?.length ?? 0} function${(patch.edgeFunctions?.length ?? 0) === 1 ? "" : "s"}, and ${patch.edgesToUpsert.length} direct connection${patch.edgesToUpsert.length === 1 ? "" : "s"}.${formatGraphPatchUsage(patch)}`,
      );
      const firstGeneratedNodeId = patch.nodesToUpsert[0]?.id;
      if (firstGeneratedNodeId) {
        setGraphStateByDeckId((current) => ({
          ...current,
          [deck.id]: {
            ...current[deck.id],
            selectedNodeId: firstGeneratedNodeId,
          },
        }));
      }
      setActiveView("graph");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deck graph analysis failed.";
      setDeckGraphPatchError(message);
      setDeckGraphPatchStatus(undefined);
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [
          {
            id: `deck_graph_patch_error_${Date.now()}`,
            kind: "freeform",
            title: "Deck Graph Analysis Failed",
            summary: message,
            layout: { type: "NarrativePanel", title: "Deck Graph Patch Error", body: message },
            createdAt: new Date().toISOString(),
            source: providerConfig.mode === "local" ? "custom" : "mock",
          },
          ...(current[deck.id] ?? []),
        ],
      }));
    } finally {
      setIsAnalyzingDeckGraph(false);
    }
  }

  async function analyzeGraphNodePrompt(nodeId: string, prompt: string) {
    if (!deckGraph) return;
    const node = deckGraph.nodes.find((item) => item.id === nodeId);
    if (!node?.cardId) return;
    selectGraphNode(nodeId);
    await analyzeCardGraph(node.cardId, prompt);
  }

  function clearCardGraphPatch(cardId: string) {
    if (!deck) return;
    setGraphPatchErrorsByCardId((current) => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    setGraphPatchesByDeckId((current) => {
      const deckPatches = { ...(current[deck.id] ?? {}) };
      delete deckPatches[cardId];
      return {
        ...current,
        [deck.id]: deckPatches,
      };
    });
  }

  function clearDeckGraphPatch() {
    if (!deck || !deckAnalysisGraphPatch) return;
    setDeckGraphPatchStatus("Deck patch deleted.");
    setDeckGraphPatchError(undefined);
    setGraphPatchesByDeckId((current) => {
      const deckPatches = { ...(current[deck.id] ?? {}) };
      delete deckPatches[DECK_ANALYSIS_PATCH_KEY];
      return {
        ...current,
        [deck.id]: deckPatches,
      };
    });
  }

  function clearAllDeckGraphPatches() {
    if (!deck || deckGraphPatchCount === 0) return;
    const confirmed = window.confirm(`Delete all ${deckGraphPatchCount} saved AI graph patch${deckGraphPatchCount === 1 ? "" : "es"} for ${deck.name}?`);
    if (!confirmed) return;
    setGraphPatchesByDeckId((current) => {
      const deletionPatch = current[deck.id]?.[EDGE_DELETIONS_PATCH_KEY];
      const nodeDeletionPatch = current[deck.id]?.[NODE_DELETIONS_PATCH_KEY];
      const nextDeckPatches: Record<string, DeckGraphPatch> = {};
      if (deletionPatch) nextDeckPatches[EDGE_DELETIONS_PATCH_KEY] = deletionPatch;
      if (nodeDeletionPatch) nextDeckPatches[NODE_DELETIONS_PATCH_KEY] = nodeDeletionPatch;
      return {
        ...current,
        [deck.id]: nextDeckPatches,
      };
    });
  }

  function deleteGraphNode(nodeId: string) {
    if (!deck || !deckGraph) return;
    const node = deckGraph.nodes.find((item) => item.id === nodeId);
    if (!node || node.kind === "card") return;
    const connectedEdgeIds = deckGraph.edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId).map((edge) => edge.id);
    const confirmed = window.confirm(
      `Delete "${node.label}" and ${connectedEdgeIds.length} connected relationship${connectedEdgeIds.length === 1 ? "" : "s"} from the graph?`,
    );
    if (!confirmed) return;
    setGraphPatchesByDeckId((current) => {
      const deckPatches = current[deck.id] ?? {};
      const currentPatch = deckPatches[NODE_DELETIONS_PATCH_KEY];
      const removedNodeIds = Array.from(new Set([...(currentPatch?.nodeIdsToRemove ?? []), nodeId]));
      const removedEdgeIds = Array.from(new Set([...(currentPatch?.edgeIdsToRemove ?? []), ...connectedEdgeIds]));
      const deletionPatch: DeckGraphPatch = {
        id: currentPatch?.id ?? `patch_${deck.id}_node_deletions`,
        deckId: deck.id,
        cardId: NODE_DELETIONS_PATCH_KEY,
        nodesToUpsert: [],
        edgesToUpsert: [],
        edgeFunctions: [],
        nodeIdsToRemove: removedNodeIds,
        edgeIdsToRemove: removedEdgeIds,
        notes: [`${removedNodeIds.length} graph node${removedNodeIds.length === 1 ? "" : "s"} manually deleted.`],
        generatedAt: new Date().toISOString(),
        source: "ai",
      };
      return {
        ...current,
        [deck.id]: {
          ...deckPatches,
          [NODE_DELETIONS_PATCH_KEY]: deletionPatch,
        },
      };
    });
    setGraphStateByDeckId((current) => {
      const currentState = current[deck.id] ?? {};
      return {
        ...current,
        [deck.id]: {
          ...currentState,
          selectedNodeId: deckGraph.nodes.find((item) => item.id !== nodeId)?.id,
        },
      };
    });
  }

  function deleteGraphEdge(edgeId: string) {
    deleteGraphEdges([edgeId]);
  }

  function deleteGraphEdges(edgeIds: string[], label?: string) {
    if (!deck || !deckGraph) return;
    const uniqueEdgeIds = Array.from(new Set(edgeIds));
    const edges = uniqueEdgeIds.map((edgeId) => deckGraph.edges.find((item) => item.id === edgeId)).filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
    if (!edges.length) return;
    const confirmed =
      edges.length === 1
        ? window.confirm(formatDeleteEdgeConfirmation(deckGraph, edges[0]))
        : window.confirm(`Delete ${edges.length} generated connection${edges.length === 1 ? "" : "s"}${label ? ` from ${label}` : ""}?`);
    if (!confirmed) return;
    setGraphPatchesByDeckId((current) => {
      const deckPatches = current[deck.id] ?? {};
      const currentPatch = deckPatches[EDGE_DELETIONS_PATCH_KEY];
      const removedIds = Array.from(new Set([...(currentPatch?.edgeIdsToRemove ?? []), ...edges.map((edge) => edge.id)]));
      const deletionPatch: DeckGraphPatch = {
        id: currentPatch?.id ?? `patch_${deck.id}_edge_deletions`,
        deckId: deck.id,
        cardId: EDGE_DELETIONS_PATCH_KEY,
        nodesToUpsert: [],
        edgesToUpsert: [],
        edgeFunctions: [],
        edgeIdsToRemove: removedIds,
        notes: [`${removedIds.length} graph edge${removedIds.length === 1 ? "" : "s"} manually deleted.`],
        generatedAt: new Date().toISOString(),
        source: "ai",
      };
      return {
        ...current,
        [deck.id]: {
          ...deckPatches,
          [EDGE_DELETIONS_PATCH_KEY]: deletionPatch,
        },
      };
    });
  }

  function selectGraphNode(nodeId: string) {
    if (!deck) return;
    setGraphStateByDeckId((current) => ({
      ...current,
      [deck.id]: {
        ...current[deck.id],
        selectedNodeId: nodeId,
      },
    }));
  }

  function hideGraphNode(nodeId: string) {
    if (!deck) return;
    setGraphStateByDeckId((current) => {
      const currentState = current[deck.id] ?? {};
      const hiddenNodeIds = Array.from(new Set([...(currentState.hiddenNodeIds ?? []), nodeId]));
      const selectedNodeId =
        currentState.selectedNodeId === nodeId ? deckGraph?.nodes.find((node) => !hiddenNodeIds.includes(node.id))?.id : currentState.selectedNodeId;
      return {
        ...current,
        [deck.id]: {
          ...currentState,
          hiddenNodeIds,
          selectedNodeId,
        },
      };
    });
  }

  function resetHiddenGraphNodes() {
    if (!deck) return;
    setGraphStateByDeckId((current) => ({
      ...current,
      [deck.id]: {
        ...current[deck.id],
        hiddenNodeIds: [],
      },
    }));
  }

  function resolveDeckEntry(entryId: string, card: ScryfallCard) {
    if (!deck) return;
    const unresolvedEntry = deck.entries.find((entry) => entry.id === entryId);
    if (!unresolvedEntry) return;
    let mergedIntoExisting = false;
    const nextEntries = deck.entries
      .map((entry) => {
        if (entry.id === entryId) {
          if (deck.entries.some((candidate) => candidate.id === card.id && candidate.id !== entryId)) {
            return undefined;
          }
          return {
            ...entry,
            id: card.id,
            name: card.name,
            unresolved: false,
            scryfall: card,
          };
        }
        if (entry.id === card.id) {
          mergedIntoExisting = true;
          return {
            ...entry,
            quantity: entry.quantity + unresolvedEntry.quantity,
          };
        }
        return entry;
      })
      .filter((entry): entry is DeckEntry => Boolean(entry));

    const nextDeck: DeckSnapshot = {
      ...deck,
      commanderId: deck.commanderId === entryId ? card.id : deck.commanderId,
      entries: nextEntries,
      updatedAt: new Date().toISOString(),
    };
    setDecks((current) => current.map((savedDeck) => (savedDeck.id === deck.id ? nextDeck : savedDeck)));
    if (selectedCardId === entryId || mergedIntoExisting) setSelectedCardId(card.id);
    setGraphStateByDeckId((current) => {
      const state = current[deck.id] ?? {};
      return {
        ...current,
        [deck.id]: {
          ...state,
          selectedNodeId: state.selectedNodeId === `card:${entryId}` ? `card:${card.id}` : state.selectedNodeId,
          hiddenNodeIds: state.hiddenNodeIds?.map((nodeId) => (nodeId === `card:${entryId}` ? `card:${card.id}` : nodeId)),
        },
      };
    });
    setUnresolvedNames((current) => current.filter((name) => name !== unresolvedEntry.name));
  }

  function moveCardToBoard(cardId: string, board: DeckBoard) {
    if (!deck) return;
    const now = new Date().toISOString();
    setDecks((current) =>
      current.map((savedDeck) =>
        savedDeck.id === deck.id
          ? {
              ...savedDeck,
              entries: savedDeck.entries.map((entry) => (entry.id === cardId ? { ...entry, board } : entry)),
              updatedAt: now,
            }
          : savedDeck,
      ),
    );
  }

  async function addCardToDeck(name: string, quantity: number, board: DeckBoard) {
    if (!deck) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const safeQuantity = Math.max(1, Math.floor(quantity));
    setIsAddingCard(true);
    setAddCardStatus(`Importing ${trimmedName} from Scryfall...`);
    try {
      const card = await fetchFuzzyCardByName(trimmedName);
      const now = new Date().toISOString();
      let nextSelectedCardId = card.id;
      setDecks((current) =>
        current.map((savedDeck) => {
          if (savedDeck.id !== deck.id) return savedDeck;
          const existingEntry = savedDeck.entries.find((entry) => entry.id === card.id);
          const entries = existingEntry
            ? savedDeck.entries.map((entry) =>
                entry.id === card.id
                  ? {
                      ...entry,
                      quantity: entry.quantity + safeQuantity,
                      board,
                      unresolved: false,
                      scryfall: card,
                    }
                  : entry,
              )
            : [
                ...savedDeck.entries,
                {
                  id: card.id,
                  name: card.name,
                  quantity: safeQuantity,
                  board,
                  scryfall: card,
                },
              ];
          return {
            ...savedDeck,
            entries,
            updatedAt: now,
          };
        }),
      );
      setSelectedCardId(nextSelectedCardId);
      setAddCardStatus(`Added ${safeQuantity} ${card.name}${safeQuantity === 1 ? "" : "s"} to ${board === "mainboard" ? "Mainboard" : "Sideboard"}.`);
    } catch (error) {
      setAddCardStatus(error instanceof Error ? error.message : "Could not add that card.");
    } finally {
      setIsAddingCard(false);
    }
  }

  function deleteCardFromDeck(cardId: string) {
    if (!deck) return;
    const card = deck.entries.find((entry) => entry.id === cardId);
    if (!card) return;
    const confirmed = window.confirm(`Delete ${card.name} from ${deck.name}?`);
    if (!confirmed) return;
    const nextEntries = deck.entries.filter((entry) => entry.id !== cardId);
    const nextSelectedCardId =
      selectedCardId === cardId ? deck.commanderId && deck.commanderId !== cardId ? deck.commanderId : nextEntries[0]?.id : selectedCardId;
    setDecks((current) =>
      current.map((savedDeck) =>
        savedDeck.id === deck.id
          ? {
              ...savedDeck,
              commanderId: savedDeck.commanderId === cardId ? undefined : savedDeck.commanderId,
              entries: savedDeck.entries.filter((entry) => entry.id !== cardId),
              updatedAt: new Date().toISOString(),
            }
          : savedDeck,
      ),
    );
    setGraphPatchErrorsByCardId((current) => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    setGraphPatchesByDeckId((current) => {
      const deckPatches = { ...(current[deck.id] ?? {}) };
      delete deckPatches[cardId];
      return {
        ...current,
        [deck.id]: deckPatches,
      };
    });
    setGraphStateByDeckId((current) => {
      const state = current[deck.id] ?? {};
      return {
        ...current,
        [deck.id]: {
          ...state,
          selectedNodeId: state.selectedNodeId === `card:${cardId}` ? (nextSelectedCardId ? `card:${nextSelectedCardId}` : undefined) : state.selectedNodeId,
          hiddenNodeIds: state.hiddenNodeIds?.filter((nodeId) => nodeId !== `card:${cardId}`),
        },
      };
    });
    if (modalCardId === cardId) setModalCardId(undefined);
    setCardPreview(undefined);
    setSelectedCardId(nextSelectedCardId);
    setAddCardStatus(`Deleted ${card.name}.`);
  }

  function deleteAnalysisNode(analysisId: string, path: AnalysisNodePath) {
    if (!deck) return;
    setAnalysesByDeckId((current) => ({
      ...current,
      [deck.id]: (current[deck.id] ?? []).map((analysis) =>
        analysis.id === analysisId
          ? {
              ...analysis,
              layout: removeLayoutNodeAtPath(analysis.layout, path),
            }
          : analysis,
      ),
    }));
  }

  function openCardModal(cardId: string) {
    setCardPreview(undefined);
    setSelectedCardId(cardId);
    setModalCardId(cardId);
  }

  const hoverPreview = useMemo<HoverPreviewHandlers>(
    () => ({
      show: (cardId, anchor) => {
        setCardPreview({ cardId, ...getPreviewPosition(anchor.getBoundingClientRect()) });
      },
      hide: () => setCardPreview(undefined),
    }),
    [],
  );

  async function runAnalysis(action: () => Promise<AnalysisResult>) {
    const startedAt = performance.now();
    setIsAnalyzing(true);
    try {
      const result = await action();
      if (!deck) return;
      const generationTimeMs = result.generationTimeMs ?? Math.max(0, Math.round(performance.now() - startedAt));
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [{ ...result, generationTimeMs }, ...(current[deck.id] ?? [])],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed.";
      if (!deck) return;
      const generationTimeMs = Math.max(0, Math.round(performance.now() - startedAt));
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [
          {
          id: `error_${Date.now()}`,
          kind: "freeform",
          title: "Analysis Failed",
          summary: message,
          generationTimeMs,
          reasoningSummary: "The provider request failed before an analysis could be generated. The app captured the error and rendered it as an analysis result so it can be reviewed.",
          layout: { type: "NarrativePanel", title: "Provider Error", body: message },
          createdAt: new Date().toISOString(),
          source: providerConfig.mode === "local" ? "custom" : "mock",
          },
          ...(current[deck.id] ?? []),
        ],
      }));
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>MTG Deck Explorer</h1>
          <p>Local-first Commander workbench with query-backed analysis panels.</p>
        </div>
        <div className="provider-control">
          <select value={providerConfig.mode} onChange={(event) => setProviderConfig((current) => ({ ...current, mode: event.target.value as ProviderConfig["mode"] }))}>
            <option value="mock">Mock AI</option>
            <option value="local">Local endpoint</option>
          </select>
          <input
            value={providerConfig.endpointUrl}
            onChange={(event) => setProviderConfig((current) => ({ ...current, endpointUrl: event.target.value }))}
            disabled={providerConfig.mode !== "local"}
            aria-label="Local endpoint URL"
          />
          <select
            value={providerConfig.codexModel}
            onChange={(event) => setProviderConfig((current) => ({ ...current, codexModel: event.target.value }))}
            disabled={providerConfig.mode !== "local"}
            aria-label="Codex model"
          >
            <option value="gpt-5.4">GPT-5.4</option>
            <option value="gpt-5.5">GPT-5.5</option>
          </select>
          <select
            value={providerConfig.codexReasoningEffort}
            onChange={(event) => setProviderConfig((current) => ({ ...current, codexReasoningEffort: event.target.value as ProviderConfig["codexReasoningEffort"] }))}
            disabled={providerConfig.mode !== "local"}
            aria-label="Codex reasoning effort"
          >
            <option value="low">Low effort</option>
            <option value="medium">Medium effort</option>
            <option value="high">High effort</option>
          </select>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Workspace views">
        <button type="button" className={activeView === "import" ? "active" : ""} onClick={() => setActiveView("import")}>
          Import Decklist
        </button>
        <button type="button" className={activeView === "deck" ? "active" : ""} onClick={() => setActiveView("deck")}>
          Deck
        </button>
        <button type="button" className={activeView === "analysis" ? "active" : ""} onClick={() => setActiveView("analysis")}>
          Analysis
        </button>
        <button type="button" className={activeView === "ask" ? "active" : ""} onClick={() => setActiveView("ask")}>
          Ask AI
        </button>
        <button type="button" className={activeView === "graph" ? "active" : ""} onClick={() => setActiveView("graph")}>
          Graph
        </button>
      </nav>

      {activeView === "import" && (
        <>
          <ImportPanel
            deckText={deckText}
            archidektUrl={archidektUrl}
            isImporting={isImporting}
            isImportingArchidekt={isImportingArchidekt}
            importMessage={importMessage}
            warnings={warnings}
            unresolvedNames={unresolvedNames}
            onDeckTextChange={setDeckText}
            onArchidektUrlChange={setArchidektUrl}
            onImport={importDeck}
            onImportArchidekt={importArchidektDeck}
          />

          {pendingImport && (
            <CommanderConfirmPanel
              candidates={pendingImport.candidates}
              onChoose={completeCommanderChoice}
              hoverPreview={hoverPreview}
            />
          )}
        </>
      )}

      {activeView === "deck" && (
        <>
          {decks.length > 0 && (
            <section className="deck-library-bar">
              <label>
                <span>Saved Deck</span>
                <select value={activeDeckId ?? ""} onChange={(event) => selectSavedDeck(event.target.value)}>
                  {decks.map((savedDeck) => (
                    <option key={savedDeck.id} value={savedDeck.id}>
                      {savedDeck.name}
                    </option>
                  ))}
                </select>
              </label>
              {deck?.commanderId && <span className="library-meta">Commander saved: {commander?.name}</span>}
              {deck?.source?.type === "archidekt" && (
                <div className="archidekt-sync-controls">
                  <a href={deck.source.url} target="_blank" rel="noreferrer">
                    Archidekt
                  </a>
                  {deck.source.lastSyncedAt && <span>Synced {formatDateTime(deck.source.lastSyncedAt)}</span>}
                  <button type="button" className="secondary-button" onClick={() => void syncArchidektDeck()} disabled={isSyncingArchidekt}>
                    <RefreshCw size={16} />
                    {isSyncingArchidekt ? "Syncing..." : "Sync"}
                  </button>
                </div>
              )}
            </section>
          )}

          {deck && <UnresolvedResolverPanel entries={deck.entries} onResolve={resolveDeckEntry} />}

          {deck && (
            <section className="main-layout">
              <DeckGrid
                deck={deck}
                selectedCardId={selectedCardId}
                search={search}
                sortMode={sortMode}
                filterMode={filterMode}
                sortAscending={sortAscending}
                onSearchChange={setSearch}
                onSortModeChange={setSortMode}
                onFilterModeChange={setFilterMode}
                onSortAscendingChange={setSortAscending}
                onSelectCard={openCardModal}
                onMoveCardToBoard={moveCardToBoard}
                onDeleteCard={deleteCardFromDeck}
                onAddCard={addCardToDeck}
                onSearchCardNames={fetchCardAutocompleteNames}
                addCardStatus={addCardStatus}
                isAddingCard={isAddingCard}
              />
            </section>
          )}

          {!deck && (
            <div className="analysis-empty-state">
              Use Import Decklist to add a deck, then it will appear here.
            </div>
          )}
        </>
      )}

      {activeView === "analysis" && (
        <section className="analysis-view">
          <div className="analysis-view-header">
            <div>
              <h2>Analysis</h2>
              <p>{deck ? `Deck-level analysis for ${deck.name}.` : "Import a deck to generate analysis."}</p>
            </div>
            {deck && (
              <button type="button" className="primary-button" onClick={analyzeDeck} disabled={isAnalyzing}>
                <Brain size={17} />
                {latestDeckAnalysis ? "Refresh Analysis" : "Analyze Deck"}
              </button>
            )}
          </div>

          {deck && latestDeckAnalysis ? (
            <AnalysisRenderer
              deck={deck}
              analysis={latestDeckAnalysis}
              onSelectCard={openCardModal}
              hoverPreview={hoverPreview}
              onDeleteNode={(path) => deleteAnalysisNode(latestDeckAnalysis.id, path)}
            />
          ) : (
            <div className="analysis-empty-state">
              {deck ? "Run Analyze Deck to generate the deck overview here." : "No deck selected."}
            </div>
          )}

          {deck && analyses.filter((analysis) => analysis.kind !== "card-analysis").length > 1 && (
            <section className="history-band">
              <h2>Saved Analyses</h2>
              <div>
                {analyses
                  .filter((analysis) => analysis.kind !== "card-analysis")
                  .slice(1)
                  .map((analysis) => (
                    <button
                      key={analysis.id}
                      type="button"
                      onClick={() =>
                        deck &&
                        setAnalysesByDeckId((current) => ({
                          ...current,
                          [deck.id]: [analysis, ...(current[deck.id] ?? []).filter((item) => item.id !== analysis.id)],
                        }))
                      }
                    >
                      <Sparkles size={15} />
                      {analysis.title}
                    </button>
                  ))}
              </div>
            </section>
          )}
        </section>
      )}

      {activeView === "ask" && (
        <section className="analysis-view">
          <div className="analysis-view-header">
            <div>
              <h2>Ask AI</h2>
              <p>{deck ? `Ask a one-off question about ${deck.name}.` : "Import a deck to ask questions."}</p>
            </div>
          </div>

          {deck ? (
            <section className="question-workspace">
              <aside className="question-sidebar" aria-label="Ask AI threads">
                <button type="button" className="primary-button question-new-thread-button" onClick={startNewQuestionThread}>
                  <Plus size={16} />
                  New Chat
                </button>
                <div className="question-thread-list">
                  {questionThreads.length ? (
                    questionThreads.map((thread) => (
                      <div key={thread.id} className={`question-thread-row ${thread.id === activeQuestionThreadId ? "active" : ""}`}>
                        <button type="button" className="question-thread-main" onClick={() => selectQuestionThread(thread.id)}>
                          <strong>{thread.title}</strong>
                          <span>{formatQuestionThreadDate(thread.updatedAt)}</span>
                        </button>
                        <div className={`question-thread-menu ${openQuestionThreadMenuId === thread.id ? "open" : ""}`}>
                          <button
                            type="button"
                            className="icon-button question-thread-menu-trigger"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenQuestionThreadMenuId((current) => (current === thread.id ? undefined : thread.id));
                            }}
                            aria-label={`Open actions for ${thread.title}`}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                          <div className="question-thread-menu-popover">
                            <button type="button" className="question-thread-delete" onClick={() => deleteQuestionThread(thread.id)}>
                              <Trash2 size={15} />
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="question-sidebar-empty">No saved chats yet.</p>
                  )}
                </div>
              </aside>

              <div className="question-main">
                <section className="question-panel" aria-label="Ask a question">
                  <label htmlFor="deck-question">
                    <span>{activeQuestionThread ? "Follow-up" : "Question"}</span>
                    <textarea
                      id="deck-question"
                      value={questionText}
                      onChange={(event) => setQuestionText(event.target.value)}
                      placeholder="Example: Which cards best support my commander, and why?"
                      rows={5}
                    />
                  </label>
                  <div className="question-panel-actions">
                    <button type="button" className="primary-button" onClick={() => void answerDeckQuestion()} disabled={isAnsweringQuestion}>
                      <Brain size={17} />
                      {isAnsweringQuestion ? "Answering..." : activeQuestionThread ? "Ask Follow-up" : "Ask Question"}
                    </button>
                  </div>
                  {questionError && <p className="question-error">{questionError}</p>}
                </section>

                {activeQuestionThread?.messages.length ? (
                  <div className="question-message-stack">
                    {activeQuestionThread.messages.map((message) => (
                      <section className="question-message" key={message.id}>
                        <div className="question-bubble">
                          <span>{formatQuestionThreadDate(message.createdAt)}</span>
                          <p>{message.question}</p>
                        </div>
                        <AnalysisRenderer deck={deck} analysis={message.response} onSelectCard={openCardModal} hoverPreview={hoverPreview} />
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="analysis-empty-state">
                    Ask a question to start a saved chat for this deck.
                  </div>
                )}
              </div>
            </section>
          ) : (
            <div className="analysis-empty-state">No deck selected.</div>
          )}
        </section>
      )}

      {activeView === "graph" && (
        deck && deckGraph ? (
          <DeckGraphView
            deck={deck}
            graph={deckGraph}
            selectedNodeId={selectedGraphNodeId}
            hiddenNodeIds={activeGraphState.hiddenNodeIds ?? []}
            isAnalyzing={isAnalyzing || graphAnalyzingCardId === selectedGraphNode?.cardId}
            latestAnalysis={latestGraphNodeAnalysis}
            connectionsPlacement="below-graph"
            onSelectNode={selectGraphNode}
            onOpenCard={openCardModal}
            onAnalyzeNode={(nodeId) => void analyzeGraphNode(nodeId)}
            onPromptAnalyzeNode={(nodeId, prompt) => void analyzeGraphNodePrompt(nodeId, prompt)}
            onHideNode={hideGraphNode}
            onDeleteNode={deleteGraphNode}
            onDeleteEdge={deleteGraphEdge}
            onDeleteEdges={deleteGraphEdges}
            onResetHiddenNodes={resetHiddenGraphNodes}
          toolbarActions={
              <>
                <label className="deck-graph-prompt-panel" htmlFor="deck-graph-prompt">
                  <span>Deck Prompt Optional</span>
                  <textarea
                    id="deck-graph-prompt"
                    value={deckGraphPrompt}
                    onChange={(event) => setDeckGraphPrompt(event.target.value)}
                    placeholder="Example: Make a Power 7 Strategy and connect all cards that have power 7 bonuses to them."
                    rows={3}
                  />
                </label>
                <button type="button" className="primary-button" onClick={() => void analyzeDeckGraph(deckGraphPrompt)} disabled={isAnalyzingDeckGraph}>
                  <Sparkles size={16} />
                  {isAnalyzingDeckGraph ? "Generating..." : deckGraphPrompt.trim() ? "Add Deck Connections" : deckAnalysisGraphPatch ? "Refresh Deck Patch" : "Generate Deck Patch"}
                </button>
                {deckAnalysisGraphPatch && (
                  <button type="button" className="secondary-button" onClick={clearDeckGraphPatch}>
                    <Trash2 size={16} />
                    Delete Deck Patch
                  </button>
                )}
                <button type="button" className="secondary-button" onClick={clearAllDeckGraphPatches} disabled={deckGraphPatchCount === 0}>
                  <Trash2 size={16} />
                  Clear AI Patches
                </button>
                {(deckGraphPatchError || deckGraphPatchStatus) && (
                  <span className={deckGraphPatchError ? "graph-patch-status error" : "graph-patch-status"}>
                    {deckGraphPatchError ?? deckGraphPatchStatus}
                  </span>
                )}
              </>
            }
            hoverPreview={hoverPreview}
          />
        ) : (
          <div className="analysis-empty-state">Import a deck to generate the deck graph.</div>
        )
      )}

      {deck && modalCard && (
        <CardDetailModal
          deck={deck}
          card={modalCard}
          graph={deckGraph}
          analysis={modalCardAnalysis}
          isAnalyzing={isAnalyzing && selectedCardId === modalCard.id}
          isAnalyzingGraph={graphAnalyzingCardId === modalCard.id}
          graphPatch={graphPatchesByDeckId[deck.id]?.[modalCard.id]}
          graphError={graphPatchErrorsByCardId[modalCard.id]}
          onAnalyzeCard={() => void analyzeCard(modalCard.id)}
          onAnalyzeCardGraph={(prompt) => void analyzeCardGraph(modalCard.id, prompt)}
          onAnalyzeCardGraphLite={(prompt) => void analyzeCardGraphLite(modalCard.id, prompt)}
          onClearCardGraphPatch={() => clearCardGraphPatch(modalCard.id)}
          onDeleteGraphEdge={deleteGraphEdge}
          onDeleteGraphEdges={deleteGraphEdges}
          onSelectCard={openCardModal}
          hoverPreview={hoverPreview}
          onDeleteAnalysisNode={modalCardAnalysis ? (path) => deleteAnalysisNode(modalCardAnalysis.id, path) : undefined}
          onClose={() => setModalCardId(undefined)}
        />
      )}

      {previewCard && cardPreview && <CardHoverPreview card={previewCard} left={cardPreview.left} top={cardPreview.top} />}
    </main>
  );
}

function CardDetailModal({
  deck,
  card,
  graph,
  graphPatch,
  graphError,
  analysis,
  isAnalyzing,
  isAnalyzingGraph,
  onAnalyzeCard,
  onAnalyzeCardGraph,
  onAnalyzeCardGraphLite,
  onClearCardGraphPatch,
  onDeleteGraphEdge,
  onDeleteGraphEdges,
  onSelectCard,
  hoverPreview,
  onDeleteAnalysisNode,
  onClose,
}: {
  deck: DeckSnapshot;
  card: DeckEntry;
  graph?: DeckGraph;
  graphPatch?: DeckGraphPatch;
  graphError?: string;
  analysis?: AnalysisResult;
  isAnalyzing: boolean;
  isAnalyzingGraph: boolean;
  onAnalyzeCard: () => void;
  onAnalyzeCardGraph: (prompt?: string) => void;
  onAnalyzeCardGraphLite: (prompt?: string) => void;
  onClearCardGraphPatch: () => void;
  onDeleteGraphEdge: (edgeId: string) => void;
  onDeleteGraphEdges: (edgeIds: string[], label?: string) => void;
  onSelectCard: (cardId: string) => void;
  hoverPreview: HoverPreviewHandlers;
  onDeleteAnalysisNode?: (path: AnalysisNodePath) => void;
  onClose: () => void;
}) {
  const [activeModalTab, setActiveModalTab] = useState<"analysis" | "graph">("graph");
  const [selectedModalGraphNodeId, setSelectedModalGraphNodeId] = useState(`card:${card.id}`);
  const [patchCopyStatus, setPatchCopyStatus] = useState<string>();
  const [graphPrompt, setGraphPrompt] = useState("");
  const [activeGraphRunTab, setActiveGraphRunTab] = useState<"prompt" | "reasoning">("reasoning");

  useEffect(() => {
    setSelectedModalGraphNodeId(`card:${card.id}`);
    setPatchCopyStatus(undefined);
    setGraphPrompt("");
    setActiveGraphRunTab("reasoning");
  }, [card.id]);

  useEffect(() => {
    setActiveModalTab("graph");
  }, [card.id]);

  async function copyGraphPatchJson() {
    if (!graphPatch) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(graphPatch, null, 2));
      setPatchCopyStatus("Connections JSON copied.");
    } catch {
      setPatchCopyStatus("Could not copy connections JSON.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="card-detail-modal" role="dialog" aria-modal="true" aria-labelledby="card-detail-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="card-detail-title" className="sr-only">{card.name}</h2>
        <button className="modal-close-button" type="button" onClick={onClose} aria-label="Close card detail">
          <X size={20} />
        </button>
        <div className="modal-card-profile">
          <div className="modal-card-tools">
            <div className="tab-row modal-tab-row" role="tablist" aria-label="Card detail views">
              <button type="button" className={activeModalTab === "analysis" ? "active" : ""} onClick={() => setActiveModalTab("analysis")}>
                Analysis
              </button>
              <button type="button" className={activeModalTab === "graph" ? "active" : ""} onClick={() => setActiveModalTab("graph")}>
                Graph
              </button>
            </div>

            {activeModalTab === "analysis" && (
              <div className="modal-analysis-actions">
                <button type="button" className="primary-button" onClick={onAnalyzeCard} disabled={isAnalyzing}>
                  <RefreshCw size={16} />
                  {isAnalyzing ? "Analyzing..." : "Analyze Card"}
                </button>
              </div>
            )}

            {activeModalTab === "graph" && graph && (
              <div className="graph-prompt-panel modal-graph-prompt">
                <label htmlFor={`modal-graph-prompt-${card.id}`}>
                  <span>Prompt Optional</span>
                  <textarea
                    id={`modal-graph-prompt-${card.id}`}
                    value={graphPrompt}
                    onChange={(event) => setGraphPrompt(event.target.value)}
                    placeholder="Example: create a custom group for every card that can feed this payoff."
                    rows={3}
                  />
                </label>
                <div className="modal-graph-prompt-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAnalyzeCardGraph(graphPrompt)}
                    disabled={isAnalyzingGraph}
                    title="Analyze this card using the full deck and current graph as context."
                  >
                    <Brain size={16} />
                    {isAnalyzingGraph ? "Analyzing..." : "Analyze Connections"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onAnalyzeCardGraphLite(graphPrompt)}
                    disabled={isAnalyzingGraph}
                    title="Quickly analyze only this card and generate card-only connection functions."
                  >
                    <Sparkles size={16} />
                    Quick Connections
                  </button>
                </div>
                <p className="modal-graph-prompt-status">
                  {graphError ??
                    patchCopyStatus ??
                    (graphPatch
                      ? `Last graph analysis saved ${graphPatch.edgesToUpsert.length} direct edge${graphPatch.edgesToUpsert.length === 1 ? "" : "s"} and ${graphPatch.edgeFunctions?.length ?? 0} edge function${(graphPatch.edgeFunctions?.length ?? 0) === 1 ? "" : "s"}.${formatGraphPatchUsage(graphPatch)}`
                      : "Generate AI graph edges with an optional prompt, then build up the deck graph card by card.")}
                </p>
                {graphPatch && (
                  <GraphPatchRunDetails
                    graphPatch={graphPatch}
                    activeTab={activeGraphRunTab}
                    onActiveTabChange={setActiveGraphRunTab}
                  />
                )}
              </div>
            )}
          </div>
          <div className="modal-card-image">
            {getImageUri(card) ? <img src={getImageUri(card)} alt="" /> : <div className="missing-card-art">{card.name}</div>}
          </div>
        </div>
        <div className="modal-analysis-region">
          {activeModalTab === "analysis" && (
            analysis ? (
              <div className="modal-analysis">
                <AnalysisRenderer deck={deck} analysis={analysis} onSelectCard={onSelectCard} hoverPreview={hoverPreview} onDeleteNode={onDeleteAnalysisNode} />
              </div>
            ) : (
              <div className="modal-analysis-empty">
                Press Analyze Card to generate this card's deck-aware analysis here.
              </div>
            )
          )}

          {activeModalTab === "graph" && (
            graph ? (
              <DeckGraphView
                deck={deck}
                graph={graph}
                selectedNodeId={selectedModalGraphNodeId}
                hiddenNodeIds={[]}
                isAnalyzing={false}
                title="Graph"
                className="modal-graph-workspace"
                showFocusToggle
                onSelectNode={setSelectedModalGraphNodeId}
                onOpenCard={onSelectCard}
                onDeleteEdge={onDeleteGraphEdge}
                onDeleteEdges={onDeleteGraphEdges}
                onCopyConnectionsJson={graphPatch ? () => void copyGraphPatchJson() : undefined}
                onDeleteConnectionsPatch={graphPatch ? onClearCardGraphPatch : undefined}
                hoverPreview={hoverPreview}
              />
            ) : (
              <div className="modal-analysis-empty">The graph will appear after the deck graph is generated.</div>
            )
          )}
        </div>
      </article>
    </div>
  );
}

function CommanderConfirmPanel({
  candidates,
  onChoose,
  hoverPreview,
}: {
  candidates: DeckEntry[];
  onChoose: (cardId: string) => void;
  hoverPreview?: HoverPreviewHandlers;
}) {
  return (
    <section className="commander-confirm">
      <div className="section-header">
        <div>
          <h2>Choose Commander</h2>
          <p>The import did not include a Commander heading. Pick the commander from likely legendary creatures.</p>
        </div>
      </div>
      <div className="commander-candidates">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onChoose(candidate.id)}
            onMouseEnter={(event) => hoverPreview?.show(candidate.id, event.currentTarget)}
            onMouseLeave={hoverPreview?.hide}
            onFocus={(event) => hoverPreview?.show(candidate.id, event.currentTarget)}
            onBlur={hoverPreview?.hide}
          >
            {getImageUri(candidate) && <img src={getImageUri(candidate)} alt="" />}
            <span>
              <strong>{candidate.name}</strong>
              <em>{getPrimaryTypeLine(candidate)}</em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function GraphPatchRunDetails({
  graphPatch,
  activeTab,
  onActiveTabChange,
}: {
  graphPatch: DeckGraphPatch;
  activeTab: "prompt" | "reasoning";
  onActiveTabChange: (tab: "prompt" | "reasoning") => void;
}) {
  const hasPrompt = Boolean(graphPatch.promptText?.trim());
  const hasReasoning = Boolean(graphPatch.reasoningSummary?.trim());
  if (!hasPrompt && !hasReasoning && graphPatch.generationTimeMs === undefined) return null;
  const activeContent =
    activeTab === "prompt"
      ? graphPatch.promptText?.trim() || "No prompt text was captured for this graph analysis."
      : graphPatch.reasoningSummary?.trim() || "No reasoning summary was captured for this graph analysis.";

  return (
    <div className="graph-run-details">
      {graphPatch.generationTimeMs !== undefined && (
        <div className="graph-run-meta">
          Generated in <strong>{formatDuration(graphPatch.generationTimeMs)}</strong>
        </div>
      )}
      {(hasPrompt || hasReasoning) && (
        <>
          <div className="tab-row graph-run-tabs" role="tablist" aria-label="Card graph analysis run details">
            <button type="button" className={activeTab === "prompt" ? "active" : ""} onClick={() => onActiveTabChange("prompt")}>
              Prompt
            </button>
            <button type="button" className={activeTab === "reasoning" ? "active" : ""} onClick={() => onActiveTabChange("reasoning")}>
              Reasoning
            </button>
          </div>
          <pre className="graph-run-text">{activeContent}</pre>
        </>
      )}
    </div>
  );
}

function CardHoverPreview({ card, left, top }: { card: DeckEntry; left: number; top: number }) {
  const imageUri = getImageUri(card);
  return (
    <aside className="card-hover-preview" style={{ left, top }} aria-hidden="true">
      {imageUri ? <img src={imageUri} alt="" /> : <div className="hover-preview-fallback">{card.name}</div>}
      <div className="hover-preview-caption">
        <strong>{card.name}</strong>
        <span>{getPrimaryTypeLine(card) || "Unresolved card"}</span>
      </div>
    </aside>
  );
}

function getPreviewPosition(anchor: DOMRect): { left: number; top: number } {
  const width = 292;
  const height = 430;
  const margin = 14;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const preferredLeft = anchor.right + margin;
  const fallbackLeft = anchor.left - width - margin;
  const left = preferredLeft + width > viewportWidth ? Math.max(margin, fallbackLeft) : preferredLeft;
  const preferredTop = anchor.top;
  const top = preferredTop + height > viewportHeight ? Math.max(margin, viewportHeight - height - margin) : Math.max(margin, preferredTop);
  return { left, top };
}

function removeLayoutNodeAtPath(layout: AnalysisLayoutNode, path: AnalysisNodePath): AnalysisLayoutNode {
  return removeChildAtPath(layout, path) as AnalysisLayoutNode;
}

function removeChildAtPath(value: unknown, path: AnalysisNodePath): unknown {
  if (path.length < 2 || !isRecord(value)) return value;
  const [key, index, ...rest] = path;
  if (typeof key !== "string" || typeof index !== "number") return value;
  const collection = value[key];
  if (!Array.isArray(collection)) return value;
  const nextCollection = rest.length
    ? collection.map((item, itemIndex) => (itemIndex === index ? removeChildAtPath(item, rest) : item))
    : collection.filter((_, itemIndex) => itemIndex !== index);
  return { ...value, [key]: nextCollection };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mergeDeckGraphPatches(existing: DeckGraphPatch | undefined, incoming: DeckGraphPatch): DeckGraphPatch {
  if (!existing) return incoming;
  return {
    ...incoming,
    id: existing.id,
    nodesToUpsert: mergeById(existing.nodesToUpsert, incoming.nodesToUpsert),
    edgesToUpsert: mergeById(existing.edgesToUpsert.map(normalizeDeckGraphEdgeId), incoming.edgesToUpsert.map(normalizeDeckGraphEdgeId)),
    edgeFunctions: mergeById(existing.edgeFunctions ?? [], incoming.edgeFunctions ?? []),
    nodeIdsToRemove: Array.from(new Set([...(existing.nodeIdsToRemove ?? []), ...(incoming.nodeIdsToRemove ?? [])])),
    edgeIdsToRemove: Array.from(new Set([...(existing.edgeIdsToRemove ?? []), ...(incoming.edgeIdsToRemove ?? [])])),
    notes: [...existing.notes, ...incoming.notes],
    generationTimeMs: incoming.generationTimeMs ?? existing.generationTimeMs,
    promptText: incoming.promptText ?? existing.promptText,
    reasoningSummary: incoming.reasoningSummary ?? existing.reasoningSummary,
    generatedAt: new Date().toISOString(),
  };
}

function withGraphPatchRunFallbacks(
  patch: DeckGraphPatch,
  generationTimeMs: number,
  promptText: string,
  reasoningSummary: string,
): DeckGraphPatch {
  return {
    ...patch,
    generationTimeMs: patch.generationTimeMs ?? generationTimeMs,
    promptText: patch.promptText?.trim() ? patch.promptText : promptText,
    reasoningSummary: patch.reasoningSummary?.trim() ? patch.reasoningSummary : summarizeGraphPatchExecution(patch, reasoningSummary),
  };
}

function summarizeGraphPatchExecution(patch: DeckGraphPatch, fallback: string): string {
  const lines: string[] = [];
  if (patch.cardId) lines.push(`- looked at selected card ${patch.cardId} as the graph focus`);
  const conceptNodes = patch.nodesToUpsert.filter((node) => node.kind !== "card");
  conceptNodes.slice(0, 3).forEach((node) => {
    lines.push(`- made ${node.kind} node "${node.label}"`);
  });
  patch.edgesToUpsert.slice(0, 4).forEach((edge) => {
    const group = edge.connectionGroup ? ` (${edge.connectionGroup})` : "";
    lines.push(`- added ${edge.kind}${group} edge ${edge.sourceId} -> ${edge.targetId}`);
  });
  patch.edgeFunctions?.slice(0, 4).forEach((edgeFunction) => {
    const target = edgeFunction.targetId ? ` to ${edgeFunction.targetId}` : edgeFunction.sourceId ? ` from ${edgeFunction.sourceId}` : "";
    const group = edgeFunction.connectionGroup ? ` for ${edgeFunction.connectionGroup}` : "";
    lines.push(`- made edgeFunction ${edgeFunction.id}${target}${group}`);
  });
  patch.notes.slice(0, 3).forEach((note) => {
    if (!lines.some((line) => line.includes(note))) lines.push(`- noted ${note}`);
  });
  return lines.length ? lines.slice(0, 8).join("\n") : fallback;
}

function makeClientGraphPatchPromptText(task: string, deckName: string, cardId?: string, prompt?: string): string {
  return [
    `Task: ${task}`,
    `Deck: ${deckName}`,
    cardId ? `Selected card id: ${cardId}` : undefined,
    prompt ? `Custom prompt: ${prompt}` : "Custom prompt: (none)",
    "Use the current deck snapshot and graph to produce a DeckGraphPatch.",
  ].filter(Boolean).join("\n");
}

function makeClientGraphPatchReasoning(kind: "card" | "card-lite" | "deck"): string {
  if (kind === "card") {
    return [
      "1. Read the selected card as the graph focus.",
      "2. Compared it against current graph context and deck card relationships.",
      "3. Returned graph patch nodes, edges, and edge functions for the strongest matches.",
    ].join("\n");
  }
  if (kind === "card-lite") {
    return [
      "- looked at the selected card by itself",
      "- skipped deck pool and graph context",
      "- returned only reusable edgeFunctions inferred from that card",
    ].join("\n");
  }
  return [
    "1. Read the deck and graph as a whole.",
    "2. Looked for broad graph-worthy packages and reusable selectors.",
    "3. Returned a deck-level graph patch for the strongest groupings.",
  ].join("\n");
}

function formatGraphPatchUsage(graphPatch: DeckGraphPatch): string {
  const usage = graphPatch.usage;
  if (!usage) return "";
  if (usage.reportedTotalTokens) return ` Tokens used: ${formatCount(usage.reportedTotalTokens)}.`;
  return ` Estimated tokens used: ${formatCount(usage.totalTokensEstimate)} (${formatCount(usage.promptTokensEstimate + usage.contextFileTokensEstimate)} in, ${formatCount(usage.outputTokensEstimate)} out).`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatDeleteEdgeConfirmation(graph: DeckGraph, edge: DeckGraph["edges"][number]): string {
  const sourceLabel = graph.nodes.find((node) => node.id === edge.sourceId)?.label ?? edge.sourceId;
  const targetLabel = graph.nodes.find((node) => node.id === edge.targetId)?.label ?? edge.targetId;
  return `Delete this ${edge.kind.replace("_", " ")} edge?\n\n${sourceLabel} -> ${targetLabel}`;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function makeQuestionThreadTitle(question: string): string {
  const title = question.replace(/\s+/g, " ").trim();
  if (!title) return "Untitled chat";
  return title.length > 48 ? `${title.slice(0, 45)}...` : title;
}

function formatQuestionThreadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function makeArchidektSource(imported: ArchidektImport, lastSyncedAt = new Date().toISOString()): DeckSnapshot["source"] {
  return {
    type: "archidekt",
    url: imported.url,
    deckId: imported.deckId,
    name: imported.name,
    lastSyncedAt,
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  existing.forEach((item) => byId.set(item.id, item));
  incoming.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

function findCommander(entries: DeckEntry[], commanderName?: string): DeckEntry | undefined {
  if (commanderName) {
    const targetSlug = slugify(commanderName);
    const exact = entries.find((entry) => slugify(entry.name) === targetSlug);
    if (exact) return exact;
  }
  return entries.find((entry) => entry.section?.toLowerCase() === "commander");
}

function findCommanderCandidates(entries: DeckEntry[]): DeckEntry[] {
  return entries.filter((entry) => {
    const typeLine = getPrimaryTypeLine(entry).toLowerCase();
    return typeLine.includes("legendary") && typeLine.includes("creature");
  });
}

function findLatestCardAnalysis(analyses: AnalysisResult[], cardId: string): AnalysisResult | undefined {
  return analyses.find((analysis) => {
    if (analysis.kind !== "card-analysis") return false;
    return (analysis.subjectCardId ?? findSubjectCardId(analysis.layout)) === cardId;
  });
}

function findLatestGraphNodeAnalysis(analyses: AnalysisResult[], nodeId: string): AnalysisResult | undefined {
  return analyses.find((analysis) => analysis.kind === "graph-node-analysis" && analysis.subjectGraphNodeId === nodeId);
}

function findSubjectCardId(layout: AnalysisLayoutNode): string | undefined {
  if (layout.type === "CardDescription") return layout.cardId;
  if (layout.type === "stack") {
    for (const child of layout.children) {
      const cardId = findSubjectCardId(child);
      if (cardId) return cardId;
    }
  }
  if (layout.type === "twoColumn") {
    for (const child of [...layout.left, ...layout.right]) {
      const cardId = findSubjectCardId(child);
      if (cardId) return cardId;
    }
  }
  if (layout.type === "tabs") {
    for (const tab of layout.tabs) {
      for (const child of tab.children) {
        const cardId = findSubjectCardId(child);
        if (cardId) return cardId;
      }
    }
  }
  return undefined;
}
