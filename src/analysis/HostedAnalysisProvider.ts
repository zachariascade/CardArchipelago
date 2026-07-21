import { AnalysisProvider } from "./AnalysisProvider";
import { AnalysisResult, CardAnalysisInput, CardGraphAnalysisInput, CardGraphLiteAnalysisInput, DeckAnalysisInput, DeckGraphAnalysisInput, FreeformDeckQuestionInput } from "./analysisSchema";
import { validateAnalysisResult } from "./analysisValidation";
import { validateDeckGraphPatch } from "./graphPatchValidation";
import { DeckGraphPatch } from "../deck/deckGraph";
import { supabase } from "../supabase/client";

export type HostedAnalysisOptions = {
  model?: string;
};

export class HostedAnalysisProvider implements AnalysisProvider {
  constructor(private options: HostedAnalysisOptions = {}) {}

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

  analyzeCardGraphLite(input: CardGraphLiteAnalysisInput): Promise<DeckGraphPatch> {
    return this.postGraphPatch("analyzeCardGraphLite", input);
  }

  answerQuestion(input: FreeformDeckQuestionInput): Promise<AnalysisResult> {
    return this.post("answerQuestion", input);
  }

  private async post(action: string, input: unknown): Promise<AnalysisResult> {
    return validateAnalysisResult(await this.invokeFunction(action, input));
  }

  private async postGraphPatch(action: string, input: unknown): Promise<DeckGraphPatch> {
    return validateDeckGraphPatch(await this.invokeFunction(action, input));
  }

  private async invokeFunction(action: string, input: unknown): Promise<unknown> {
    if (!supabase) {
      throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.");
    }

    const { data, error } = await supabase.functions.invoke("analyze", {
      body: {
        action,
        input,
        options: this.options,
      },
    });

    if (error) throw new Error(error.message);
    if (isErrorResponse(data)) throw new Error(data.error);
    return data;
  }
}

function isErrorResponse(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error?: unknown }).error === "string";
}
