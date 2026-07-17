import { AnalysisProvider } from "./AnalysisProvider";
import { DeckGraphPatch } from "../deck/deckGraph";
import { AnalysisResult, CardAnalysisInput, CardGraphAnalysisInput, DeckAnalysisInput, DeckGraphAnalysisInput, FreeformDeckQuestionInput } from "./analysisSchema";
import { validateDeckGraphPatch } from "./graphPatchValidation";
import { validateAnalysisResult } from "./analysisValidation";

export type LocalEndpointAnalysisOptions = {
  codexModel?: string;
  codexReasoningEffort?: "low" | "medium" | "high";
};

export class LocalEndpointAnalysisProvider implements AnalysisProvider {
  constructor(private endpointUrl: string, private options: LocalEndpointAnalysisOptions = {}) {}

  analyzeDeck(input: DeckAnalysisInput): Promise<AnalysisResult> {
    return this.post("analyzeDeck", input);
  }

  analyzeCard(input: CardAnalysisInput): Promise<AnalysisResult> {
    return this.post("analyzeCard", input);
  }

  analyzeDeckGraph(input: DeckGraphAnalysisInput): Promise<DeckGraphPatch> {
    return this.postGraphPatch("analyzeDeckGraph", input);
  }

  analyzeCardGraph(input: CardGraphAnalysisInput): Promise<DeckGraphPatch> {
    return this.postGraphPatch("analyzeCardGraph", input);
  }

  answerQuestion(input: FreeformDeckQuestionInput): Promise<AnalysisResult> {
    return this.post("answerQuestion", input);
  }

  private async post(action: string, input: unknown): Promise<AnalysisResult> {
    const response = await this.fetchEndpoint(action, input);
    if (!response.ok) {
      throw new Error(await getEndpointErrorMessage(response));
    }
    return validateAnalysisResult(await response.json());
  }

  private async postGraphPatch(action: string, input: unknown): Promise<DeckGraphPatch> {
    const response = await this.fetchEndpoint(action, input);
    if (!response.ok) {
      throw new Error(await getEndpointErrorMessage(response));
    }
    return validateDeckGraphPatch(await response.json());
  }

  private async fetchEndpoint(action: string, input: unknown): Promise<Response> {
    try {
      return await fetch(this.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, options: this.options }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      throw new Error(`Could not reach the local analysis endpoint at ${this.endpointUrl}. Start it with MTG_ANALYSIS_RUNNER=codex npm run analysis:server, or switch the provider to Mock AI. (${detail})`);
    }
  }
}

async function getEndpointErrorMessage(response: Response): Promise<string> {
  try {
    const value = await response.json();
    if (value && typeof value.error === "string") return value.error;
  } catch {
    // Fall through to the generic status message.
  }
  return `Local endpoint failed with ${response.status}`;
}
