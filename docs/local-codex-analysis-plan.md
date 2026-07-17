# Local Codex Analysis Plan

## Goal

Move from frontend-only mock analysis to real, local-first analysis without exposing API keys in the browser or requiring the React app to call OpenAI directly.

The target shape is:

```txt
React app
  -> local endpoint on this machine
    -> Codex-powered analysis runner
      -> optional model access through the Codex environment
        -> structured AnalysisResult JSON
          -> frontend validation and rendering
```

## Product Priorities

- Keep the app local-first.
- Avoid direct browser-to-OpenAI calls.
- Prioritize synergy discovery.
- For card analysis, answer:
  - what this card does in this deck
  - what cards support it
- Stay descriptive and evidence-backed.
- Do not focus on keep/cut recommendations yet.

## Important Distinction

There are two kinds of “queries” in this system:

1. **App-side deterministic queries**
   - Count lands.
   - Find Wizards.
   - Find artifacts.
   - Find cards whose Oracle text contains `graveyard`.
   - These are reliable, cheap, and already live in the frontend query layer.

2. **Codex/model reasoning**
   - Decide which synergies matter.
   - Identify support packages.
   - Explain why a card matters in the specific deck.
   - Choose which app-native components should render the result.

The model should reason, but the app should still own rendering and deterministic query execution.

## Endpoint Contract

The frontend calls a configurable local endpoint:

```txt
POST http://localhost:8787/analyze
```

Request:

```ts
type LocalAnalysisRequest = {
  action: "analyzeDeck" | "analyzeCard" | "answerQuestion";
  input: DeckAnalysisInput | CardAnalysisInput | FreeformDeckQuestionInput;
};
```

Response:

```ts
type LocalAnalysisResponse = AnalysisResult;
```

The frontend should validate the response before rendering.

## Codex Runner Contract

The local endpoint should delegate to a replaceable runner:

```ts
async function runCodexAnalysis(request: LocalAnalysisRequest): Promise<AnalysisResult> {
  // Initially this can return a fixture or call the existing mock provider.
  // Later this can call Codex, OpenAI through Codex, or a local model.
}
```

Codex should behave like an analysis service:

```txt
input: deck snapshot + request type
output: structured AnalysisResult JSON
```

It should not mutate the app directly.

## Response Rules

The analysis runner must return JSON that matches the existing app contract.

It should:

- Use only predefined layout nodes.
- Use card ids for explicit semantic groups.
- Use live deck queries for objective groups.
- Include evidence for claims.
- Avoid unsupported strategic claims.
- Avoid arbitrary HTML or code.
- Prefer descriptive analysis over prescriptive cut/upgrade advice.

## Validation

Add runtime validation before rendering endpoint responses.

Recommended:

- Add `zod`.
- Define schemas for:
  - `DeckQuery`
  - evidence items
  - layout nodes
  - analysis component nodes
  - `AnalysisResult`

If validation fails:

- Show a clear provider error.
- Keep the previous successful analysis visible.
- Do not crash the renderer.

## Implementation Phases

### Phase 1: Harden The Frontend Provider

- Keep `MockAnalysisProvider`.
- Improve `LocalEndpointAnalysisProvider`.
- Add response validation.
- Add better provider error UI.
- Ensure invalid endpoint output cannot break the app.

### Phase 2: Add Local Endpoint Scaffold

- Add a small local server script.
- Accept `POST /analyze`.
- Return `AnalysisResult`.
- Initially call the existing mock analysis logic or a fixture.
- Confirm the React app can switch from mock mode to local endpoint mode.

### Phase 3: Add Codex Analysis Runner

- Replace the server-side mock function with `runCodexAnalysis`.
- Give Codex the compact deck snapshot, request type, selected card id if relevant, and available query capabilities.
- Require structured JSON output.
- Validate before returning to the frontend.

### Phase 4: Improve Prompting

Deck overview prompt should focus on:

- broad strategy
- commander context
- synergy packages
- card groups with evidence
- query-backed objective panels

Card analysis prompt should focus on:

- what the card does in this deck
- what cards support it
- what packages it belongs to
- evidence-backed synergy claims

### Phase 5: Optional Query Resolution Loop

Later, support a two-step interaction:

1. Model asks the app/server to run deterministic deck queries.
2. App/server resolves them.
3. Model finalizes structured analysis with evidence.

This can improve accuracy, but it is not required for the first real-analysis implementation.

## Recommended Next Step

Start with:

1. Add schema validation.
2. Add local endpoint scaffold.
3. Wire frontend local provider to validated responses.
4. Stub `runCodexAnalysis`.

After that, swap the stub for the actual Codex-powered runner.
