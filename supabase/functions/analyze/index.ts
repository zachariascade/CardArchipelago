type AnalysisAction =
  | "analyzeDeck"
  | "analyzeCard"
  | "analyzeDeckGraph"
  | "analyzeCardGraph"
  | "analyzeCardGraphLite"
  | "answerQuestion";

type AnalyzeRequest = {
  action?: AnalysisAction;
  input?: unknown;
  options?: {
    model?: string;
    codexModel?: string;
  };
};

const allowedActions: AnalysisAction[] = [
  "analyzeDeck",
  "analyzeCard",
  "analyzeDeckGraph",
  "analyzeCardGraph",
  "analyzeCardGraphLite",
  "answerQuestion",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Use POST /analyze." }, 405);
  }

  try {
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiApiKey) throw new Error("OPENAI_API_KEY is not configured.");

    const body = (await request.json()) as AnalyzeRequest;
    if (!body.action || !allowedActions.includes(body.action)) {
      throw new Error("Invalid action.");
    }

    const model = body.options?.model ?? body.options?.codexModel ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-5";
    const prompt = buildAnalysisPrompt(body.action, body.input);
    const startedAt = performance.now();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "mtg_deck_analysis",
            strict: false,
            schema: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(await readOpenAiError(response));
    }

    const result = await response.json();
    const outputText = extractOutputText(result);
    const parsed = JSON.parse(outputText);

    return jsonResponse({
      ...parsed,
      generationTimeMs: parsed.generationTimeMs ?? Math.max(0, Math.round(performance.now() - startedAt)),
      source: parsed.source ?? "openai",
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Analysis failed.",
      },
      400,
    );
  }
});

function buildAnalysisPrompt(action: AnalysisAction, input: unknown): string {
  return [
    "You are the hosted AI analysis backend for an MTG Commander deck analysis app.",
    "Return only JSON. Do not wrap it in markdown.",
    "The JSON must match the app's existing analysis or graph patch shape for the requested action.",
    "For analyzeDeck, analyzeCard, and answerQuestion, return an AnalysisResult object.",
    "For analyzeDeckGraph, analyzeCardGraph, and analyzeCardGraphLite, return a DeckGraphPatch object.",
    "Use source \"openai\" for AnalysisResult objects and source \"ai\" for DeckGraphPatch objects.",
    "",
    `Action: ${action}`,
    "",
    "Input JSON:",
    JSON.stringify(input),
  ].join("\n");
}

function extractOutputText(response: unknown): string {
  if (isRecord(response) && typeof response.output_text === "string") {
    return response.output_text;
  }

  if (isRecord(response) && Array.isArray(response.output)) {
    const text = response.output
      .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
      .map((content) => (isRecord(content) && typeof content.text === "string" ? content.text : ""))
      .join("");
    if (text) return text;
  }

  throw new Error("OpenAI response did not include output text.");
}

async function readOpenAiError(response: Response): Promise<string> {
  try {
    const value = await response.json();
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") {
      return value.error.message;
    }
  } catch {
    // Fall through to the status message.
  }
  return `OpenAI request failed with ${response.status}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
