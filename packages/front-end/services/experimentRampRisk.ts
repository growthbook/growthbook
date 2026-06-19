/**
 * Pure risk-assessment engine for experiment targeting changes.
 *
 * Extracted from ReleaseChangesForm.getRecommendedRolloutData so it can be
 * reused per-step in the experiment ramp editor. Takes a prior-vs-next
 * targeting pair rather than a full experiment.
 */
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import type { ReleasePlan } from "@/components/Experiment/MakeChangesFlow";
import type { RecommendedRolloutData } from "@/components/Experiment/ReleaseChangesForm";

// ── Types ──────────────────────────────────────────────────────────────────

export type RiskLevel = "safe" | "warning" | "danger";

export interface TargetingSnapshot {
  condition: string;
  savedGroups: SavedGroupTargeting[];
  prerequisites: FeaturePrerequisite[];
  coverage: number;
  variationWeights: number[];
}

export interface StepRiskReasons {
  moreRestrictiveTargeting?: boolean;
  otherTargetingChanges?: boolean;
  decreaseCoverage?: boolean;
  changeVariationWeights?: boolean;
}

export interface StepRiskResult {
  safe: boolean;
  reasons: StepRiskReasons;
  recommendedRemediation: StepRemediation | null;
}

export interface StepRemediation {
  newPhase: boolean;
  reseed: boolean;
  bumpBucketVersion: boolean;
  blockPriorBucketed: boolean;
}

// ── Risk assessment ────────────────────────────────────────────────────────

export function assessStepTargetingRisk(
  prior: TargetingSnapshot,
  next: TargetingSnapshot,
  stickyBucketing: boolean,
): StepRiskResult {
  let moreRestrictiveTargeting = false;
  let otherTargetingChanges = false;
  let decreaseCoverage = false;
  let changeVariationWeights = false;

  // 1. More restrictive targeting (conditions)?
  const strippedCondition = next.condition.slice(1).slice(0, -1);
  if (!(prior.condition || "").includes(strippedCondition)) {
    moreRestrictiveTargeting = true;
  }

  const savedGroupsResult = compareSavedGroups(
    next.savedGroups || [],
    prior.savedGroups || [],
  );
  const prerequisiteResult = comparePrerequisites(
    next.prerequisites || [],
    prior.prerequisites || [],
  );

  if (savedGroupsResult === "more" || prerequisiteResult === "more") {
    moreRestrictiveTargeting = true;
  }
  if (savedGroupsResult === "other" || prerequisiteResult === "other") {
    otherTargetingChanges = true;
  }

  // 3. Decrease coverage?
  if (next.coverage < (prior.coverage ?? 1)) {
    decreaseCoverage = true;
  }

  // 7. Changed variation weights?
  if (
    JSON.stringify(next.variationWeights) !==
    JSON.stringify(prior.variationWeights)
  ) {
    changeVariationWeights = true;
  }

  const reasons: StepRiskReasons = {
    moreRestrictiveTargeting: moreRestrictiveTargeting || undefined,
    otherTargetingChanges: otherTargetingChanges || undefined,
    decreaseCoverage: decreaseCoverage || undefined,
    changeVariationWeights: changeVariationWeights || undefined,
  };

  const hasAnyRisk =
    moreRestrictiveTargeting ||
    otherTargetingChanges ||
    decreaseCoverage ||
    changeVariationWeights;

  if (!hasAnyRisk) {
    return { safe: true, reasons, recommendedRemediation: null };
  }

  const remediation = deriveRemediation(
    {
      moreRestrictiveTargeting,
      otherTargetingChanges,
      decreaseCoverage,
      changeVariationWeights,
    },
    stickyBucketing,
  );

  return { safe: false, reasons, recommendedRemediation: remediation };
}

function deriveRemediation(
  flags: {
    moreRestrictiveTargeting: boolean;
    otherTargetingChanges: boolean;
    decreaseCoverage: boolean;
    changeVariationWeights: boolean;
  },
  stickyBucketing: boolean,
): StepRemediation {
  if (flags.changeVariationWeights) {
    return {
      newPhase: true,
      reseed: true,
      bumpBucketVersion: true,
      blockPriorBucketed: false,
    };
  }

  if (flags.otherTargetingChanges) {
    return {
      newPhase: true,
      reseed: true,
      bumpBucketVersion: true,
      blockPriorBucketed: false,
    };
  }

  if (flags.moreRestrictiveTargeting || flags.decreaseCoverage) {
    if (stickyBucketing) {
      return {
        newPhase: false,
        reseed: false,
        bumpBucketVersion: false,
        blockPriorBucketed: false,
      };
    }
    return {
      newPhase: true,
      reseed: true,
      bumpBucketVersion: false,
      blockPriorBucketed: false,
    };
  }

  return {
    newPhase: false,
    reseed: false,
    bumpBucketVersion: false,
    blockPriorBucketed: false,
  };
}

