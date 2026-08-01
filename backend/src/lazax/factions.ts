/**
 * Static TI4 faction catalog for Lazax (base + PoK + Codex Keleres + Thunder's Edge).
 * `id` is stored on lazax_players.faction_id.
 */
export type Faction = {
  id: string;
  name: string;
  abbrev: string;
  color: string;
  /** Naalu always act first in the action phase (initiative 0). */
  initiativeOverride?: number;
};

export const FACTIONS: Faction[] = [
  { id: "arborec", name: "The Arborec", abbrev: "Arb", color: "#5B8C3E" },
  { id: "argent", name: "The Argent Flight", abbrev: "Arg", color: "#C9A227" },
  { id: "barony", name: "The Barony of Letnev", abbrev: "Let", color: "#6B6B6B" },
  { id: "cabal", name: "The Vuil'Raith Cabal", abbrev: "Cab", color: "#8B1E1E" },
  { id: "crimson", name: "The Crimson Rebellion", abbrev: "Cri", color: "#9C1B3B" },
  { id: "deepwrought", name: "The Deepwrought Scholarate", abbrev: "Dee", color: "#3949AB" },
  { id: "empyrean", name: "The Empyrean", abbrev: "Emp", color: "#5C2D91" },
  {
    id: "firmament",
    name: "The Firmament / The Obsidian",
    abbrev: "Fir",
    color: "#311B92",
  },
  { id: "hacan", name: "The Emirates of Hacan", abbrev: "Hac", color: "#D4A017" },
  { id: "jolnar", name: "The Universities of Jol-Nar", abbrev: "Jol", color: "#2E86AB" },
  { id: "keleres", name: "The Council Keleres", abbrev: "Kel", color: "#0277BD" },
  { id: "l1z1x", name: "The L1Z1X Mindnet", abbrev: "L1Z", color: "#3D5A80" },
  { id: "lastbastion", name: "Last Bastion", abbrev: "Bas", color: "#A67C52" },
  { id: "mahact", name: "The Mahact Gene-Sorcerers", abbrev: "Mah", color: "#B8860B" },
  { id: "mentak", name: "The Mentak Coalition", abbrev: "Men", color: "#C45C26" },
  { id: "muaat", name: "The Embers of Muaat", abbrev: "Mua", color: "#E25822" },
  {
    id: "naalu",
    name: "The Naalu Collective",
    abbrev: "Naa",
    color: "#7CB342",
    initiativeOverride: 0,
  },
  { id: "naazrokha", name: "The Naaz-Rokha Alliance", abbrev: "NRA", color: "#00897B" },
  { id: "nekro", name: "The Nekro Virus", abbrev: "Nek", color: "#B71C1C" },
  { id: "nomad", name: "The Nomad", abbrev: "Nom", color: "#455A64" },
  { id: "norr", name: "Sardakk N'orr", abbrev: "Nor", color: "#8D6E63" },
  { id: "ralnel", name: "The Ral Nel Consortium", abbrev: "Ral", color: "#00ACC1" },
  { id: "saar", name: "The Clan of Saar", abbrev: "Saa", color: "#795548" },
  { id: "sol", name: "The Federation of Sol", abbrev: "Sol", color: "#1565C0" },
  { id: "titans", name: "The Titans of Ul", abbrev: "Tit", color: "#6A1B9A" },
  { id: "winnu", name: "The Winnu", abbrev: "Win", color: "#AD1457" },
  { id: "xxcha", name: "The Xxcha Kingdom", abbrev: "Xxc", color: "#558B2F" },
  { id: "yin", name: "The Yin Brotherhood", abbrev: "Yin", color: "#F9A825" },
  { id: "yssaril", name: "The Yssaril Tribes", abbrev: "Yss", color: "#2E7D32" },
];

export const FACTION_BY_ID: Record<string, Faction> = Object.fromEntries(
  FACTIONS.map((f) => [f.id, f])
);

export const STRATEGY_CARDS = [
  { initiative: 1, name: "Leadership" },
  { initiative: 2, name: "Diplomacy" },
  { initiative: 3, name: "Politics" },
  { initiative: 4, name: "Construction" },
  { initiative: 5, name: "Trade" },
  { initiative: 6, name: "Warfare" },
  { initiative: 7, name: "Technology" },
  { initiative: 8, name: "Imperial" },
] as const;

export function isValidFactionId(id: string): boolean {
  return id in FACTION_BY_ID;
}
