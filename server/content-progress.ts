import type { ContentProgress, AttemptSummary, Mode } from "../shared/types";
import type { Database } from "./storage";

/**
 * Summarize only the requested page in MongoDB. Full responses, answer keys,
 * essays and transcripts never leave the database for this browsing request.
 * Redo drafts are separate from completed results and cannot replace them.
 * A replacement sitting also belongs to its original library card. Each row
 * counts once for each requested card, while its summary retains the real ID.
 */
export async function contentProgress(
  database: Database,
  userId: string,
  mode: Mode,
  contentIds: string[],
  timeoutMS: number,
): Promise<Record<string, ContentProgress>> {
  const progress = Object.fromEntries(contentIds.map(id => [id, {
    latestAttempt: null, activeAttemptId: null, completedCount: 0,
  }])) as Record<string, ContentProgress>;
  if (!contentIds.length) return progress;
  const [result] = await database.attempts.aggregate<{
    completed: { _id: string; latestAttempt: AttemptSummary; completedCount: number }[];
    active: { _id: string; activeAttemptId: string }[];
  }>([
    { $match: {
      userId, mode,
      $or: [{ contentId: { $in: contentIds } }, { rootContentId: { $in: contentIds } }],
      status: { $in: ["submitted", "in-progress"] },
      duoAssessmentId: { $exists: false }, invalidatedAt: { $exists: false },
    } },
    { $project: {
      _id: 0,
      progressContentIds: { $setIntersection: [
        ["$contentId", { $ifNull: ["$rootContentId", "$contentId"] }],
        { $literal: contentIds },
      ] },
      summary: {
        id: "$id", contentId: "$contentId", title: "$title", skill: "$skill", mode: "$mode",
        status: "$status", startedAt: "$startedAt", submittedAt: "$submittedAt", durationSeconds: "$durationSeconds",
        estimatedBand: { $ifNull: ["$feedback.estimatedBand", null] },
        rawScore: { $ifNull: ["$feedback.rawScore", null] },
        total: { $ifNull: ["$feedback.total", null] },
        feedbackSource: { $ifNull: ["$feedback.source", null] },
      },
    } },
    { $unwind: "$progressContentIds" },
    { $facet: {
      completed: [
        { $match: { "summary.status": "submitted", "summary.submittedAt": { $type: "string", $ne: "" } } },
        { $sort: { "summary.submittedAt": -1, "summary.startedAt": -1, "summary.id": -1 } },
        { $group: {
          _id: "$progressContentIds", latestAttempt: { $first: "$summary" }, completedCount: { $sum: 1 },
        } },
      ],
      active: [
        { $match: { "summary.status": "in-progress" } },
        { $sort: { "summary.startedAt": -1, "summary.id": -1 } },
        { $group: { _id: "$progressContentIds", activeAttemptId: { $first: "$summary.id" } } },
      ],
    } },
  ], { timeoutMS, maxTimeMS: timeoutMS, allowDiskUse: false }).toArray();
  for (const row of result?.completed ?? []) {
    progress[row._id].latestAttempt = row.latestAttempt;
    progress[row._id].completedCount = row.completedCount;
  }
  for (const row of result?.active ?? []) progress[row._id].activeAttemptId = row.activeAttemptId;
  return progress;
}
