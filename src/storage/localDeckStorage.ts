import { AnalysisResult } from "../analysis/analysisSchema";
import { DeckGraphPatch, DeckGraphVariant } from "../deck/deckGraph";
import { DeckSnapshot } from "../deck/deckModel";

const STORAGE_KEY = "mtg-deck-explorer:v1";

export type ProviderConfig = {
  mode: "mock" | "local";
  endpointUrl: string;
};

export type StoredDeckGraphState = {
  selectedNodeId?: string;
  hiddenNodeIds?: string[];
  variant?: DeckGraphVariant;
};

export type StoredAppState = {
  decks: DeckSnapshot[];
  activeDeckId?: string;
  analysesByDeckId: Record<string, AnalysisResult[]>;
  graphStateByDeckId: Record<string, StoredDeckGraphState>;
  graphPatchesByDeckId: Record<string, Record<string, DeckGraphPatch>>;
  deck?: DeckSnapshot;
  selectedCardId?: string;
  selectedGraphNodeId?: string;
  analyses: AnalysisResult[];
  providerConfig: ProviderConfig;
};

export const defaultStoredState: StoredAppState = {
  decks: [],
  analysesByDeckId: {},
  graphStateByDeckId: {},
  graphPatchesByDeckId: {},
  analyses: [],
  providerConfig: {
    mode: "mock",
    endpointUrl: "http://localhost:8787/analyze",
  },
};

export function loadStoredState(): StoredAppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultStoredState;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAppState>;
    const legacyDeck = parsed.deck;
    const decks = parsed.decks?.length ? parsed.decks : legacyDeck ? [legacyDeck] : [];
    const activeDeckId = parsed.activeDeckId ?? legacyDeck?.id ?? decks[0]?.id;
    const analysesByDeckId = {
      ...(legacyDeck && parsed.analyses?.length ? { [legacyDeck.id]: parsed.analyses } : {}),
      ...(parsed.analysesByDeckId ?? {}),
    };
    return {
      ...defaultStoredState,
      ...parsed,
      decks,
      activeDeckId,
      analysesByDeckId,
      graphStateByDeckId: parsed.graphStateByDeckId ?? {},
      graphPatchesByDeckId: parsed.graphPatchesByDeckId ?? {},
    };
  } catch {
    return defaultStoredState;
  }
}

export function saveStoredState(state: StoredAppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