// ── Intent-flag helpers ────────────────────────────────────────────────────

export function remediationToDescription(r: StepRemediation): string {
  const parts: string[] = [];
  if (r.newPhase && r.reseed) parts.push("New phase (re-randomize)");
  else if (r.newPhase) parts.push("New phase (same seed)");
  if (r.bumpBucketVersion) parts.push("Re-assign sticky-bucketed users");
  if (r.blockPriorBucketed) parts.push("Block prior bucketed users");
  if (parts.length === 0) return "Same phase, apply to new traffic only";
  return parts.join(", ");
}

export function riskReasonsToMessages(reasons: StepRiskReasons): string[] {
  const msgs: string[] = [];
  if (reasons.moreRestrictiveTargeting) {
    msgs.push(
      "Targeting is more restrictive — existing users may lose access.",
    );
  }
  if (reasons.otherTargetingChanges) {
    msgs.push(
      "Targeting changed in both directions — some users may be re-assigned.",
    );
  }
  if (reasons.decreaseCoverage) {
    msgs.push("Coverage decreased — existing users may be excluded.");
  }
  if (reasons.changeVariationWeights) {
    msgs.push(
      "Variation weights changed — users will likely shift between variations.",
    );
  }
  return msgs;
}

// ── Comparison helpers (ported from ReleaseChangesForm) ────────────────────

function compareSavedGroups(
  current: SavedGroupTargeting[],
  last: SavedGroupTargeting[],
): "more" | "less" | "other" | null {
  if (last.length === 0 && current.length > 0) return "more";
  if (last.length > 0 && current.length === 0) return "less";

  const mergedDataIds: Record<"all" | "none", Set<string>> = {
    all: new Set(),
    none: new Set(),
  };
  const mergedLastPhaseIds: Record<"all" | "none", Set<string>> = {
    all: new Set(),
    none: new Set(),
  };
  let totalCurrentAnyGroups = 0;
  let totalLastPhaseAnyGroups = 0;

  for (const group of current) {
    if (group.match === "any") {
      totalCurrentAnyGroups++;
    } else {
      for (const id of group.ids) {
        mergedDataIds[group.match].add(id);
      }
    }
  }
  for (const group of last) {
    if (group.match === "any") {
      totalLastPhaseAnyGroups++;
    } else {
      for (const id of group.ids) {
        mergedLastPhaseIds[group.match].add(id);
      }
    }
  }

  let moreRestrictive = false;
  let lessRestrictive = false;

  if (totalCurrentAnyGroups > totalLastPhaseAnyGroups) moreRestrictive = true;
  if (totalCurrentAnyGroups < totalLastPhaseAnyGroups) lessRestrictive = true;

  for (const matchType of ["all", "none"] as ("all" | "none")[]) {
    const currentIds = mergedDataIds[matchType];
    const lastIds = mergedLastPhaseIds[matchType];
    const addedIds = new Set([...currentIds].filter((id) => !lastIds.has(id)));
    const removedIds = new Set(
      [...lastIds].filter((id) => !currentIds.has(id)),
    );
    if (addedIds.size > 0) moreRestrictive = true;
    if (removedIds.size > 0) lessRestrictive = true;
  }

  if (moreRestrictive && lessRestrictive) return "other";
  if (moreRestrictive) return "more";
  if (lessRestrictive) return "less";
  return null;
}

function comparePrerequisites(
  current: FeaturePrerequisite[],
  last: FeaturePrerequisite[],
): "more" | "less" | "other" | null {
  if (last.length === 0 && current.length > 0) return "more";
  if (last.length > 0 && current.length === 0) return "less";
  if (current.length > last.length) return "more";
  if (current.length < last.length) {
    for (const currentPrereq of current) {
      const lastPrereq = last.find(
        (p) =>
          p.id === currentPrereq.id && p.condition === currentPrereq.condition,
      );
      if (!lastPrereq) return "other";
    }
    return "less";
  }
  return null;
}

// ── ReleasePlan ↔ StepRemediation bridge ──────────────────────────────────

