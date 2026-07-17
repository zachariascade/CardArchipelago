import { AnalysisProvider } from "./AnalysisProvider";
import { DeckGraphPatch } from "../deck/deckGraph";
import { AnalysisResult, CardAnalysisInput, CardGraphAnalysisInput, DeckAnalysisInput, FreeformDeckQuestionInput } from "./analysisSchema";
import { validateDeckGraphPatch } from "./graphPatchValidation";
import { validateAnalysisResult } from "./analysisValidation";

export class LocalEndpointAnalysisProvider implements AnalysisProvider {
  constructor(private endpointUrl: string) {}

  analyzeDeck(input: DeckAnalysisInput): Promise<AnalysisResult> {
    return this.post("analyzeDeck", input);
  }

  analyzeCard(input: CardAnalysisInput): Promise<AnalysisResult> {
    return this.post("analyzeCard", input);
  }

  analyzeCardGraph(input: CardGraphAnalysisInput): Promise<DeckGraphPatch> {
    return this.postGraphPatch("analyzeCardGraph", input);
  }

  answerQuestion(input: FreeformDeckQuestionInput): Promise<AnalysisResult> {
    return this.post("answerQuestion", input);
  }

  private async post(action: string, input: unknown): Promise<AnalysisResult> {
    const response = await fetch(this.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    if (!response.ok) {
      throw new Error(await getEndpointErrorMessage(response));
    }
    return validateAnalysisResult(await response.json());
  }

  private async postGraphPatch(action: string, input: unknown): Promise<DeckGraphPatch> {
    const response = await fetch(this.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    if (!response.ok) {
      throw new Error(await getEndpointErrorMessage(response));
    }
    return validateDeckGraphPatch(await response.json());
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
