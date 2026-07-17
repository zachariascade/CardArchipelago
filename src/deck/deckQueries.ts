import { DeckEntry, DeckSnapshot, ManaColor, getManaValue, getOracleText, getPrimaryTypeLine } from "./deckModel";

export type DeckQuery = {
  typeLineIncludes?: string;
  oracleTextIncludes?: string;
  nameIncludes?: string;
  colorsInclude?: ManaColor[];
  colorIdentityIncludes?: ManaColor[];
  manaValue?: {
    min?: number;
    max?: number;
  };
  isCommander?: boolean;
  isLand?: boolean;
  isNonland?: boolean;
  tagsInclude?: string[];
};

export type DeckQueryCapability = {
  id: string;
  label: string;
  description: string;
};

export const availableQueries: DeckQueryCapability[] = [
  { id: "typeLineIncludes", label: "Type line", description: "Find cards whose type line contains text." },
  { id: "oracleTextIncludes", label: "Oracle text", description: "Find cards whose rules text contains text." },
  { id: "manaValue", label: "Mana value", description: "Find cards within a mana value range." },
  { id: "colorIdentityIncludes", label: "Color identity", description: "Find cards by color identity." },
  { id: "isLand", label: "Lands", description: "Find lands or nonlands." },
];

export function queryDeck(deck: DeckSnapshot, query?: DeckQuery): DeckEntry[] {
  if (!query) return deck.entries;
  return deck.entries.filter((entry) => matchesQuery(deck, entry, query));
}

export function countQuery(deck: DeckSnapshot, query?: DeckQuery): number {
  return queryDeck(deck, query).reduce((sum, entry) => sum + entry.quantity, 0);
}

export function getCommander(deck: DeckSnapshot): DeckEntry | undefined {
  return deck.entries.find((entry) => entry.id === deck.commanderId);
}

export function getCardById(deck: DeckSnapshot, cardId: string): DeckEntry | undefined {
  return deck.entries.find((entry) => entry.id === cardId);
}

export function manaCurve(deck: DeckSnapshot): { manaValue: number; count: number }[] {
  const counts = new Map<number, number>();
  deck.entries.forEach((entry) => {
    if (entry.id === deck.commanderId) return;
    if (getPrimaryTypeLine(entry).toLowerCase().includes("land")) return;
    const value = Math.min(7, Math.floor(getManaValue(entry)));
    counts.set(value, (counts.get(value) ?? 0) + entry.quantity);
  });
  return Array.from({ length: 8 }, (_, manaValue) => ({ manaValue, count: counts.get(manaValue) ?? 0 }));
}

export function typeBreakdown(deck: DeckSnapshot): { type: string; count: number }[] {
  const types = ["Creature", "Artifact", "Enchantment", "Instant", "Sorcery", "Planeswalker", "Battle", "Land"];
  return types.map((type) => ({
    type,
    count: countQuery(deck, { typeLineIncludes: type }),
  }));
}

export function colorIdentityBreakdown(deck: DeckSnapshot): { color: ManaColor; count: number }[] {
  const colors: ManaColor[] = ["W", "U", "B", "R", "G", "C"];
  return colors.map((color) => ({
    color,
    count:
      color === "C"
        ? deck.entries.filter((entry) => (entry.scryfall?.color_identity?.length ?? 0) === 0).length
        : countQuery(deck, { colorIdentityIncludes: [color] }),
  }));
}

function matchesQuery(deck: DeckSnapshot, entry: DeckEntry, query: DeckQuery): boolean {
  const typeLine = getPrimaryTypeLine(entry).toLowerCase();
  const oracle = getOracleText(entry).toLowerCase();
  if (query.isCommander !== undefined && (entry.id === deck.commanderId) !== query.isCommander) return false;
  if (query.isLand !== undefined && typeLine.includes("land") !== query.isLand) return false;
  if (query.isNonland !== undefined && !typeLine.includes("land") !== query.isNonland) return false;
  if (query.typeLineIncludes && !typeLine.includes(query.typeLineIncludes.toLowerCase())) return false;
  if (query.oracleTextIncludes && !oracle.includes(query.oracleTextIncludes.toLowerCase())) return false;
  if (query.nameIncludes && !entry.name.toLowerCase().includes(query.nameIncludes.toLowerCase())) return false;
  if (query.colorsInclude?.length) {
    const colors = entry.scryfall?.colors ?? [];
    if (!query.colorsInclude.every((color) => colors.includes(color))) return false;
  }
  if (query.colorIdentityIncludes?.length) {
    const identity = entry.scryfall?.color_identity ?? [];
    if (!query.colorIdentityIncludes.every((color) => identity.includes(color))) return false;
  }
  if (query.manaValue) {
    const value = getManaValue(entry);
    if (query.manaValue.min !== undefined && value < query.manaValue.min) return false;
    if (query.manaValue.max !== undefined && value > query.manaValue.max) return false;
  }
  return true;
}
