import type { Response } from "express";
import {
  HEALTH_SCORE_ALL_PROJECTS,
  InsightsHealthScoreInterface,
} from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { recordWeeklyHealthScores } from "back-end/src/enterprise/services/insightsHealth";

const TREND_WEEKS = 26;

// Weekly Health scores for the score trend, recording this week's first
export async function getHealthScores(
  req: AuthRequest,
  res: Response<{ status: 200; scores: InsightsHealthScoreInterface[] }>,
) {
  const context = getContextFromReq(req);
  await recordWeeklyHealthScores(context);
  const since = new Date(Date.now() - TREND_WEEKS * 7 * 24 * 60 * 60 * 1000);
  // The All Projects row spans Projects this user may not be able to read
  const scores = (
    await context.models.insightsHealthScores.getSince(since)
  ).filter((s) => s.scope !== HEALTH_SCORE_ALL_PROJECTS);
  res.status(200).json({ status: 200, scores });
}
