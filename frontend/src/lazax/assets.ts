/** Public URL helpers for Lazax static art under /public/lazax. */

const SC_FILES: Record<number, string> = {
  1: "1-leadership.png",
  2: "2-diplomacy.png",
  3: "3-politics.png",
  4: "4-construction.png",
  5: "5-trade.png",
  6: "6-warfare.png",
  7: "7-technology.png",
  8: "8-imperial.png",
};

const SC_BACK_FILES: Record<number, string> = {
  1: "back-1.png",
  2: "back-2.png",
  3: "back-3.png",
  4: "back-4.png",
  5: "back-5.png",
  6: "back-6.png",
  7: "back-7.png",
  8: "back-8.png",
};

const SC_NAMES: Record<number, string> = {
  1: "Leadership",
  2: "Diplomacy",
  3: "Politics",
  4: "Construction",
  5: "Trade",
  6: "Warfare",
  7: "Technology",
  8: "Imperial",
};

export function strategyCardSrc(
  initiative: number,
  exhausted = false
): string | null {
  if (exhausted) {
    const back = SC_BACK_FILES[initiative] ?? "back-blank.png";
    // Cache-bust after restoring square (1:1) back assets.
    return `/lazax/strategy-cards/${back}?v=square`;
  }
  const file = SC_FILES[initiative];
  return file ? `/lazax/strategy-cards/${file}` : null;
}

export function strategyCardName(initiative: number): string {
  return SC_NAMES[initiative] ?? `Card ${initiative}`;
}

export function factionIconSrc(factionId: string): string {
  return `/lazax/faction-icons/${factionId}.png`;
}