const RELEASE_PLAN_TO_REMEDIATION: Record<string, StepRemediation> = {
  "new-phase": {
    newPhase: true,
    reseed: true,
    bumpBucketVersion: true,
    blockPriorBucketed: false,
  },
  "new-phase-same-seed": {
    newPhase: true,
    reseed: false,
    bumpBucketVersion: false,
    blockPriorBucketed: false,
  },
  "new-phase-block-sticky": {
    newPhase: true,
    reseed: true,
    bumpBucketVersion: true,
    blockPriorBucketed: true,
  },
  "same-phase-everyone": {
    newPhase: false,
    reseed: false,
    bumpBucketVersion: true,
    blockPriorBucketed: false,
  },
  "same-phase-sticky": {
    newPhase: false,
    reseed: false,
    bumpBucketVersion: false,
    blockPriorBucketed: false,
  },
};

export function releasePlanToRemediation(plan: ReleasePlan): StepRemediation {
  return (
    RELEASE_PLAN_TO_REMEDIATION[plan] ?? {
      newPhase: false,
      reseed: false,
      bumpBucketVersion: false,
      blockPriorBucketed: false,
    }
  );
}

export function remediationToReleasePlan(
  r: StepRemediation,
): ReleasePlan | undefined {
  const json = JSON.stringify(r);
  for (const [plan, val] of Object.entries(RELEASE_PLAN_TO_REMEDIATION)) {
    if (JSON.stringify(val) === json) return plan as ReleasePlan;
  }
  return undefined;
}

/**
 * Build a RecommendedRolloutData object from step risk results so the
 * Make Changes ImpactTooltips component can render natively.
 */
export function stepRiskToRecommendedRolloutData(
  risk: StepRiskResult,
  stickyBucketing: boolean,
): RecommendedRolloutData {
  const reasons = {
    moreRestrictiveTargeting: risk.reasons.moreRestrictiveTargeting,
    otherTargetingChanges: risk.reasons.otherTargetingChanges,
    decreaseCoverage: risk.reasons.decreaseCoverage,
    changeVariationWeights: risk.reasons.changeVariationWeights,
  };

  const hasWeightOrAmbiguous =
    !!reasons.changeVariationWeights || !!reasons.otherTargetingChanges;
  const hasRestriction =
    !!reasons.moreRestrictiveTargeting || !!reasons.decreaseCoverage;

  type RL = RecommendedRolloutData["riskLevels"];
  type VH = RecommendedRolloutData["variationHopping"];

  let riskLevels: RL;
  let variationHopping: VH;
  let disableSamePhase = false;
  let recommendedReleasePlan: ReleasePlan | undefined;

  if (risk.safe) {
    riskLevels = {
      "new-phase": "safe",
      "same-phase-sticky": "safe",
      "same-phase-everyone": "safe",
      "new-phase-block-sticky": "safe",
    };
    variationHopping = {
      "new-phase": true,
      "same-phase-sticky": false,
      "same-phase-everyone": false,
      "new-phase-block-sticky": true,
    };
    recommendedReleasePlan = stickyBucketing
      ? "same-phase-sticky"
      : "same-phase-everyone";
  } else if (hasWeightOrAmbiguous) {
    disableSamePhase = true;
    riskLevels = {
      "new-phase": "safe",
      "same-phase-sticky": "danger",
      "same-phase-everyone": "danger",
      "new-phase-block-sticky": "safe",
    };
    variationHopping = {
      "new-phase": true,
      "same-phase-sticky": false,
      "same-phase-everyone": true,
      "new-phase-block-sticky": true,
    };
    recommendedReleasePlan = "new-phase";
  } else if (hasRestriction && stickyBucketing) {
    riskLevels = {
      "new-phase": "safe",
      "same-phase-sticky": "safe",
      "same-phase-everyone": "warning",
      "new-phase-block-sticky": "safe",
    };
    variationHopping = {
      "new-phase": true,
      "same-phase-sticky": false,
      "same-phase-everyone": true,
      "new-phase-block-sticky": true,
    };
    recommendedReleasePlan = "same-phase-sticky";
  } else {
    riskLevels = {
      "new-phase": "safe",
      "same-phase-sticky": "safe",
      "same-phase-everyone": "warning",
      "new-phase-block-sticky": "safe",
    };
    variationHopping = {
      "new-phase": true,
      "same-phase-sticky": false,
      "same-phase-everyone": true,
      "new-phase-block-sticky": true,
    };
    recommendedReleasePlan = "new-phase";
  }

  return {
    recommendedReleasePlan,
    actualReleasePlan: recommendedReleasePlan,
    riskLevels,
    variationHopping,
    disableSamePhase,
    reasons,
  };
}
