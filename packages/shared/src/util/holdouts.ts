import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { HoldoutInterface } from "../validators/holdout";

// Capped at 0.5 because an equal control group is reserved alongside the holdout.
export const MAX_HOLDOUT_SIZE = 0.5;

export function holdoutSizeToCoverage(holdoutSize: number): number {
  return holdoutSize * 2;
}

export function coverageToHoldoutSize(coverage: number): number {
  return coverage / 2;
}

export const holdoutStage = [
  "draft",
  "running",
  "analysis-period",
  "stopped",
] as const;
export type HoldoutStage = (typeof holdoutStage)[number];

export function getHoldoutStage(
  holdout:
    | Pick<HoldoutInterface, "analysisStartDate">
    | { analysisStartDate?: string | null },
  exp:
    | Pick<ExperimentInterface, "status">
    | Pick<ExperimentInterfaceStringDates, "status">,
): HoldoutStage {
  if (exp.status === "draft") return "draft";
  if (exp.status === "stopped") return "stopped";
  return holdout.analysisStartDate ? "analysis-period" : "running";
}
