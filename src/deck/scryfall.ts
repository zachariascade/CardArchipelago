import { DeckEntry, ScryfallCard } from "./deckModel";
import { ParsedDecklist } from "./parseDecklist";

export type ImportResult = {
  entries: DeckEntry[];
  unresolvedNames: string[];
};

export async function fetchCardByName(name: string): Promise<ScryfallCard> {
  const url = new URL("https://api.scryfall.com/cards/named");
  url.searchParams.set("exact", name);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Scryfall could not resolve ${name}`);
  }
  return response.json();
}

export async function fetchFuzzyCardByName(name: string): Promise<ScryfallCard> {
  const url = new URL("https://api.scryfall.com/cards/named");
  url.searchParams.set("fuzzy", name);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Scryfall could not find a fuzzy match for ${name}`);
  }
  return response.json();
}

export async function fetchCardAutocompleteNames(name: string): Promise<string[]> {
  const url = new URL("https://api.scryfall.com/cards/autocomplete");
  url.searchParams.set("q", name);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Scryfall autocomplete failed for ${name}`);
  }
  const payload = (await response.json()) as { data?: string[] };
  return payload.data ?? [];
}

export async function hydrateDeckEntries(parsed: ParsedDecklist): Promise<ImportResult> {
  const uniqueNames = Array.from(new Set(parsed.entries.map((entry) => entry.name)));
  const results = await Promise.allSettled(uniqueNames.map((name) => fetchCardByName(name)));
  const byName = new Map<string, ScryfallCard>();
  const unresolvedNames: string[] = [];

  uniqueNames.forEach((name, index) => {
    const result = results[index];
    if (result.status === "fulfilled") byName.set(name, result.value);
    else unresolvedNames.push(name);
  });

  return {
    unresolvedNames,
    entries: parsed.entries.map((entry, index) => {
      const card = byName.get(entry.name);
      return {
        ...entry,
        id: card?.id ?? `unresolved_${slugify(entry.name)}_${index}`,
        unresolved: !card,
        scryfall: card,
      };
    }),
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
