import { AnalysisResult } from "../analysis/analysisSchema";
import { DeckGraphPatch } from "../deck/deckGraph";
import { DeckSnapshot, getEntryBoard } from "../deck/deckModel";

const STORAGE_KEY = "mtg-deck-explorer:v1";

export type ProviderConfig = {
  mode: "mock" | "local" | "hosted";
  endpointUrl: string;
  codexModel: string;
  hostedModel: string;
  codexReasoningEffort: "low" | "medium" | "high";
};

export type StoredDeckGraphState = {
  selectedNodeId?: string;
  hiddenNodeIds?: string[];
};

export type QuestionThreadMessage = {
  id: string;
  question: string;
  response: AnalysisResult;
  createdAt: string;
};

export type QuestionThread = {
  id: string;
  deckId: string;
  title: string;
  messages: QuestionThreadMessage[];
  createdAt: string;
  updatedAt: string;
};

export type StoredAppState = {
  decks: DeckSnapshot[];
  activeDeckId?: string;
  analysesByDeckId: Record<string, AnalysisResult[]>;
  graphStateByDeckId: Record<string, StoredDeckGraphState>;
  graphPatchesByDeckId: Record<string, Record<string, DeckGraphPatch>>;
  questionThreadsByDeckId: Record<string, QuestionThread[]>;
  activeQuestionThreadIdByDeckId: Record<string, string | undefined>;
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
  questionThreadsByDeckId: {},
  activeQuestionThreadIdByDeckId: {},
  analyses: [],
  providerConfig: {
    mode: "mock",
    endpointUrl: "http://localhost:8787/analyze",
    codexModel: "gpt-5.4",
    hostedModel: "gpt-5",
    codexReasoningEffort: "low",
  },
};

export function loadStoredState(): StoredAppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultStoredState;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAppState>;
    const legacyDeck = parsed.deck;
    const rawDecks = parsed.decks?.length ? parsed.decks : legacyDeck ? [legacyDeck] : [];
    const decks = rawDecks.map(normalizeStoredDeck);
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
      questionThreadsByDeckId: parsed.questionThreadsByDeckId ?? {},
      activeQuestionThreadIdByDeckId: parsed.activeQuestionThreadIdByDeckId ?? {},
      providerConfig: {
        ...defaultStoredState.providerConfig,
        ...(parsed.providerConfig ?? {}),
      },
    };
  } catch {
    return defaultStoredState;
  }
}

export function saveStoredState(state: StoredAppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeStoredDeck(deck: DeckSnapshot): DeckSnapshot {
  return {
    ...deck,
    entries: deck.entries.map((entry) => ({
      ...entry,
      board: getEntryBoard(entry),
    })),
  };
}
