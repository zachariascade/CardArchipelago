import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { DeckEntry, ScryfallCard } from "../../deck/deckModel";
import { fetchCardAutocompleteNames, fetchCardByName, fetchFuzzyCardByName } from "../../deck/scryfall";

type ResolverState = {
  query: string;
  candidate?: ScryfallCard;
  candidates?: ScryfallCard[];
  message?: string;
  isSearching?: boolean;
};

export function UnresolvedResolverPanel({
  entries,
  onResolve,
}: {
  entries: DeckEntry[];
  onResolve: (entryId: string, card: ScryfallCard) => void;
}) {
  const unresolvedEntries = useMemo(() => entries.filter((entry) => entry.unresolved), [entries]);
  const [statesByEntryId, setStatesByEntryId] = useState<Record<string, ResolverState>>({});

  if (!unresolvedEntries.length) return null;

  async function findCandidate(entry: DeckEntry) {
    const current = statesByEntryId[entry.id];
    const query = (current?.query || entry.name).trim();
    if (!query) return;
    setEntryState(entry.id, { ...current, query, candidate: undefined, candidates: undefined, message: undefined, isSearching: true });
    try {
      const names = await fetchCardAutocompleteNames(query);
      const candidates = await Promise.all(names.slice(0, 5).map((name) => fetchCardByName(name)));
      if (!candidates.length) throw new Error("No autocomplete candidates found.");
      setEntryState(entry.id, {
        query,
        candidate: candidates[0],
        candidates,
        isSearching: false,
        message: `Found ${candidates.length} possible match${candidates.length === 1 ? "" : "es"}.`,
      });
    } catch (error) {
      try {
        const candidate = await fetchFuzzyCardByName(query);
        setEntryState(entry.id, {
          query,
          candidate,
          candidates: [candidate],
          isSearching: false,
          message: `Fallback fuzzy match: ${candidate.name}`,
        });
      } catch (fallbackError) {
        setEntryState(entry.id, {
          query,
          isSearching: false,
          message: fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : "No match found.",
        });
      }
    }
  }

  function setEntryState(entryId: string, nextState: ResolverState) {
    setStatesByEntryId((current) => ({ ...current, [entryId]: nextState }));
  }

  return (
    <section className="unresolved-resolver">
      <div className="section-header">
        <div>
          <h2>Resolve Cards</h2>
          <p>{unresolvedEntries.length} imported card{unresolvedEntries.length === 1 ? "" : "s"} need a Scryfall match.</p>
        </div>
      </div>
      <div className="resolver-list">
        {unresolvedEntries.map((entry) => {
          const state = statesByEntryId[entry.id] ?? { query: entry.name };
          return (
            <div className="resolver-row" key={entry.id}>
              <div className="resolver-source">
                <strong>{entry.name}</strong>
                <span>Qty {entry.quantity}</span>
              </div>
              <label className="resolver-search">
                <span>Search name</span>
                <input
                  value={state.query}
                  onChange={(event) => setEntryState(entry.id, { ...state, query: event.target.value, candidate: undefined, candidates: undefined, message: undefined })}
                  placeholder="Scryfall card name"
                />
              </label>
              <div className="resolver-actions">
                <button type="button" className="secondary-button" onClick={() => void findCandidate(entry)} disabled={state.isSearching}>
                  <Search size={16} />
                  {state.isSearching ? "Searching..." : "Find Match"}
                </button>
                <button type="button" className="primary-button" onClick={() => state.candidate && onResolve(entry.id, state.candidate)} disabled={!state.candidate}>
                  <Check size={16} />
                  Apply
                </button>
              </div>
              <div className="resolver-candidate">
                {state.candidates?.length ? (
                  <div className="resolver-candidate-list">
                    {state.candidates.map((candidate) => (
                      <button
                        type="button"
                        key={candidate.id}
                        className={state.candidate?.id === candidate.id ? "selected" : ""}
                        onClick={() => setEntryState(entry.id, { ...state, candidate })}
                      >
                        {getCandidateImage(candidate) ? <img src={getCandidateImage(candidate)} alt="" /> : <div className="missing-card-art">{candidate.name}</div>}
                        <span>
                          <strong>{candidate.name}</strong>
                          <em>{getCandidateTypeLine(candidate)}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="resolver-message">{state.message ?? "Search for the intended Scryfall card."}</span>
                )}
              </div>
              {state.candidate && state.message && <p className="resolver-message">{state.message}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getCandidateImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

function getCandidateTypeLine(card: ScryfallCard): string {
  return [card.type_line, ...(card.card_faces?.map((face) => face.type_line) ?? [])].filter(Boolean).join(" // ") || "Scryfall card";
}
