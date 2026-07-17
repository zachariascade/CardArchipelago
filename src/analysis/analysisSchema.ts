import { DeckSnapshot } from "../deck/deckModel";
import { DeckGraph } from "../deck/deckGraph";
import { DeckQuery, DeckQueryCapability } from "../deck/deckQueries";

export type AnalysisSource = "mock" | "codex-local" | "openai" | "custom";

export type AnalysisResultKind = "deck-overview" | "card-analysis" | "graph-node-analysis" | "freeform";

export type DeckAnalysisInput = {
  deck: DeckSnapshot;
  availableQueries: DeckQueryCapability[];
  prompt?: string;
};

export type CardAnalysisInput = {
  deck: DeckSnapshot;
  cardId: string;
  availableQueries: DeckQueryCapability[];
  prompt?: string;
};

export type CardGraphAnalysisInput = {
  deck: DeckSnapshot;
  graph: DeckGraph;
  cardId: string;
  availableQueries: DeckQueryCapability[];
  prompt?: string;
};

export type DeckGraphAnalysisInput = {
  deck: DeckSnapshot;
  graph: DeckGraph;
  availableQueries: DeckQueryCapability[];
  prompt?: string;
};

export type FreeformDeckQuestionInput = {
  deck: DeckSnapshot;
  question: string;
  availableQueries: DeckQueryCapability[];
};

export type EvidenceItem = {
  claim: string;
  cardIds?: string[];
  query?: DeckQuery;
  note?: string;
};

export type CardMemory = {
  oracleId: string;
  tags: string[];
  roleNotes: string[];
  relatedQueries: DeckQuery[];
  generatedAt: string;
  source: AnalysisSource | "user";
};

export type AnalysisComponentNode =
  | CardDescriptionNode
  | CardListNode
  | GroupedCardListNode
  | StatBlockNode
  | ManaCurveChartNode
  | ColorPipChartNode
  | TypeBreakdownChartNode
  | TagBreakdownNode
  | EvidenceListNode
  | NarrativePanelNode;

export type AnalysisLayoutNode =
  | { type: "stack"; children: AnalysisLayoutNode[] }
  | { type: "twoColumn"; left: AnalysisLayoutNode[]; right: AnalysisLayoutNode[]; ratio?: "1:1" | "2:1" | "1:2" }
  | { type: "tabs"; tabs: { label: string; children: AnalysisLayoutNode[] }[] }
  | AnalysisComponentNode;

export type CardDescriptionNode = {
  type: "CardDescription";
  cardId: string;
};

export type CardListNode = {
  type: "CardList";
  title: string;
  query?: DeckQuery;
  cardIds?: string[];
  emptyText?: string;
};

export type GroupedCardListNode = {
  type: "GroupedCardList";
  groups: CardListNode[];
};

export type StatBlockNode = {
  type: "StatBlock";
  stats: {
    label: string;
    value?: string | number;
    query?: DeckQuery;
  }[];
};

export type ManaCurveChartNode = {
  type: "ManaCurveChart";
  title?: string;
};

export type ColorPipChartNode = {
  type: "ColorPipChart";
  title?: string;
};

export type TypeBreakdownChartNode = {
  type: "TypeBreakdownChart";
  title?: string;
};

export type TagBreakdownNode = {
  type: "TagBreakdown";
  title?: string;
  tags: { label: string; count: number }[];
};

export type EvidenceListNode = {
  type: "EvidenceList";
  title?: string;
};

export type NarrativePanelNode = {
  type: "NarrativePanel";
  title?: string;
  body: string;
};

export type AnalysisResult = {
  id: string;
  kind: AnalysisResultKind;
  subjectCardId?: string;
  subjectGraphNodeId?: string;
  title: string;
  summary?: string;
  layout: AnalysisLayoutNode;
  evidence?: EvidenceItem[];
  suggestedCardMemory?: CardMemory[];
  createdAt: string;
  source: AnalysisSource;
};
