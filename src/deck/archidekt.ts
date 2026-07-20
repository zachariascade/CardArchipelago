import { ParsedDecklist } from "./parseDecklist";

export type ArchidektImport = {
  deckId: string;
  url: string;
  name: string;
  parsed: ParsedDecklist;
  originalText: string;
};

type ArchidektCategory = {
  name?: unknown;
  includedInDeck?: unknown;
  isPremier?: unknown;
};

type ArchidektCardPackage = {
  quantity?: unknown;
  qty?: unknown;
  categories?: unknown;
  card?: {
    oracleCard?: {
      name?: unknown;
    };
    name?: unknown;
  };
};

type ArchidektDeckPayload = {
  id?: unknown;
  name?: unknown;
  cards?: unknown;
  categories?: unknown;
};

export async function fetchArchidektDeck(link: string): Promise<ArchidektImport> {
  const deckId = parseArchidektDeckId(link);
  if (!deckId) throw new Error("Enter a valid Archidekt deck link, like https://archidekt.com/decks/123456/name.");

  const url = `https://archidekt.com/decks/${deckId}`;
  const apiPath = `/api/decks/${deckId}/?format=json`;
  const response = await fetchArchidektApi(apiPath);
  if (!response.ok) {
    throw new Error(`Archidekt returned ${response.status} while fetching deck ${deckId}. Make sure the deck is public.`);
  }

  const payload = (await response.json()) as ArchidektDeckPayload;
  const extracted = extractArchidektEntries(payload);
  if (!extracted.entries.length) throw new Error("Archidekt returned no importable cards for that deck.");

  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : `Archidekt Deck ${deckId}`;
  const originalText = formatArchidektDecklist(extracted.commanderNames, extracted.entries);
  return {
    deckId,
    url,
    name,
    originalText,
    parsed: {
      entries: extracted.entries,
      commanderName: extracted.commanderNames[0],
      warnings: extracted.warnings,
    },
  };
}

async function fetchArchidektApi(path: string): Promise<Response> {
  try {
    return await fetch(`https://archidekt.com${path}`, { headers: { Accept: "application/json" } });
  } catch (error) {
    const proxyResponse = await fetch(`/archidekt-api${path}`, { headers: { Accept: "application/json" } });
    if (proxyResponse.ok) return proxyResponse;
    throw error;
  }
}

export function parseArchidektDeckId(link: string): string | undefined {
  const trimmed = link.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/(?:archidekt\.com\/(?:api\/)?decks\/|^)(\d+)/i);
  return match?.[1];
}

function extractArchidektEntries(payload: ArchidektDeckPayload): {
  entries: ParsedDecklist["entries"];
  commanderNames: string[];
  warnings: string[];
} {
  const cards = Array.isArray(payload.cards) ? (payload.cards as ArchidektCardPackage[]) : [];
  const categories = Array.isArray(payload.categories) ? (payload.categories as ArchidektCategory[]) : [];
  const premierCategories = new Set(
    categories
      .filter((category) => category.includedInDeck === true && category.isPremier === true && typeof category.name === "string")
      .map((category) => String(category.name)),
  );
  const excludedCategories = new Set(
    categories
      .filter((category) => category.includedInDeck === false && typeof category.name === "string")
      .map((category) => String(category.name)),
  );
  const entriesByKey = new Map<string, ParsedDecklist["entries"][number]>();
  const commanderNames: string[] = [];
  const warnings: string[] = [];

  cards.forEach((cardPackage, index) => {
    const name = getArchidektCardName(cardPackage);
    if (!name) {
      warnings.push(`Archidekt card ${index + 1} had no card name.`);
      return;
    }

    const cardCategories = getArchidektCardCategories(cardPackage);
    if (cardCategories.some((category) => excludedCategories.has(category))) return;
    const isCommander = cardCategories.some((category) => premierCategories.has(category));
    const board = isCommander || cardCategories.some((category) => category.toLowerCase() === "sideboard") ? (isCommander ? "mainboard" : "sideboard") : "mainboard";
    const section = isCommander ? "Commander" : cardCategories[0] || (board === "sideboard" ? "Sideboard" : "Mainboard");
    const key = `${board}:${section}:${name}`;
    const quantity = Math.max(1, Number(cardPackage.quantity ?? cardPackage.qty ?? 1) || 1);
    const existing = entriesByKey.get(key);
    if (existing) existing.quantity += quantity;
    else entriesByKey.set(key, { name, quantity, board, section });
    if (isCommander && !commanderNames.includes(name)) commanderNames.push(name);
  });

  return {
    entries: Array.from(entriesByKey.values()),
    commanderNames,
    warnings,
  };
}

function getArchidektCardName(cardPackage: ArchidektCardPackage): string | undefined {
  const oracleName = cardPackage.card?.oracleCard?.name;
  if (typeof oracleName === "string" && oracleName.trim()) return oracleName.trim();
  const cardName = cardPackage.card?.name;
  if (typeof cardName === "string" && cardName.trim()) return cardName.trim();
  return undefined;
}

function getArchidektCardCategories(cardPackage: ArchidektCardPackage): string[] {
  return Array.isArray(cardPackage.categories) ? cardPackage.categories.filter((category): category is string => typeof category === "string") : [];
}

function formatArchidektDecklist(commanderNames: string[], entries: ParsedDecklist["entries"]): string {
  const commanderSet = new Set(commanderNames);
  const sections = [
    { title: "Commander", entries: entries.filter((entry) => commanderSet.has(entry.name)) },
    { title: "Mainboard", entries: entries.filter((entry) => entry.board !== "sideboard" && !commanderSet.has(entry.name)) },
    { title: "Sideboard", entries: entries.filter((entry) => entry.board === "sideboard") },
  ].filter((section) => section.entries.length);

  return sections
    .map((section) => [`${section.title}:`, ...section.entries.map((entry) => `${entry.quantity} ${entry.name}`)].join("\n"))
    .join("\n\n");
}
