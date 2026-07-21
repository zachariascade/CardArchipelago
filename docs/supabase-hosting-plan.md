# Supabase Hosting Migration Plan

This document tracks the planned move from a local-first MTG Deck Analyzer to a hosted app with cloud persistence and server-side AI calls.

## Current App Shape

- React/Vite frontend in `src/`.
- App state is stored in browser `localStorage` through `src/storage/localDeckStorage.ts`.
- AI analysis uses either `MockAnalysisProvider` or `LocalEndpointAnalysisProvider`.
- The local analysis endpoint lives in `scripts/analysis-server.mjs`.
- The local endpoint can shell out to the local Codex CLI in Codex-backed mode.
- There is no hosted database, user authentication, or cross-device persistence yet.

## Goals

- Save decks, analyses, graph patches, and question threads across sessions and devices.
- Keep API keys out of browser code.
- Add user-scoped cloud data through Supabase Auth and Postgres.
- Preserve local development and local/offline storage during the migration.
- Move AI analysis behind a hosted server-side endpoint.

## Recommended Phases

### 1. Create A Storage Interface

Status: started. `src/storage/appStorage.ts` now defines `AppStorageRepository` and a `LocalAppStorageRepository` wrapper around the existing local storage behavior. `App.tsx` loads and saves app state through this repository.

Add a repository layer that hides whether storage is local or remote.

Initial methods should cover the existing local state surface:

- `loadAppState`
- `saveDeck`
- `deleteDeck`
- `saveAnalysis`
- `saveGraphPatch`
- `saveQuestionThread`
- `setActiveDeck`

The first implementation can wrap the existing `localStorage` behavior.

### 2. Add Supabase Client And Auth

Status: started. `@supabase/supabase-js` is installed, `.env.example` documents the frontend variables, local env files are ignored, and `src/supabase/client.ts` creates a client only when config is present. `src/supabase/auth.ts` tracks the current Supabase session and supports magic-link sign-in and sign-out.

Create a Supabase project and add frontend environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Add basic authentication and session tracking in the app. Start with email/password or magic link.

### 3. Create Database Schema

Status: started. `supabase/migrations/20260720000000_initial_cloud_storage.sql` defines the first JSONB-heavy cloud schema for decks, analyses, graph patches, question threads, messages, and user app state.

Start with a JSONB-heavy schema to avoid a large rewrite.

Suggested tables:

- `profiles`
- `decks`
- `analyses`
- `graph_patches`
- `question_threads`
- `question_messages`

Suggested shape:

```sql
decks:
  id
  user_id
  name
  commander_name
  snapshot jsonb
  created_at
  updated_at

analyses:
  id
  user_id
  deck_id
  kind
  result jsonb
  created_at

graph_patches:
  id
  user_id
  deck_id
  patch_key
  patch jsonb
  updated_at

question_threads:
  id
  user_id
  deck_id
  title
  created_at
  updated_at

question_messages:
  id
  thread_id
  user_id
  question
  response jsonb
  created_at
```

### 4. Enable Row-Level Security

Status: started. The initial migration enables RLS and adds user-scoped CRUD policies for the proposed user-owned tables.

Turn on row-level security for user-owned tables.

Policies should ensure users can only read and write rows where `user_id = auth.uid()`.

### 5. Implement Supabase Storage

Status: started. `src/storage/supabaseAppStorage.ts` implements the app storage interface against Supabase tables. The app still saves local state to `localStorage` by default, and signed-in users can manually copy the current local state to Supabase or load cloud data back into the app from the header control.

Add a Supabase-backed implementation of the storage interface.

Use local storage when signed out. Use Supabase storage when signed in.

### 6. Add Local-To-Cloud Migration

Status: started. A manual "Copy local data" action now calls the Supabase storage repository for the signed-in user. A manual "Load cloud data" action restores decks, analyses, graph patches, question threads, and app-level selection state. Automatic conflict handling and post-copy cleanup are still pending.

Add a migration flow for existing local data.

Flow:

1. Read current local stored state.
2. Insert decks into Supabase.
3. Insert related analyses, graph patches, and question threads.
4. Confirm migration success.
5. Leave local data in place initially, or mark it as migrated.

### 7. Move AI Calls Server-Side

Status: started. `supabase/functions/analyze/index.ts` defines a Supabase Edge Function that accepts the existing analysis request shape, reads `OPENAI_API_KEY` from server-side secrets, calls the OpenAI Responses API, and returns parsed JSON. It still needs deployment against a real Supabase project and runtime testing with a configured OpenAI key.

Replace the hosted use of the local Codex CLI endpoint with a server-side function.

Likely endpoint:

```txt
POST /functions/v1/analyze
```

The function should:

- Read `OPENAI_API_KEY` from Supabase secrets.
- Accept the same action/input shape used by `LocalEndpointAnalysisProvider`.
- Call the OpenAI API server-side.
- Return validated structured analysis.
- Optionally save the analysis result to Postgres.

### 8. Deploy The Frontend

Deploy the Vite app after Supabase auth and storage are working locally.

Hosted frontend environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ANALYSIS_ENDPOINT`

## Notes

- Keep `localStorage` support during the transition.
- Store the full `DeckSnapshot` as JSONB at first.
- Normalize card data later only if cross-deck querying or reporting requires it.
- Never expose server-side secrets, service-role keys, or OpenAI API keys to the browser.
