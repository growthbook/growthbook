import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { HoldoutInterface } from "../validators/holdout";

// Capped at 0.5 because an equal control group is reserved alongside the holdout.
export const MAX_HOLDOUT_SIZE = 0.5;

export const DEFAULT_HOLDOUT_SIZE = 0.05;

/**
 * Enabled environment ids from a holdout-style environment map. Accepts both the
 * internal `environmentSettings` shape and the REST `environments` shape since
 * both expose `enabled`.
 */
export function getEnabledHoldoutEnvironments(
  environmentSettings:
    | Record<string, { enabled?: boolean } | undefined>
    | undefined
    | null,
): string[] {
  if (!environmentSettings) return [];
  return Object.keys(environmentSettings).filter(
    (env) => environmentSettings[env]?.enabled,
  );
}

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

export function getAllowedHoldoutStageSources(
  targetStage: HoldoutStage,
): HoldoutStage[] {
  switch (targetStage) {
    case "draft":
      return [];
    case "running":
      return ["draft"];
    case "analysis-period":
      return ["running"];
    case "stopped":
      return ["running", "analysis-period"];
    default:
      targetStage satisfies never;
      return [];
  }
}

export function isHoldoutStageTransitionAllowed(
  currentStage: HoldoutStage,
  targetStage: HoldoutStage,
): boolean {
  return getAllowedHoldoutStageSources(targetStage).includes(currentStage);
}
