import type { StoredContent } from "../../shared/types";
import { tenBatchReadingGrammarA } from "./duo-gate-supplement-4-reading-a";
import { tenBatchReadingGrammarB } from "./duo-gate-supplement-4-reading-b";
import { tenBatchListeningA } from "./duo-gate-supplement-4-listening-a";
import { tenBatchListeningB } from "./duo-gate-supplement-4-listening-b";

export const TEN_SUPPLEMENT_VERSION = "duo-gate-20261110-v4";
export const TEN_DUO_GATE_LISTENING_IDS = Array.from({ length: 10 }, (_, index) =>
  `duo-private-listening-lesson-30-extra-20261110-${index + 12}`);

/** A separate authored batch: importing it never adds public practice content. */
export function newTenDuoGatePapers(): StoredContent[] {
  const papers = [...tenBatchReadingGrammarA(), ...tenBatchReadingGrammarB(),
    ...tenBatchListeningA(), ...tenBatchListeningB()];
  const byId = new Map(papers.map(paper => [paper.id, paper]));
  if (papers.length !== 30 || byId.size !== 30) throw new Error("The fourth Gate supplement requires thirty distinct papers.");
  return Array.from({ length: 10 }, (_, index) => index + 12).flatMap(sitting =>
    (["reading", "listening", "grammar"] as const).map(skill => {
      const paper = byId.get(`duo-private-${skill}-lesson-30-extra-20261110-${sitting}`);
      if (!paper || paper.skill !== skill || paper.band !== 3 || paper.format !== "lesson" ||
          paper.provenance?.version !== TEN_SUPPLEMENT_VERSION)
        throw new Error("The fourth Gate supplement contains an unexpected paper.");
      return paper;
    }));
}
