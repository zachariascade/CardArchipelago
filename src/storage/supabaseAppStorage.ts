import { AnalysisResult } from "../analysis/analysisSchema";
import { DeckGraphPatch } from "../deck/deckGraph";
import { DeckSnapshot } from "../deck/deckModel";
import { refreshSupabaseSession } from "../supabase/auth";
import { supabase } from "../supabase/client";
import { AppStorageRepository } from "./appStorage";
import { QuestionThread, StoredAppState, defaultStoredState } from "./localDeckStorage";

type SupabaseDeckRow = {
  deck_id: string;
  name: string;
  commander_name: string | null;
  snapshot: DeckSnapshot;
};

type SupabaseAnalysisRow = {
  deck_id: string;
  analysis_id: string;
  kind: string;
  result: AnalysisResult;
};

type SupabaseGraphPatchRow = {
  deck_id: string;
  patch_key: string;
  patch: DeckGraphPatch;
};

type SupabaseQuestionThreadRow = {
  deck_id: string;
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type SupabaseQuestionMessageRow = {
  thread_id: string;
  message_id: string;
  question: string;
  response: AnalysisResult;
  created_at: string;
};

type SupabaseAppStateRow = {
  state: Partial<StoredAppState>;
};

export class SupabaseAppStorageRepository implements AppStorageRepository {
  constructor(private userId: string) {}

  async loadAppState(): Promise<StoredAppState> {
    if (!supabase) throw new Error("Supabase is not configured.");
    await refreshSupabaseSession();

    const [appStateResult, decksResult, analysesResult, graphPatchesResult, questionThreadsResult, questionMessagesResult] = await Promise.all([
      supabase.from("user_app_states").select("state").eq("user_id", this.userId).maybeSingle(),
      supabase.from("decks").select("deck_id, name, commander_name, snapshot").eq("user_id", this.userId),
      supabase.from("analyses").select("deck_id, analysis_id, kind, result").eq("user_id", this.userId),
      supabase.from("graph_patches").select("deck_id, patch_key, patch").eq("user_id", this.userId),
      supabase.from("question_threads").select("deck_id, thread_id, title, created_at, updated_at").eq("user_id", this.userId),
      supabase.from("question_messages").select("thread_id, message_id, question, response, created_at").eq("user_id", this.userId),
    ]);

    assertSupabaseResult(appStateResult.error);
    assertSupabaseResult(decksResult.error);
    assertSupabaseResult(analysesResult.error);
    assertSupabaseResult(graphPatchesResult.error);
    assertSupabaseResult(questionThreadsResult.error);
    assertSupabaseResult(questionMessagesResult.error);

    const appState = ((appStateResult.data as SupabaseAppStateRow | null)?.state ?? {}) as Partial<StoredAppState>;
    const decks = ((decksResult.data ?? []) as SupabaseDeckRow[]).map((row) => row.snapshot);
    const analysesByDeckId = groupAnalysesByDeckId((analysesResult.data ?? []) as SupabaseAnalysisRow[]);
    const graphPatchesByDeckId = groupGraphPatchesByDeckId((graphPatchesResult.data ?? []) as SupabaseGraphPatchRow[]);
    const questionThreadsByDeckId = groupQuestionThreadsByDeckId(
      (questionThreadsResult.data ?? []) as SupabaseQuestionThreadRow[],
      (questionMessagesResult.data ?? []) as SupabaseQuestionMessageRow[],
    );

    return {
      ...defaultStoredState,
      ...appState,
      decks,
      activeDeckId: appState.activeDeckId && decks.some((deck) => deck.id === appState.activeDeckId) ? appState.activeDeckId : decks[0]?.id,
      analysesByDeckId,
      graphStateByDeckId: appState.graphStateByDeckId ?? {},
      graphPatchesByDeckId,
      questionThreadsByDeckId,
      activeQuestionThreadIdByDeckId: appState.activeQuestionThreadIdByDeckId ?? {},
      providerConfig: {
        ...defaultStoredState.providerConfig,
        ...(appState.providerConfig ?? {}),
      },
    };
  }

  async saveAppState(state: StoredAppState): Promise<void> {
    if (!supabase) throw new Error("Supabase is not configured.");
    await refreshSupabaseSession();

    await this.clearUserDataRows();
    await this.upsertAppState(state);
    await this.upsertDecks(state.decks);
    await this.upsertAnalyses(state.analysesByDeckId);
    await this.upsertGraphPatches(state.graphPatchesByDeckId);
    await this.upsertQuestionThreads(state.questionThreadsByDeckId);
  }

  private async clearUserDataRows(): Promise<void> {
    const results = await Promise.all([
      supabase!.from("question_messages").delete().eq("user_id", this.userId),
      supabase!.from("question_threads").delete().eq("user_id", this.userId),
      supabase!.from("graph_patches").delete().eq("user_id", this.userId),
      supabase!.from("analyses").delete().eq("user_id", this.userId),
      supabase!.from("decks").delete().eq("user_id", this.userId),
    ]);

    for (const result of results) {
      assertSupabaseResult(result.error);
    }
  }

  private async upsertAppState(state: StoredAppState): Promise<void> {
    const { error } = await supabase!
      .from("user_app_states")
      .upsert(
        {
          user_id: this.userId,
          state: {
            activeDeckId: state.activeDeckId,
            selectedCardId: state.selectedCardId,
            selectedGraphNodeId: state.selectedGraphNodeId,
            graphStateByDeckId: state.graphStateByDeckId,
            activeQuestionThreadIdByDeckId: state.activeQuestionThreadIdByDeckId,
            providerConfig: state.providerConfig,
          },
        },
        { onConflict: "user_id" },
      );
    assertSupabaseResult(error);
  }

  private async upsertDecks(decks: DeckSnapshot[]): Promise<void> {
    const rows = decks.map((deck) => ({
      user_id: this.userId,
      deck_id: deck.id,
      name: deck.name,
      commander_name: deck.entries.find((entry) => entry.id === deck.commanderId)?.name ?? null,
      snapshot: deck,
    }));
    if (!rows.length) return;

    const { error } = await supabase!
      .from("decks")
      .upsert(rows, { onConflict: "user_id,deck_id" });
    assertSupabaseResult(error);
  }

  private async upsertAnalyses(analysesByDeckId: StoredAppState["analysesByDeckId"]): Promise<void> {
    const rows = Object.entries(analysesByDeckId).flatMap(([deckId, analyses]) =>
      analyses.map((analysis) => ({
        user_id: this.userId,
        deck_id: deckId,
        analysis_id: analysis.id,
        kind: analysis.kind,
        result: analysis,
      })),
    );
    if (!rows.length) return;

    const { error } = await supabase!
      .from("analyses")
      .upsert(rows, { onConflict: "user_id,deck_id,analysis_id" });
    assertSupabaseResult(error);
  }

  private async upsertGraphPatches(graphPatchesByDeckId: StoredAppState["graphPatchesByDeckId"]): Promise<void> {
    const rows = Object.entries(graphPatchesByDeckId).flatMap(([deckId, patchesByKey]) =>
      Object.entries(patchesByKey).map(([patchKey, patch]) => ({
        user_id: this.userId,
        deck_id: deckId,
        patch_key: patchKey,
        patch,
      })),
    );
    if (!rows.length) return;

    const { error } = await supabase!
      .from("graph_patches")
      .upsert(rows, { onConflict: "user_id,deck_id,patch_key" });
    assertSupabaseResult(error);
  }

  private async upsertQuestionThreads(questionThreadsByDeckId: StoredAppState["questionThreadsByDeckId"]): Promise<void> {
    const threads = Object.entries(questionThreadsByDeckId).flatMap(([deckId, deckThreads]) =>
      deckThreads.map((thread) => ({ deckId, thread })),
    );
    if (!threads.length) return;

    const threadRows = threads.map(({ deckId, thread }) => ({
      user_id: this.userId,
      deck_id: deckId,
      thread_id: thread.id,
      title: thread.title,
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
    }));

    const { error: threadError } = await supabase!
      .from("question_threads")
      .upsert(threadRows, { onConflict: "user_id,deck_id,thread_id" });
    assertSupabaseResult(threadError);

    const messageRows = threads.flatMap(({ thread }) =>
      thread.messages.map((message) => ({
        user_id: this.userId,
        thread_id: thread.id,
        message_id: message.id,
        question: message.question,
        response: message.response,
        created_at: message.createdAt,
      })),
    );
    if (!messageRows.length) return;

    const { error: messageError } = await supabase!
      .from("question_messages")
      .upsert(messageRows, { onConflict: "user_id,thread_id,message_id" });
    assertSupabaseResult(messageError);
  }
}

function groupAnalysesByDeckId(rows: SupabaseAnalysisRow[]): StoredAppState["analysesByDeckId"] {
  return rows.reduce<StoredAppState["analysesByDeckId"]>((result, row) => {
    result[row.deck_id] = [...(result[row.deck_id] ?? []), row.result];
    return result;
  }, {});
}

function groupGraphPatchesByDeckId(rows: SupabaseGraphPatchRow[]): StoredAppState["graphPatchesByDeckId"] {
  return rows.reduce<StoredAppState["graphPatchesByDeckId"]>((result, row) => {
    result[row.deck_id] = {
      ...(result[row.deck_id] ?? {}),
      [row.patch_key]: row.patch,
    };
    return result;
  }, {});
}

function groupQuestionThreadsByDeckId(
  threadRows: SupabaseQuestionThreadRow[],
  messageRows: SupabaseQuestionMessageRow[],
): StoredAppState["questionThreadsByDeckId"] {
  const messagesByThreadId = messageRows.reduce<Record<string, QuestionThread["messages"]>>((result, row) => {
    result[row.thread_id] = [
      ...(result[row.thread_id] ?? []),
      {
        id: row.message_id,
        question: row.question,
        response: row.response,
        createdAt: row.created_at,
      },
    ];
    return result;
  }, {});

  return threadRows.reduce<StoredAppState["questionThreadsByDeckId"]>((result, row) => {
    result[row.deck_id] = [
      ...(result[row.deck_id] ?? []),
      {
        id: row.thread_id,
        deckId: row.deck_id,
        title: row.title,
        messages: messagesByThreadId[row.thread_id] ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    ];
    return result;
  }, {});
}

function assertSupabaseResult(error: { message: string } | null): void {
  if (!error) return;
  if (error.message.toLowerCase().includes("jwt issued at future")) {
    throw new Error("Supabase rejected the current session token because its timestamp is in the future. Sign out and sign back in; if it keeps happening, check that your device date, time, and time zone are set automatically.");
  }
  throw new Error(error.message);
}
