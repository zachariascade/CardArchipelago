# Graph Edge Function Attribute Queries

Use `edgeFunctions` when one selected card creates the same graph relationship with a class of cards. Do not enumerate many direct edges when a selector can describe the class.

## Selector Quality

Selectors should describe the smallest meaningful operational class, not the broadest technically true class.

Avoid overbroad selectors such as all Creatures, all Permanents, all Spells, all Artifacts, all graveyard cards, or all cards with a common word when only a narrower subset actually improves the selected card.

Prefer narrowing selectors with role-relevant evidence:

- token makers or expendable bodies instead of every creature
- recursive cards instead of every graveyard card
- cards with matching triggered text instead of every card of a type
- cards that explicitly mention the selected type, zone, or action
- low mana value when timing or repeatability matters
- commander-only when protection or support is commander-specific
- nonland/noncreature filters when the rules text says so

Use a broad selector only when the selected card's rules text truly cares about every card in that class and each generated edge would teach useful deck knowledge. If a selector would create many weak or obvious edges, skip the edgeFunction or create a concept node/summary edge instead.

## Connection Groups

`kind` is a machine-readable semantic hint. `connectionGroup` is the user-facing category shown in the Connections panel.

For AI-generated edges and edgeFunctions, set `connectionGroup` whenever a more expressive label exists. Prefer concise labels that describe the actual relationship, such as:

- `Doubles Damage`
- `Reanimation Targets`
- `Cannot Reanimate`
- `Cast From Graveyard`
- `Feeds Sacrifice`
- `Death Trigger Payoffs`
- `Protects Commander`

Use the fixed `kind` values as broad semantics, but do not treat them as the only visible categories.

The same two card nodes may have more than one useful relationship. Preserve distinct relationships when they have different operational reasons by giving each one a different `connectionGroup`; if the edge shares `sourceId`, `targetId`, and `kind` with another edge, append a short relationship slug to the edge id.

## Edge Function Direction

Selected card creates edges to matching cards:

```json
{
  "sourceId": "card:<selectedCardId>",
  "selector": { "attributes": [] },
  "kind": "enables",
  "connectionGroup": "Custom Relationship Label"
}
```

Matching cards create edges to the selected card:

```json
{
  "sourceSelector": { "attributes": [] },
  "targetId": "card:<selectedCardId>",
  "kind": "enables",
  "connectionGroup": "Custom Relationship Label"
}
```

## Selector Shape

Graph selectors use an `attributes` array.

```json
{
  "attributes": [
    {
      "path": "card.type_line_all",
      "op": "contains",
      "value": "Artifact"
    }
  ]
}
```

Every predicate in `attributes` must match for a card to be selected.

## Predicate Fields

- `path`: A Scryfall field path or a virtual `card.*` path.
- `op`: One of `exists`, `equals`, `notEquals`, `contains`, `notContains`, `includes`, `notIncludes`, `>`, `>=`, `<`, `<=`.
- `value`: A string, number, boolean, string array, or number array. Omit `value` only with `exists`.

## Path Resolution

Paths resolve against the card's Scryfall object by default:

- `name`
- `mana_cost`
- `cmc`
- `colors`
- `color_identity`
- `type_line`
- `oracle_text`
- `power`
- `toughness`
- `loyalty`
- `defense`
- `keywords`
- `produced_mana`
- `legalities.commander`
- `card_faces.*.name`
- `card_faces.*.type_line`
- `card_faces.*.oracle_text`

You may prefix raw Scryfall paths with `scryfall.`, but it is optional. For example, `cmc` and `scryfall.cmc` are equivalent.

The prompt's deck snapshot may also include friendly fields such as `typeLine`, `oracleText`, and `manaValue` for readability. Do not use those friendly names as edgeFunction attribute paths. Use raw Scryfall paths or virtual `card.*` paths instead.

Use `*` to inspect every item in an array. For example, `card_faces.*.type_line` checks every face on split cards, modal double-faced cards, adventures, and similar multi-face cards.

## Virtual Card Paths

Use virtual paths when the app's deck-level interpretation is more useful than a single raw Scryfall field:

- `card.id`: Deck entry id.
- `card.name`: Deck entry name.
- `card.quantity`: Deck entry quantity.
- `card.section`: Deck section, when present.
- `card.is_commander`: Whether this entry is the commander.
- `card.is_land`: Whether the combined type line contains Land.
- `card.is_nonland`: Opposite of `card.is_land`.
- `card.type_line_all`: Combined Scryfall `type_line` plus all face type lines.
- `card.oracle_text_all`: Combined Scryfall `oracle_text` plus all face oracle text.
- `card.mana_value`: Scryfall `cmc`, defaulting to 0 when missing.

Prefer `card.type_line_all` and `card.oracle_text_all` for type and rules text checks unless you specifically need one raw Scryfall field.

## Operator Semantics

- `exists`: Matches when any resolved value is present and non-empty.
- `equals`: Case-insensitive for strings; exact for numbers and booleans.
- `notEquals`: Matches when no resolved value equals the provided value.
- `contains`: String/number substring match. Use this for type lines and oracle text.
- `notContains`: Matches when no resolved value contains the provided value.
- `includes`: Matches array-style membership. With an array `value`, every provided value must be present.
- `notIncludes`: Matches when none of the provided values are present.
- `>`, `>=`, `<`, `<=`: Numeric comparison.

## Common Examples

Artifacts:

```json
{ "attributes": [{ "path": "card.type_line_all", "op": "contains", "value": "Artifact" }] }
```

Noncreature nonlands:

```json
{
  "attributes": [
    { "path": "card.is_nonland", "op": "equals", "value": true },
    { "path": "card.type_line_all", "op": "notContains", "value": "Creature" }
  ]
}
```

Cards with mana value 3 or less:

```json
{ "attributes": [{ "path": "cmc", "op": "<=", "value": 3 }] }
```

Blue cards by color identity:

```json
{ "attributes": [{ "path": "color_identity", "op": "includes", "value": "U" }] }
```

Cards with flying:

```json
{ "attributes": [{ "path": "keywords", "op": "includes", "value": "Flying" }] }
```

Commander-legal cards:

```json
{ "attributes": [{ "path": "legalities.commander", "op": "equals", "value": "legal" }] }
```

Any card face is a Wizard:

```json
{ "attributes": [{ "path": "card_faces.*.type_line", "op": "contains", "value": "Wizard" }] }
```

Any face mentions graveyard:

```json
{ "attributes": [{ "path": "card_faces.*.oracle_text", "op": "contains", "value": "graveyard" }] }
```

The selected card protects the commander:

```json
{
  "sourceId": "card:<selectedCardId>",
  "selector": { "attributes": [{ "path": "card.is_commander", "op": "equals", "value": true }] },
  "kind": "protects",
  "customMessage": "This card protects the commander from removal.",
  "strength": 4,
  "connectionGroup": "Protects Commander"
}
```

Wizards enable the selected card:

```json
{
  "sourceSelector": { "attributes": [{ "path": "card.type_line_all", "op": "contains", "value": "Wizard" }] },
  "targetId": "card:<selectedCardId>",
  "kind": "enables",
  "customMessage": "This Wizard helps meet the selected card's Wizard threshold.",
  "strength": 4,
  "connectionGroup": "Transform Enablers"
}
```
