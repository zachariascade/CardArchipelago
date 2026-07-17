import { UploadCloud } from "lucide-react";

export const DEFAULT_DECKLIST = `MAINBOARD:
1 Anger
1 Sol Ring
1 Arcane Signet
1 Archfiend of Depravity
1 Ash Barrens
1 Banon, the Returners' Leader
1 Battlefield Forge
1 Bedevil
1 Big Score
1 Black Mage's Rod
1 Black Waltz No. 3
1 Brilliant Wings
1 Celes, Rune Knight
1 Clifftop Retreat
1 Coin of Fate
1 Command Tower
1 Cornered by Black Mages
1 Crackling Doom
1 Demolition Field
1 Desolate Mire
1 Dragonskull Summit
1 Edgar, Master Machinist
1 Espers to Magicite
1 Evolving Wilds
1 Exotic Orchard
1 Fatal Push
1 Fetid Heath
1 Foreboding Ruins
1 Furycalm Snarl
1 General Leo Cristophe
1 Geothermal Bog
1 Gogo, Mysterious Mime
1 Graven Cairns
1 High Market
1 Isolated Chapel
1 Joshua, Phoenix's Dominant
1 Key to the City
1 Kuja, Genome Sorcerer
1 Legions to Ashes
1 Locke, Treasure Hunter
1 Mind Stone
1 Morbid Opportunist
1 Mortify
3 Mountain
1 Nibelheim Aflame
1 Nomad Outpost
1 Path of Ancestry
1 Phoenix Down
1 Pitiless Plunderer
4 Plains
1 Priest of Fell Rites
1 Reanimate
1 Rejoin the Fight
1 Rise of the Dark Realms
1 Rogue's Passage
1 Rosa, Resolute White Mage
1 Rugged Prairie
1 Ruin Grinder
1 Sabin, Master Monk
1 Sacred Peaks
1 Sephiroth, Fabled SOLDIER
1 Sephiroth, Fallen Hero
1 Sepulchral Primordial
1 Shadow, Mysterious Assassin
1 Shadowblood Ridge
1 Shineshadow Snarl
1 Siegfried, Famed Swordsman
1 Skullclamp
1 Smoldering Marsh
1 Solemn Simulacrum
1 Squall, SeeD Mercenary
1 Stitch Together
1 Stitcher's Supplier
1 Strago and Relm
1 Sulfurous Springs
1 Summon: Esper Valigarmanda
1 Summon: Knights of Round
1 Sun Titan
1 Sunlit Marsh
1 Sunscorched Divide
3 Swamp
1 Swiftfoot Boots
1 Talisman of Conviction
1 Talisman of Indulgence
1 Terra, Herald of Hope
1 The Darkness Crystal
1 The Falcon, Airship Restored
1 The Masamune
1 The Warring Triad
1 Tragic Arrogance
1 Trailblazer's Boots
1 Vincent Valentine
1 Vivi's Persistence

SIDEBOARD:
1 Angel of the Ruins
1 Bolas's Citadel
1 Combustible Gearhulk
1 Commander's Sphere
1 Cyan, Vengeful Samurai
1 Dark Ritual
1 Flayer of the Hatebound
1 Gau, Feral Youth
1 Interceptor, Shadow's Hound
1 Kefka, Dancing Mad
1 Laughing Mad
1 Lightning, Army of One
1 Meteor Golem
1 Millikin
1 Mog, Moogle Warrior
1 Night's Whisper
1 Palace Jailer
1 Queen Brahne
1 Ranger-Captain of Eos
1 Ruinous Ultimatum
1 Sephiroth's Intervention
1 Setzer, Wandering Gambler
1 Snort
1 Syr Konrad, the Grim
1 Umaro, Raging Yeti
1 Wayfarer's Bauble`;

export function ImportPanel({
  deckText,
  isImporting,
  importMessage,
  warnings,
  unresolvedNames,
  onDeckTextChange,
  onImport,
}: {
  deckText: string;
  isImporting: boolean;
  importMessage?: string;
  warnings: string[];
  unresolvedNames: string[];
  onDeckTextChange: (value: string) => void;
  onImport: () => void;
}) {
  return (
    <section className="import-panel">
      <div className="section-header">
        <div>
          <h2>Import Decklist</h2>
          <p>Paste a Commander list. Scryfall lookup happens in your browser.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => onDeckTextChange(DEFAULT_DECKLIST)}>
          Reset Default
        </button>
      </div>
      <textarea value={deckText} onChange={(event) => onDeckTextChange(event.target.value)} spellCheck={false} />
      <div className="import-actions">
        <button type="button" className="primary-button" onClick={onImport} disabled={isImporting || !deckText.trim()}>
          <UploadCloud size={17} />
          {isImporting ? "Importing..." : "Import Deck"}
        </button>
        {importMessage && <span className="status-text">{importMessage}</span>}
      </div>
      {[...warnings, ...unresolvedNames.map((name) => `Unresolved: ${name}`)].length > 0 && (
        <div className="warning-list">
          {[...warnings, ...unresolvedNames.map((name) => `Unresolved: ${name}`)].map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
    </section>
  );
}
