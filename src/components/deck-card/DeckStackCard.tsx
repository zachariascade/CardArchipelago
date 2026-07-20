import type { HoverPreviewHandlers } from "../../app/App";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { DeckBoard, DeckEntry, getEntryBoard, getImageUri } from "../../deck/deckModel";

export function DeckStackCard({
  entry,
  isSelected = false,
  isMenuOpen = false,
  className,
  ariaLabel,
  hoverPreview,
  onSelect,
  onToggleMenu,
  onMoveToBoard,
  onDelete,
}: {
  entry: DeckEntry;
  isSelected?: boolean;
  isMenuOpen?: boolean;
  className?: string;
  ariaLabel?: string;
  hoverPreview?: HoverPreviewHandlers;
  onSelect: () => void;
  onToggleMenu?: () => void;
  onMoveToBoard?: (board: DeckBoard) => void;
  onDelete?: () => void;
}) {
  const imageUri = getImageUri(entry);
  const board = getEntryBoard(entry);
  const hasMenu = Boolean(onToggleMenu && (onMoveToBoard || onDelete));
  const classes = ["deck-card", className, hasMenu ? "has-menu" : undefined, isSelected ? "selected" : undefined, isMenuOpen ? "menu-open" : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <button
        type="button"
        className="deck-card-open"
        onClick={onSelect}
        onMouseEnter={(event) => hoverPreview?.show(entry.id, event.currentTarget)}
        onMouseLeave={hoverPreview?.hide}
        onFocus={(event) => hoverPreview?.show(entry.id, event.currentTarget)}
        onBlur={hoverPreview?.hide}
        aria-label={ariaLabel ?? `Open ${entry.name}`}
      >
        {imageUri ? (
          <img className="deck-card-image" src={imageUri} alt={entry.name} loading="lazy" />
        ) : (
          <span className="deck-card-image missing-card-art">{entry.name}</span>
        )}
        {entry.quantity > 1 && <span className="card-qty" aria-label={`Quantity ${entry.quantity}`}>{entry.quantity}</span>}
      </button>
      {hasMenu && (
        <div className="deck-card-menu">
          <button
            type="button"
            className="deck-card-menu-trigger"
            onClick={(event) => {
              event.stopPropagation();
              hoverPreview?.hide();
              onToggleMenu?.();
            }}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            aria-label={`Open menu for ${entry.name}`}
            title={`Open menu for ${entry.name}`}
          >
            <MoreHorizontal size={17} />
          </button>
          {isMenuOpen && (
            <div className="deck-card-menu-popover" role="menu">
              {onMoveToBoard && (
                <>
                  <button type="button" role="menuitem" disabled={board === "mainboard"} onClick={() => onMoveToBoard("mainboard")}>
                    Move to Mainboard
                  </button>
                  <button type="button" role="menuitem" disabled={board === "sideboard"} onClick={() => onMoveToBoard("sideboard")}>
                    Move to Sideboard
                  </button>
                </>
              )}
              {onDelete && (
                <button type="button" className="deck-card-menu-delete" role="menuitem" onClick={onDelete}>
                  <Trash2 size={15} />
                  Delete Card
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
