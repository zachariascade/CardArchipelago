export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export type DeckBoard = "mainboard" | "sideboard";

export type ScryfallImageUris = {
  small?: string;
  normal?: string;
  large?: string;
  art_crop?: string;
};

export type ScryfallCardFace = {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  image_uris?: ScryfallImageUris;
};

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  colors?: ManaColor[];
  color_identity?: ManaColor[];
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  legalities?: Record<string, string>;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  all_parts?: unknown[];
};

export type DeckEntry = {
  id: string;
  name: string;
  quantity: number;
  board?: DeckBoard;
  section?: string;
  unresolved?: boolean;
  scryfall?: ScryfallCard;
};

export type DeckSnapshot = {
  id: string;
  name: string;
  format: "commander";
  originalText: string;
  commanderId?: string;
  entries: DeckEntry[];
  importedAt: string;
  updatedAt: string;
  source?: {
    type: "archidekt";
    url: string;
    deckId: string;
    name?: string;
    lastSyncedAt?: string;
  };
};

export type DeckCategory =
  | "Commander"
  | "Creatures"
  | "Artifacts"
  | "Enchantments"
  | "Instants"
  | "Sorceries"
  | "Planeswalkers"
  | "Battles"
  | "Lands"
  | "Other / Unknown";

export const DECK_CATEGORIES: DeckCategory[] = [
  "Commander",
  "Creatures",
  "Artifacts",
  "Enchantments",
  "Instants",
  "Sorceries",
  "Planeswalkers",
  "Battles",
  "Lands",
  "Other / Unknown",
];

export function getPrimaryTypeLine(entry: DeckEntry): string {
  return [
    entry.scryfall?.type_line,
    ...(entry.scryfall?.card_faces?.map((face) => face.type_line) ?? []),
  ]
    .filter(Boolean)
    .join(" // ");
}

export function getOracleText(entry: DeckEntry): string {
  return [
    entry.scryfall?.oracle_text,
    ...(entry.scryfall?.card_faces?.map((face) => face.oracle_text) ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

export function getManaValue(entry: DeckEntry): number {
  return entry.scryfall?.cmc ?? 0;
}

export function getImageUri(entry: DeckEntry): string | undefined {
  return (
    entry.scryfall?.image_uris?.normal ??
    entry.scryfall?.card_faces?.[0]?.image_uris?.normal ??
    entry.scryfall?.image_uris?.small ??
    entry.scryfall?.card_faces?.[0]?.image_uris?.small
  );
}

export function getEntryBoard(entry: DeckEntry): DeckBoard {
  return entry.board ?? "mainboard";
}

export function categorizeEntry(entry: DeckEntry, deck: DeckSnapshot): DeckCategory {
  if (entry.id === deck.commanderId) return "Commander";
  const typeLine = getPrimaryTypeLine(entry).toLowerCase();
  if (!typeLine) return "Other / Unknown";
  if (typeLine.includes("land")) return "Lands";
  if (typeLine.includes("creature")) return "Creatures";
  if (typeLine.includes("artifact")) return "Artifacts";
  if (typeLine.includes("enchantment")) return "Enchantments";
  if (typeLine.includes("instant")) return "Instants";
  if (typeLine.includes("sorcery")) return "Sorceries";
  if (typeLine.includes("planeswalker")) return "Planeswalkers";
  if (typeLine.includes("battle")) return "Battles";
  return "Other / Unknown";
}
