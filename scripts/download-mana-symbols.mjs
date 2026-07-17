import { mkdir, writeFile } from "node:fs/promises";

const SYMBOLS_URL = "https://api.scryfall.com/symbology";
const OUTPUT_DIR = new URL("../public/mana/", import.meta.url);

const response = await fetch(SYMBOLS_URL, {
  headers: {
    "User-Agent": "MTG Deck Analyzer local asset downloader",
  },
});

if (!response.ok) {
  throw new Error(`Failed to fetch Scryfall symbology: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const symbols = payload.data.filter((symbol) => symbol.appears_in_mana_costs && symbol.svg_uri);

await mkdir(OUTPUT_DIR, { recursive: true });

await Promise.all(
  symbols.map(async (symbol) => {
    const svgResponse = await fetch(symbol.svg_uri);
    if (!svgResponse.ok) {
      throw new Error(`Failed to fetch ${symbol.symbol}: ${svgResponse.status} ${svgResponse.statusText}`);
    }
    const svg = await svgResponse.text();
    await writeFile(new URL(`${symbolToFileStem(symbol.symbol)}.svg`, OUTPUT_DIR), svg);
  }),
);

await writeFile(
  new URL("manifest.json", OUTPUT_DIR),
  JSON.stringify(
    symbols.map((symbol) => ({
      symbol: symbol.symbol,
      file: `${symbolToFileStem(symbol.symbol)}.svg`,
      english: symbol.english,
    })),
    null,
    2,
  ),
);

console.log(`Downloaded ${symbols.length} Scryfall mana symbol SVGs to public/mana.`);

function symbolToFileStem(symbol) {
  return symbol
    .replace(/[{}]/g, "")
    .replace("½", "HALF")
    .replace("∞", "INFINITY")
    .replace(/\//g, "")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase();
}
