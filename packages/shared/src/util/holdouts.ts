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
 * both expose `enabled`. Pass `allowedEnvs` to drop ids that no longer exist in
 * the org (e.g. a deleted environment still lingering in stored settings).
 */
export function getEnabledHoldoutEnvironments(
  environmentSettings:
    | Record<string, { enabled?: boolean } | undefined>
    | undefined
    | null,
  allowedEnvs?: string[],
): string[] {
  if (!environmentSettings) return [];
  const allowed = allowedEnvs ? new Set(allowedEnvs) : null;
  return Object.keys(environmentSettings).filter(
    (env) =>
      environmentSettings[env]?.enabled && (!allowed || allowed.has(env)),
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

export type HoldoutLinkBlocker =
  | {
      reason: "different-holdout";
      featureHoldoutId: string;
      experimentHoldoutId: string;
    }
  | { reason: "holdout-unavailable"; featureHoldoutId: string }
  | { reason: "not-draft"; featureHoldoutId: string }
  | { reason: "has-linked-changes"; featureHoldoutId: string }
  | { reason: "not-in-holdout"; experimentHoldoutId: string };

/**
 * Why a Feature Flag can't take a rule for this experiment on holdout grounds,
 * or null when it can. A flag in a holdout pulls a holdout-free experiment
 * into it, which only a draft with nothing else linked may do.
 * `featureHoldoutProjects` is the flag's holdout's project scope, when known.
 */
export function getHoldoutLinkBlocker({
  featureId,
  featureHoldoutId,
  featureHoldoutProjects,
  experiment,
}: {
  featureId: string;
  featureHoldoutId: string | null | undefined;
  featureHoldoutProjects?: string[] | null;
  experiment: Pick<
    ExperimentInterface,
    | "holdoutId"
    | "project"
    | "status"
    | "linkedFeatures"
    | "hasURLRedirects"
    | "hasVisualChangesets"
  >;
}): HoldoutLinkBlocker | null {
  const experimentHoldoutId = experiment.holdoutId || null;
  if (featureHoldoutId) {
    if (experimentHoldoutId && experimentHoldoutId !== featureHoldoutId) {
      return {
        reason: "different-holdout",
        featureHoldoutId,
        experimentHoldoutId,
      };
    }
    if (experimentHoldoutId) return null;
    if (
      featureHoldoutProjects &&
      featureHoldoutProjects.length > 0 &&
      !(
        experiment.project &&
        featureHoldoutProjects.includes(experiment.project)
      )
    ) {
      return { reason: "holdout-unavailable", featureHoldoutId };
    }
    if (experiment.status !== "draft") {
      return { reason: "not-draft", featureHoldoutId };
    }
    // Self-links never count: linkedFeatures is deliberately sticky, so a
    // discarded draft on this same flag leaves one behind.
    const hasOtherLinkedChanges =
      (experiment.linkedFeatures?.some((id) => id !== featureId) ?? false) ||
      !!experiment.hasURLRedirects ||
      !!experiment.hasVisualChangesets;
    if (hasOtherLinkedChanges) {
      return { reason: "has-linked-changes", featureHoldoutId };
    }
    return null;
  }
  if (experimentHoldoutId) {
    return { reason: "not-in-holdout", experimentHoldoutId };
  }
  return null;
}
