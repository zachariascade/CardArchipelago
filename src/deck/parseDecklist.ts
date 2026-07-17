import { DeckBoard, DeckEntry } from "./deckModel";

export type ParsedDecklist = {
  entries: Omit<DeckEntry, "id" | "scryfall" | "unresolved">[];
  commanderName?: string;
  warnings: string[];
};

const COMMANDER_HEADINGS = new Set(["commander", "commanders"]);
const SIDEBOARD_HEADINGS = new Set(["sideboard", "sideboards"]);
const IGNORED_HEADINGS = new Set(["maybeboard"]);

export function parseDecklist(text: string): ParsedDecklist {
  const entries: ParsedDecklist["entries"] = [];
  const warnings: string[] = [];
  let currentSection: string | undefined;
  let currentBoard: DeckBoard = "mainboard";
  let commanderName: string | undefined;
  let ignoring = false;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const heading = line.replace(/:$/, "").trim();
    if (!/^\d+\s+/.test(line) && /^[\w\s/]+:?$/.test(line)) {
      currentSection = heading;
      currentBoard = SIDEBOARD_HEADINGS.has(heading.toLowerCase()) ? "sideboard" : "mainboard";
      ignoring = IGNORED_HEADINGS.has(heading.toLowerCase());
      return;
    }

    if (ignoring) return;

    const match = line.match(/^(\d+)\s+(.+?)\s*(?:\([A-Z0-9]{2,5}\)\s*[\w-]+)?$/i);
    if (!match) {
      warnings.push(`Line ${index + 1} could not be parsed: ${line}`);
      return;
    }

    const quantity = Number(match[1]);
    const name = cleanupCardName(match[2]);
    entries.push({ name, quantity, board: currentBoard, section: currentSection });

    if (currentSection && COMMANDER_HEADINGS.has(currentSection.toLowerCase()) && !commanderName) {
      commanderName = name;
    }
  });

  return { entries, commanderName, warnings };
}

function cleanupCardName(name: string): string {
  return name
    .replace(/\s+\*.*$/, "")
    .replace(/\s+#.*$/, "")
    .replace(/\s+\/\/.*$/, "")
    .trim();
}
