import { DeckGraphPatch } from "../deck/deckGraph";
import { AnalysisResult, CardAnalysisInput, CardGraphAnalysisInput, DeckAnalysisInput, FreeformDeckQuestionInput } from "./analysisSchema";

export interface AnalysisProvider {
  analyzeDeck(input: DeckAnalysisInput): Promise<AnalysisResult>;
  analyzeCard(input: CardAnalysisInput): Promise<AnalysisResult>;
  analyzeCardGraph(input: CardGraphAnalysisInput): Promise<DeckGraphPatch>;
  answerQuestion(input: FreeformDeckQuestionInput): Promise<AnalysisResult>;
}
