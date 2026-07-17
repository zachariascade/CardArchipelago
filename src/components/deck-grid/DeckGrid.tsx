import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { DeckBoard, DeckEntry, DeckSnapshot, DECK_CATEGORIES, categorizeEntry, getEntryBoard, getManaValue, getPrimaryTypeLine } from "../../deck/deckModel";
import { DeckStackCard } from "../deck-card/DeckStackCard";

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
  onMoveCardToBoard,
  onDeleteCard,
  onAddCard,
  onSearchCardNames,
  addCardStatus,
  isAddingCard,
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
  onMoveCardToBoard: (cardId: string, board: DeckBoard) => void;
  onDeleteCard: (cardId: string) => void;
  onAddCard: (name: string, quantity: number, board: DeckBoard) => void;
  onSearchCardNames: (query: string) => Promise<string[]>;
  addCardStatus?: string;
  isAddingCard?: boolean;
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [openCardMenuId, setOpenCardMenuId] = useState<string>();
  const [addCardName, setAddCardName] = useState("");
  const [addCardQuantity, setAddCardQuantity] = useState(1);
  const [addCardBoard, setAddCardBoard] = useState<DeckBoard>("mainboard");
  const [cardSuggestions, setCardSuggestions] = useState<string[]>([]);
  const [isSearchingCards, setIsSearchingCards] = useState(false);
  const [cardSearchError, setCardSearchError] = useState<string>();
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const cardSearchRequestId = useRef(0);
  const filtered = deck.entries.filter((entry) => matchesControls(entry, deck, search, filterMode));
  const trimmedAddCardName = addCardName.trim();
  const showSuggestions = isSuggestionOpen && (cardSuggestions.length > 0 || isSearchingCards || Boolean(cardSearchError));
  const boards = (["mainboard", "sideboard"] as const)
    .map((board) => {
      const boardEntries = filtered.filter((entry) => getEntryBoard(entry) === board);
      const groups = DECK_CATEGORIES.map((category) => ({
        category,
        entries: boardEntries
          .filter((entry) => categorizeEntry(entry, deck) === category)
          .sort((a, b) => sortEntries(a, b, sortMode, sortAscending)),
      })).filter((group) => group.entries.length > 0);
      return {
        board,
        title: board === "mainboard" ? "Mainboard" : "Sideboard",
        count: boardEntries.reduce((sum, entry) => sum + entry.quantity, 0),
        groups,
      };
    })
    .filter((boardGroup) => boardGroup.groups.length > 0);

  useEffect(() => {
    if (!openCardMenuId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".deck-card-menu")) return;
      setOpenCardMenuId(undefined);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCardMenuId(undefined);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openCardMenuId]);

  useEffect(() => {
    const query = addCardName.trim();
    setActiveSuggestionIndex(0);
    if (query.length < 2) {
      cardSearchRequestId.current += 1;
      setCardSuggestions([]);
      setIsSearchingCards(false);
      setCardSearchError(undefined);
      return;
    }

    const requestId = cardSearchRequestId.current + 1;
    cardSearchRequestId.current = requestId;
    setIsSearchingCards(true);
    setCardSearchError(undefined);
    const timeoutId = window.setTimeout(() => {
      void onSearchCardNames(query)
        .then((names) => {
          if (cardSearchRequestId.current !== requestId) return;
          setCardSuggestions(names.slice(0, 8));
        })
        .catch((error) => {
          if (cardSearchRequestId.current !== requestId) return;
          setCardSuggestions([]);
          setCardSearchError(error instanceof Error ? error.message : "Could not search Scryfall.");
        })
        .finally(() => {
          if (cardSearchRequestId.current === requestId) setIsSearchingCards(false);
        });
    }, 220);
    return () => window.clearTimeout(timeoutId);
  }, [addCardName, onSearchCardNames]);

  function chooseCardSuggestion(name: string): void {
    setAddCardName(name);
    setCardSuggestions([]);
    setIsSuggestionOpen(false);
    setCardSearchError(undefined);
    setActiveSuggestionIndex(0);
  }

  return (
    <section className="deck-workspace">
      <form
        className="add-card-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = addCardName.trim();
          if (!name || isAddingCard) return;
          onAddCard(name, addCardQuantity, addCardBoard);
          setAddCardName("");
          setAddCardQuantity(1);
        }}
      >
        <label className="add-card-name">
          <span>Add Card</span>
          <input
            value={addCardName}
            onChange={(event) => {
              setAddCardName(event.target.value);
              setIsSuggestionOpen(true);
            }}
            onFocus={() => setIsSuggestionOpen(true)}
            onBlur={() => window.setTimeout(() => setIsSuggestionOpen(false), 120)}
            onKeyDown={(event) => {
              if (!showSuggestions || cardSuggestions.length === 0) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestionIndex((current) => (current + 1) % cardSuggestions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestionIndex((current) => (current - 1 + cardSuggestions.length) % cardSuggestions.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                chooseCardSuggestion(cardSuggestions[activeSuggestionIndex] ?? cardSuggestions[0]);
              } else if (event.key === "Escape") {
                setIsSuggestionOpen(false);
              }
            }}
            placeholder="Card name"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="add-card-suggestions"
            aria-activedescendant={showSuggestions && cardSuggestions[activeSuggestionIndex] ? `add-card-suggestion-${activeSuggestionIndex}` : undefined}
          />
          {showSuggestions && (
            <div className="add-card-suggestions" id="add-card-suggestions" role="listbox">
              {isSearchingCards && <div className="add-card-suggestion-status">Searching Scryfall...</div>}
              {cardSearchError && <div className="add-card-suggestion-status error">{cardSearchError}</div>}
              {!isSearchingCards && !cardSearchError && cardSuggestions.length === 0 && trimmedAddCardName.length >= 2 && (
                <div className="add-card-suggestion-status">No matching cards.</div>
              )}
              {cardSuggestions.map((name, index) => (
                <button
                  key={name}
                  id={`add-card-suggestion-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                  className={index === activeSuggestionIndex ? "active" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => chooseCardSuggestion(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </label>
        <label className="add-card-quantity">
          <span>Qty</span>
          <input
            type="number"
            min="1"
            max="999"
            value={addCardQuantity}
            onChange={(event) => setAddCardQuantity(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <label>
          <span>Board</span>
          <select value={addCardBoard} onChange={(event) => setAddCardBoard(event.target.value as DeckBoard)}>
            <option value="mainboard">Mainboard</option>
            <option value="sideboard">Sideboard</option>
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={isAddingCard || !trimmedAddCardName}>
          <Plus size={17} />
          {isAddingCard ? "Adding..." : "Add"}
        </button>
        {addCardStatus && <p className="add-card-status">{addCardStatus}</p>}
      </form>
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
      <div className="deck-board-stack">
        {boards.map((boardGroup) => (
          <section className="deck-board-section" key={boardGroup.board} aria-labelledby={`deck-board-${boardGroup.board}`}>
            <div className="deck-board-heading">
              <h2 id={`deck-board-${boardGroup.board}`}>{boardGroup.title}</h2>
              <span>{boardGroup.count}</span>
            </div>
            <div className="deck-groups">
              {boardGroup.groups.map((group) => {
                const collapseKey = `${boardGroup.board}:${group.category}`;
                const isCollapsed = collapsedCategories.has(collapseKey);
                const count = group.entries.reduce((sum, entry) => sum + entry.quantity, 0);
                return (
                  <div className="deck-category" key={collapseKey}>
                    <button
                      type="button"
                      className="category-heading collapsible-heading"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleSetItem(setCollapsedCategories, collapseKey)}
                    >
                      <span className="heading-title">
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        <h3>{group.category}</h3>
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
                            isMenuOpen={openCardMenuId === entry.id}
                            onSelect={() => onSelectCard(entry.id)}
                            onToggleMenu={() => setOpenCardMenuId((current) => (current === entry.id ? undefined : entry.id))}
                            onMoveToBoard={(board) => {
                              onMoveCardToBoard(entry.id, board);
                              setOpenCardMenuId(undefined);
                            }}
                            onDelete={() => {
                              onDeleteCard(entry.id);
                              setOpenCardMenuId(undefined);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {boards.length === 0 && <div className="deck-grid-empty">No cards match the current controls.</div>}
      </div>
    </section>
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
