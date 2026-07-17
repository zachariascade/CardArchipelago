import { useEffect, useMemo, useState } from "react";
import { Brain, Copy, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { AnalysisLayoutNode, AnalysisResult } from "../analysis/analysisSchema";
import { LocalEndpointAnalysisProvider } from "../analysis/LocalEndpointAnalysisProvider";
import { MockAnalysisProvider } from "../analysis/MockAnalysisProvider";
import { AnalysisRenderer, type AnalysisNodePath } from "../components/analysis-renderer/AnalysisRenderer";
import { DeckGraphView } from "../components/deck-graph/DeckGraphView";
import { DeckGrid, FilterMode, SortMode } from "../components/deck-grid/DeckGrid";
import { DEFAULT_DECKLIST, ImportPanel } from "../components/import/ImportPanel";
import { UnresolvedResolverPanel } from "../components/unresolved-resolver/UnresolvedResolverPanel";
import { DeckEntry, DeckSnapshot, ScryfallCard, getImageUri, getPrimaryTypeLine } from "../deck/deckModel";
import { DeckGraph, DeckGraphPatch, DeckGraphVariant, applyGraphPatches, buildDeckGraph, buildEnrichedDeckGraph } from "../deck/deckGraph";
import { availableQueries, getCardById, getCommander } from "../deck/deckQueries";
import { parseDecklist } from "../deck/parseDecklist";
import { hydrateDeckEntries, slugify } from "../deck/scryfall";
import { ProviderConfig, StoredDeckGraphState, loadStoredState, saveStoredState } from "../storage/localDeckStorage";

const EDGE_DELETIONS_PATCH_KEY = "__edge_deletions__";

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
  const [decks, setDecks] = useState<DeckSnapshot[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | undefined>();
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [modalCardId, setModalCardId] = useState<string | undefined>();
  const [analysesByDeckId, setAnalysesByDeckId] = useState<Record<string, AnalysisResult[]>>({});
  const [graphStateByDeckId, setGraphStateByDeckId] = useState<Record<string, StoredDeckGraphState>>({});
  const [graphPatchesByDeckId, setGraphPatchesByDeckId] = useState<Record<string, Record<string, DeckGraphPatch>>>({});
  const [graphPatchErrorsByCardId, setGraphPatchErrorsByCardId] = useState<Record<string, string>>({});
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({ mode: "mock", endpointUrl: "http://localhost:8787/analyze" });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [graphAnalyzingCardId, setGraphAnalyzingCardId] = useState<string>();
  const [pendingImport, setPendingImport] = useState<{ deck: DeckSnapshot; candidates: DeckEntry[] }>();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("category");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortAscending, setSortAscending] = useState(true);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [cardPreview, setCardPreview] = useState<CardPreviewState>();
  const [activeView, setActiveView] = useState<"import" | "deck" | "analysis" | "graph">("deck");

  useEffect(() => {
    const stored = loadStoredState();
    setDecks(stored.decks);
    setActiveDeckId(stored.activeDeckId);
    setSelectedCardId(stored.selectedCardId);
    setAnalysesByDeckId(stored.analysesByDeckId);
    setGraphStateByDeckId(stored.graphStateByDeckId);
    setGraphPatchesByDeckId(stored.graphPatchesByDeckId);
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
      selectedCardId,
      selectedGraphNodeId: activeDeckId ? graphStateByDeckId[activeDeckId]?.selectedNodeId : undefined,
      analyses: [],
      providerConfig,
    });
  }, [decks, activeDeckId, analysesByDeckId, graphStateByDeckId, graphPatchesByDeckId, selectedCardId, providerConfig, hasLoadedStorage]);

  const provider = useMemo(() => {
    if (providerConfig.mode === "local") return new LocalEndpointAnalysisProvider(providerConfig.endpointUrl);
    return new MockAnalysisProvider();
  }, [providerConfig]);

  const deck = useMemo(() => decks.find((savedDeck) => savedDeck.id === activeDeckId), [decks, activeDeckId]);
  const analyses = deck ? analysesByDeckId[deck.id] ?? [] : [];
  const activeGraphState = deck ? graphStateByDeckId[deck.id] ?? {} : {};
  const graphVariant = activeGraphState.variant ?? "base";
  const baseDeckGraph = useMemo(() => (deck ? buildDeckGraph(deck) : undefined), [deck]);
  const deckGraphPatches = useMemo(() => (deck ? Object.values(graphPatchesByDeckId[deck.id] ?? {}) : []), [deck, graphPatchesByDeckId]);
  const deckGraphPatchCount = deck ? Object.keys(graphPatchesByDeckId[deck.id] ?? {}).filter((key) => key !== EDGE_DELETIONS_PATCH_KEY).length : 0;
  const enrichedDeckGraph = useMemo(() => (deck ? applyGraphPatches(buildEnrichedDeckGraph(deck), deckGraphPatches, deck) : undefined), [deck, deckGraphPatches]);
  const deckGraph = graphVariant === "ai-enriched" ? enrichedDeckGraph : baseDeckGraph;
  const modalCard = deck && modalCardId ? getCardById(deck, modalCardId) : undefined;
  const previewCard = deck && cardPreview ? getCardById(deck, cardPreview.cardId) : undefined;
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

  async function importDeck() {
    setIsImporting(true);
    setImportMessage("Parsing decklist...");
    setWarnings([]);
    setUnresolvedNames([]);
    try {
      const parsed = parseDecklist(deckText);
      setWarnings(parsed.warnings);
      setImportMessage("Fetching Scryfall card data...");
      const result = await hydrateDeckEntries(parsed);
      setUnresolvedNames(result.unresolvedNames);
      const commanderEntry = findCommander(result.entries, parsed.commanderName);
      const now = new Date().toISOString();
      const nextDeck: DeckSnapshot = {
        id: `deck_${Date.now()}`,
        name: commanderEntry ? `${commanderEntry.name} Deck` : "Imported Commander Deck",
        format: "commander",
        originalText: deckText,
        commanderId: commanderEntry?.id,
        entries: result.entries,
        importedAt: now,
        updatedAt: now,
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
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
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
        variant: "base",
      },
    }));
    setActiveView("deck");
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
        variant: current[deckId]?.variant ?? "base",
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
    await runAnalysis(async () => {
      const result = await provider.answerQuestion({
        deck,
        availableQueries,
        question: `Analyze the graph node "${node.label}" (${node.kind}) in this Commander deck. Explain the cards that support it, the strongest connections, weak points, and what to inspect next.`,
      });
      return {
        ...result,
        id: `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "graph-node-analysis",
        subjectGraphNodeId: node.id,
        title: `${node.label} Graph Analysis`,
        summary: node.summary,
      };
    });
  }

  async function analyzeCardGraph(cardId: string, prompt?: string) {
    if (!deck || !enrichedDeckGraph) return;
    const trimmedPrompt = prompt?.trim();
    setGraphAnalyzingCardId(cardId);
    try {
      const patch = await provider.analyzeCardGraph({ deck, graph: enrichedDeckGraph, cardId, availableQueries, prompt: trimmedPrompt });
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
          variant: "ai-enriched",
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

  function clearAllDeckGraphPatches() {
    if (!deck || deckGraphPatchCount === 0) return;
    const confirmed = window.confirm(`Delete all ${deckGraphPatchCount} saved AI graph patch${deckGraphPatchCount === 1 ? "" : "es"} for ${deck.name}?`);
    if (!confirmed) return;
    setGraphPatchesByDeckId((current) => {
      const deletionPatch = current[deck.id]?.[EDGE_DELETIONS_PATCH_KEY];
      const nextDeckPatches: Record<string, DeckGraphPatch> = {};
      if (deletionPatch) nextDeckPatches[EDGE_DELETIONS_PATCH_KEY] = deletionPatch;
      return {
        ...current,
        [deck.id]: nextDeckPatches,
      };
    });
  }

  function deleteGraphEdge(edgeId: string) {
    if (!deck || !deckGraph) return;
    const edge = deckGraph.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const sourceLabel = deckGraph.nodes.find((node) => node.id === edge.sourceId)?.label ?? edge.sourceId;
    const targetLabel = deckGraph.nodes.find((node) => node.id === edge.targetId)?.label ?? edge.targetId;
    const confirmed = window.confirm(`Delete this ${edge.kind.replace("_", " ")} edge?\n\n${sourceLabel} -> ${targetLabel}`);
    if (!confirmed) return;
    setGraphPatchesByDeckId((current) => {
      const deckPatches = current[deck.id] ?? {};
      const currentPatch = deckPatches[EDGE_DELETIONS_PATCH_KEY];
      const removedIds = Array.from(new Set([...(currentPatch?.edgeIdsToRemove ?? []), edgeId]));
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

  function setGraphVariant(variant: DeckGraphVariant) {
    if (!deck) return;
    const nextGraph = variant === "ai-enriched" ? enrichedDeckGraph : baseDeckGraph;
    setGraphStateByDeckId((current) => {
      const currentState = current[deck.id] ?? {};
      const currentSelection = currentState.selectedNodeId;
      const selectionExists = currentSelection ? nextGraph?.nodes.some((node) => node.id === currentSelection) : false;
      return {
        ...current,
        [deck.id]: {
          ...currentState,
          variant,
          selectedNodeId: selectionExists ? currentSelection : nextGraph?.nodes[0]?.id,
        },
      };
    });
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
    setIsAnalyzing(true);
    try {
      const result = await action();
      if (!deck) return;
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [result, ...(current[deck.id] ?? [])],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed.";
      if (!deck) return;
      setAnalysesByDeckId((current) => ({
        ...current,
        [deck.id]: [
          {
          id: `error_${Date.now()}`,
          kind: "freeform",
          title: "Analysis Failed",
          summary: message,
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
        <button type="button" className={activeView === "graph" ? "active" : ""} onClick={() => setActiveView("graph")}>
          Graph
        </button>
      </nav>

      {activeView === "import" && (
        <>
          <ImportPanel
            deckText={deckText}
            isImporting={isImporting}
            importMessage={importMessage}
            warnings={warnings}
            unresolvedNames={unresolvedNames}
            onDeckTextChange={setDeckText}
            onImport={importDeck}
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
            </section>
          )}

          {deck && (
            <section className="deck-summary-band">
              <div>
                <span>Commander</span>
                <strong>{commander?.name ?? "Choose one"}</strong>
              </div>
              <div>
                <span>Unique Cards</span>
                <strong>{deck.entries.length}</strong>
              </div>
              <div>
                <span>Total Cards</span>
                <strong>{deck.entries.reduce((sum, entry) => sum + entry.quantity, 0)}</strong>
              </div>
              <button type="button" className="primary-button" onClick={analyzeDeck} disabled={isAnalyzing}>
                <Brain size={17} />
                Analyze Deck
              </button>
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

      {activeView === "graph" && (
        deck && deckGraph ? (
          <DeckGraphView
            deck={deck}
            graph={deckGraph}
            selectedNodeId={selectedGraphNodeId}
            hiddenNodeIds={activeGraphState.hiddenNodeIds ?? []}
            isAnalyzing={isAnalyzing || graphAnalyzingCardId === selectedGraphNode?.cardId}
            latestAnalysis={latestGraphNodeAnalysis}
            graphVariant={graphVariant}
            onSelectNode={selectGraphNode}
            onGraphVariantChange={setGraphVariant}
            onOpenCard={openCardModal}
            onAnalyzeNode={(nodeId) => void analyzeGraphNode(nodeId)}
            onPromptAnalyzeNode={(nodeId, prompt) => void analyzeGraphNodePrompt(nodeId, prompt)}
            onHideNode={hideGraphNode}
            onDeleteEdge={deleteGraphEdge}
            onResetHiddenNodes={resetHiddenGraphNodes}
            toolbarActions={
              <button type="button" className="secondary-button" onClick={clearAllDeckGraphPatches} disabled={deckGraphPatchCount === 0}>
                <Trash2 size={16} />
                Clear AI Patches
              </button>
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
          onClearCardGraphPatch={() => clearCardGraphPatch(modalCard.id)}
          onDeleteGraphEdge={deleteGraphEdge}
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
  onClearCardGraphPatch,
  onDeleteGraphEdge,
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
  onClearCardGraphPatch: () => void;
  onDeleteGraphEdge: (edgeId: string) => void;
  onSelectCard: (cardId: string) => void;
  hoverPreview: HoverPreviewHandlers;
  onDeleteAnalysisNode?: (path: AnalysisNodePath) => void;
  onClose: () => void;
}) {
  const [activeModalTab, setActiveModalTab] = useState<"analysis" | "graph">("graph");
  const [selectedModalGraphNodeId, setSelectedModalGraphNodeId] = useState(`card:${card.id}`);
  const [patchCopyStatus, setPatchCopyStatus] = useState<string>();
  const [graphPrompt, setGraphPrompt] = useState("");

  useEffect(() => {
    setSelectedModalGraphNodeId(`card:${card.id}`);
    setPatchCopyStatus(undefined);
    setGraphPrompt("");
  }, [card.id, graph?.variant]);

  useEffect(() => {
    setActiveModalTab("graph");
  }, [card.id]);

  async function copyGraphPatchJson() {
    if (!graphPatch) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(graphPatch, null, 2));
      setPatchCopyStatus("Patch JSON copied.");
    } catch {
      setPatchCopyStatus("Could not copy patch JSON.");
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
              <>
                <div className="modal-graph-actions">
                  <button type="button" className="primary-button" onClick={() => onAnalyzeCardGraph()} disabled={isAnalyzingGraph}>
                    <Brain size={16} />
                    {isAnalyzingGraph ? "Analyzing Graph..." : "Analyze Card Graph"}
                  </button>
                  {graphPatch && (
                    <>
                      <button type="button" className="secondary-button" onClick={() => void copyGraphPatchJson()} disabled={isAnalyzingGraph}>
                        <Copy size={16} />
                        Copy Patch JSON
                      </button>
                      <button type="button" className="secondary-button" onClick={onClearCardGraphPatch} disabled={isAnalyzingGraph}>
                        <X size={16} />
                        Clear Patch
                      </button>
                    </>
                  )}
                  <span>
                    {graphError ??
                      patchCopyStatus ??
                      (graphPatch
                        ? `Last graph analysis saved ${graphPatch.edgesToUpsert.length} direct edge${graphPatch.edgesToUpsert.length === 1 ? "" : "s"} and ${graphPatch.edgeFunctions?.length ?? 0} edge function${(graphPatch.edgeFunctions?.length ?? 0) === 1 ? "" : "s"}.`
                        : "Generate AI graph edges, then build up the deck graph card by card.")}
                  </span>
                </div>
                <div className="graph-prompt-panel modal-graph-prompt">
                  <label htmlFor={`modal-graph-prompt-${card.id}`}>
                    <span>Prompt</span>
                    <textarea
                      id={`modal-graph-prompt-${card.id}`}
                      value={graphPrompt}
                      onChange={(event) => setGraphPrompt(event.target.value)}
                      placeholder="Example: create a custom group for every card that can feed this payoff."
                      rows={3}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAnalyzeCardGraph(graphPrompt)}
                    disabled={isAnalyzingGraph || !graphPrompt.trim()}
                  >
                    <Brain size={16} />
                    {isAnalyzingGraph ? "Analyzing..." : "Analyze Prompt"}
                  </button>
                </div>
              </>
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
                showVariantControls={false}
                showFocusToggle
                onSelectNode={setSelectedModalGraphNodeId}
                onOpenCard={onSelectCard}
                onDeleteEdge={onDeleteGraphEdge}
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
    edgesToUpsert: mergeById(existing.edgesToUpsert, incoming.edgesToUpsert),
    edgeFunctions: mergeById(existing.edgeFunctions ?? [], incoming.edgeFunctions ?? []),
    edgeIdsToRemove: Array.from(new Set([...(existing.edgeIdsToRemove ?? []), ...(incoming.edgeIdsToRemove ?? [])])),
    notes: [...existing.notes, ...incoming.notes],
    generatedAt: new Date().toISOString(),
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
