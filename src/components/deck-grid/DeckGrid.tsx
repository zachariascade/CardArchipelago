import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, ChevronRight, Search } from "lucide-react";
import { DeckEntry, DeckSnapshot, DECK_CATEGORIES, categorizeEntry, getImageUri, getManaValue, getPrimaryTypeLine } from "../../deck/deckModel";

export type SortMode = "category" | "name" | "manaValue";
export type FilterMode = "all" | "creatures" | "nonlands" | "lands";

export function DeckGrid({
  deck,
  selectedCardId,
  search,
  sortMode,
  filterMode,
  sortAscending,
  onSearchChange,
  onSortModeChange,
  onFilterModeChange,
  onSortAscendingChange,
  onSelectCard,
}: {
  deck: DeckSnapshot;
  selectedCardId?: string;
  search: string;
  sortMode: SortMode;
  filterMode: FilterMode;
  sortAscending: boolean;
  onSearchChange: (value: string) => void;
  onSortModeChange: (value: SortMode) => void;
  onFilterModeChange: (value: FilterMode) => void;
  onSortAscendingChange: (value: boolean) => void;
  onSelectCard: (cardId: string) => void;
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const filtered = deck.entries.filter((entry) => matchesControls(entry, deck, search, filterMode));
  const groups = DECK_CATEGORIES.map((category) => ({
    category,
    entries: filtered
      .filter((entry) => categorizeEntry(entry, deck) === category)
      .sort((a, b) => sortEntries(a, b, sortMode, sortAscending)),
  })).filter((group) => group.entries.length > 0);

  return (
    <section className="deck-workspace">
      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search cards" />
        </label>
        <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)}>
          <option value="category">Category</option>
          <option value="name">Name</option>
          <option value="manaValue">Mana value</option>
        </select>
        <select value={filterMode} onChange={(event) => onFilterModeChange(event.target.value as FilterMode)}>
          <option value="all">All cards</option>
          <option value="creatures">Creatures</option>
          <option value="nonlands">Nonlands</option>
          <option value="lands">Lands</option>
        </select>
        <button className="icon-button" type="button" onClick={() => onSortAscendingChange(!sortAscending)} title="Toggle sort direction">
          {sortAscending ? <ArrowDownAZ size={17} /> : <ArrowUpAZ size={17} />}
        </button>
      </div>
      <div className="deck-groups">
        {groups.map((group) => {
          const isCollapsed = collapsedCategories.has(group.category);
          const count = group.entries.reduce((sum, entry) => sum + entry.quantity, 0);
          return (
            <div className="deck-category" key={group.category}>
              <button
                type="button"
                className="category-heading collapsible-heading"
                aria-expanded={!isCollapsed}
                onClick={() => toggleSetItem(setCollapsedCategories, group.category)}
              >
                <span className="heading-title">
                  {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  <h2>{group.category}</h2>
                </span>
                <span>{count}</span>
              </button>
              {!isCollapsed && (
                <div className="card-grid">
                  {group.entries.map((entry) => (
                    <DeckStackCard
                      key={entry.id}
                      entry={entry}
                      isSelected={entry.id === selectedCardId}
                      onSelect={() => onSelectCard(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DeckStackCard({ entry, isSelected, onSelect }: { entry: DeckEntry; isSelected: boolean; onSelect: () => void }) {
  const imageUri = getImageUri(entry);

  return (
    <button
      type="button"
      className={`deck-card ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
      aria-label={`Open ${entry.name}`}
    >
      {imageUri ? (
        <img className="deck-card-image" src={imageUri} alt={entry.name} loading="lazy" />
      ) : (
        <span className="deck-card-image missing-card-art">{entry.name}</span>
      )}
      {entry.quantity > 1 && <span className="card-qty" aria-label={`Quantity ${entry.quantity}`}>{entry.quantity}</span>}
    </button>
  );
}

function toggleSetItem(setState: Dispatch<SetStateAction<Set<string>>>, item: string): void {
  setState((current) => {
    const next = new Set(current);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  });
}

function matchesControls(entry: DeckEntry, deck: DeckSnapshot, search: string, filterMode: FilterMode): boolean {
  const haystack = `${entry.name} ${getPrimaryTypeLine(entry)} ${entry.scryfall?.oracle_text ?? ""}`.toLowerCase();
  if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false;
  const typeLine = getPrimaryTypeLine(entry).toLowerCase();
  if (filterMode === "creatures" && !typeLine.includes("creature")) return false;
  if (filterMode === "lands" && !typeLine.includes("land")) return false;
  if (filterMode === "nonlands" && typeLine.includes("land")) return false;
  return Boolean(deck);
}

function sortEntries(a: DeckEntry, b: DeckEntry, sortMode: SortMode, ascending: boolean): number {
  const direction = ascending ? 1 : -1;
  if (sortMode === "manaValue") {
    const value = getManaValue(a) - getManaValue(b) || a.name.localeCompare(b.name);
    return value * direction;
  }
  return a.name.localeCompare(b.name) * direction;
}
