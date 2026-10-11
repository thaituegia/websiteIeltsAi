import type { PlacementItem } from "../../../shared/types.js";
import { expandedReadingPlacementItems } from "./support-placement-reading.js";
import { expandedListeningPlacementItems } from "./support-placement-listening.js";

export const expandedPlacementBank: (PlacementItem & { source:"ai"; quality:"ai-unreviewed" })[] = [
  ...expandedReadingPlacementItems,
  ...expandedListeningPlacementItems,
];
