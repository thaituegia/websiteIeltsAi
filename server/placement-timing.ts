import type { PlacementItem } from "../shared/types";

export function placementDurationSeconds(mode: "quick" | "deep"): number {
  return mode === "quick" ? 20 * 60 : 40 * 60;
}
/** Guidance changes with text length and level; the persisted overall deadline
 * is authoritative, so a harder adaptive question never resets the test clock. */
export function suggestedPlacementSeconds(item: PlacementItem): number {
  const thinking = { A2: 30, B1: 40, B2: 55, C1: 70 }[item.cefr];
  const words = item.text.match(/\S+/gu)?.length ?? 0;
  const textSeconds = Math.ceil(words / (item.skill === "listening" ? 2 : 2.8));
  return Math.max(45, Math.min(240, thinking + textSeconds));
}
