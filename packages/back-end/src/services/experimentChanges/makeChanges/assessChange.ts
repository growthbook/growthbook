import isEqual from "lodash/isEqual";
import {
  ChangeAssessment,
  ExperimentChangeType,
  MAKE_CHANGES_DOC_URL,
  ReleasePlan,
  ReleasePlanAssessment,
  ReleasePlanBias,
  ReleasePlanUnavailableReason,
  RiskCode,
} from "shared/validators";
import { ExperimentPhase } from "shared/types/experiment";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { getNamespaceRanges, hasNarrowedRanges } from "shared/util";

/** The latest-phase fields that decide who gets which variation. */
export type PhaseDelivery = Pick<
  ExperimentPhase,
  | "condition"
  | "savedGroups"
  | "prerequisites"
  | "coverage"
  | "namespace"
  | "variationWeights"
>;

export type AssessChangeInput = {
  changeType: ExperimentChangeType;
  current: PhaseDelivery;
  proposed: PhaseDelivery;
  isBandit: boolean;
  /** Org-level Sticky Bucketing on, and not disabled on the experiment. */
  stickyBucketing: boolean;
  /** Running and served by a linked Feature Flag, visual change, or redirect. */
  live: boolean;
};

const RISK_MESSAGES: Record<RiskCode, string> = {
  "more-restrictive-targeting":
    "More restrictive targeting without starting a new phase may bias results. Some users already in the analysis may begin receiving the default value.",
  "ambiguous-targeting-change":
    "Ambiguous targeting changes without starting a new phase may bias results. Some users already in the analysis may begin receiving the default value.",
  "decrease-coverage":
    "Decreasing traffic without starting a new phase may bias results. Some users already in the analysis will begin receiving the default value.",
  "add-to-namespace":
    "Moving into a namespace without starting a new phase may bias results, as users in the analysis may fall back to the default value.",
  "decrease-namespace-range":
    "Narrowing the namespace range without starting a new phase may bias results, as users in the analysis may fall back to the default value.",
  "change-variation-weights":
    "Changing variation weights can bias results and expose users to more than one variation.",
  "multiple-changes":
    "Making several changes at once makes it hard to tell which one moved the results, and raises the risk of bias.",
  "bandit-restart":
    "Every change restarts the Bandit's exploration, resetting variation weights to equal.",
};

// The bias each risk puts on a same-phase plan, mirroring the wizard. A new
// phase always starts clean.
type Severity = "none" | "sticky-safe" | "ambiguous" | "unsafe";
const SAME_PHASE_BIAS: Record<
  "sticky" | "no-sticky",
  Record<
    Severity,
    {
      keep: ReleasePlanBias;
      reassign: ReleasePlanBias;
      recommended: ReleasePlan;
    }
  >
> = {
  sticky: {
    none: {
      keep: "none",
      reassign: "none",
      recommended: "same-phase-keep-assignments",
    },
    "sticky-safe": {
      keep: "none",
      reassign: "may-bias",
      recommended: "same-phase-keep-assignments",
    },
    ambiguous: {
      keep: "may-bias",
      reassign: "high-risk",
      recommended: "new-phase-rerandomize",
    },
    unsafe: {
      keep: "high-risk",
      reassign: "high-risk",
      recommended: "new-phase-rerandomize",
    },
  },
  "no-sticky": {
    none: {
      keep: "none",
      reassign: "none",
      recommended: "same-phase-reassign",
    },
    "sticky-safe": {
      keep: "none",
      reassign: "may-bias",
      recommended: "new-phase-rerandomize",
    },
    ambiguous: {
      keep: "high-risk",
      reassign: "high-risk",
      recommended: "new-phase-rerandomize",
    },
    unsafe: {
      keep: "high-risk",
      reassign: "high-risk",
      recommended: "new-phase-rerandomize",
    },
  },
};

const STICKY_ONLY_PLANS: ReleasePlan[] = [
  "same-phase-keep-assignments",
  "new-phase-exclude-exposed",
];

export function offeredPlans(
  changeType: ExperimentChangeType,
  isBandit: boolean,
): ReleasePlan[] {
  if (isBandit) {
    return changeType === "new-phase"
      ? ["new-phase-rerandomize"]
      : ["new-phase-rerandomize", "same-phase-keep-assignments"];
  }
  if (changeType === "new-phase") {
    return ["new-phase-rerandomize", "new-phase-keep-assignments"];
  }
  if (changeType === "advanced") {
    return [
      "new-phase-rerandomize",
      "new-phase-exclude-exposed",
      "same-phase-reassign",
      "same-phase-keep-assignments",
    ];
  }
  return [
    "new-phase-rerandomize",
    "same-phase-reassign",
    "same-phase-keep-assignments",
  ];
}

// Strip whitespace so formatting differences aren't read as a change.
function normalizeCondition(condition: string | undefined): string {
  if (!condition) return "";
  try {
    return JSON.stringify(JSON.parse(condition));
  } catch {
    return condition;
  }
}

function compareSavedGroups(
  current: SavedGroupTargeting[],
  last: SavedGroupTargeting[],
): "more" | "less" | "other" | null {
  if (last.length === 0 && current.length > 0) return "more";
  if (last.length > 0 && current.length === 0) return "less";

  const countAny = (groups: SavedGroupTargeting[]) =>
    groups.filter((g) => g.match === "any").length;
  const idsFor = (groups: SavedGroupTargeting[], match: "all" | "none") =>
    new Set(groups.filter((g) => g.match === match).flatMap((g) => g.ids));

  let moreRestrictive = countAny(current) > countAny(last);
  let lessRestrictive = countAny(current) < countAny(last);
  for (const match of ["all", "none"] as const) {
    const currentIds = idsFor(current, match);
    const lastIds = idsFor(last, match);
    if ([...currentIds].some((id) => !lastIds.has(id))) moreRestrictive = true;
    if ([...lastIds].some((id) => !currentIds.has(id))) lessRestrictive = true;
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
    const allKept = current.every((c) =>
      last.some((p) => p.id === c.id && p.condition === c.condition),
    );
    return allKept ? "less" : "other";
  }
  return null;
}

/** What the change does that could bias results, in the wizard's terms. */
export function detectRisks(
  current: PhaseDelivery,
  proposed: PhaseDelivery,
): RiskCode[] {
  const risks = new Set<RiskCode>();

  // Removing an ANDed clause leaves a substring of the old condition; adding or
  // editing one doesn't.
  const strippedCondition = normalizeCondition(proposed.condition).slice(1, -1);
  if (!normalizeCondition(current.condition).includes(strippedCondition)) {
    risks.add("more-restrictive-targeting");
  }
  const savedGroups = compareSavedGroups(
    proposed.savedGroups || [],
    current.savedGroups || [],
  );
  const prerequisites = comparePrerequisites(
    proposed.prerequisites || [],
    current.prerequisites || [],
  );
  if (savedGroups === "more" || prerequisites === "more") {
    risks.add("more-restrictive-targeting");
  }
  if (savedGroups === "other" || prerequisites === "other") {
    risks.add("ambiguous-targeting-change");
  }

  if (proposed.coverage < (current.coverage ?? 1)) {
    risks.add("decrease-coverage");
  }

  const was = current.namespace;
  const now = proposed.namespace;
  if (now?.enabled && (!was?.enabled || now.name !== was.name)) {
    risks.add("add-to-namespace");
  }
  if (
    now?.enabled &&
    was?.enabled &&
    now.name === was.name &&
    hasNarrowedRanges(getNamespaceRanges(was), getNamespaceRanges(now))
  ) {
    risks.add("decrease-namespace-range");
  }

  if (!isEqual(proposed.variationWeights, current.variationWeights)) {
    risks.add("change-variation-weights");
  }

  return [...risks];
}

function severityOf(risks: RiskCode[]): Severity {
  if (
    risks.some((r) =>
      [
        "add-to-namespace",
        "decrease-namespace-range",
        "change-variation-weights",
      ].includes(r),
    )
  ) {
    return "unsafe";
  }
  if (risks.includes("ambiguous-targeting-change")) return "ambiguous";
  if (risks.length) return "sticky-safe";
  return "none";
}

/**
 * The server-side version of the wizard's Review & Deploy page: which risks the
 * change carries, which release plans can roll it out, what each costs, and
 * which one to recommend.
 */
export function assessChange({
  changeType,
  current,
  proposed,
  isBandit,
  stickyBucketing,
  live,
}: AssessChangeInput): ChangeAssessment {
  // Nobody has been exposed to a change that isn't live, so nothing can bias.
  const detected = live ? detectRisks(current, proposed) : [];
  // Bandits always bucket stickily, so a traffic cut alone stays in the phase.
  const deliveryRisks = isBandit
    ? detected.filter((r) => r !== "decrease-coverage")
    : detected;
  const severity = severityOf(deliveryRisks);

  const bias = isBandit
    ? SAME_PHASE_BIAS.sticky.none
    : SAME_PHASE_BIAS[stickyBucketing ? "sticky" : "no-sticky"][severity];
  // Without Sticky Bucketing even an ambiguous targeting change can't stay in
  // the phase; with it, only namespace and weight changes can't.
  const samePhaseUnsafe = isBandit
    ? severity !== "none"
    : severity === "unsafe" || (!stickyBucketing && severity === "ambiguous");

  const unavailableReason = (
    plan: ReleasePlan,
  ): ReleasePlanUnavailableReason | null => {
    if (!isBandit && !stickyBucketing && STICKY_ONLY_PLANS.includes(plan)) {
      return "requires-sticky-bucketing";
    }
    if (
      plan.startsWith("same-phase") &&
      samePhaseUnsafe &&
      (isBandit || changeType !== "advanced")
    ) {
      return "unsafe-for-change-type";
    }
    return null;
  };

  const planAssessment = (plan: ReleasePlan): ReleasePlanAssessment => {
    const reason = unavailableReason(plan);
    return {
      plan,
      available: !reason,
      unavailableReason: reason,
      bias:
        plan === "same-phase-keep-assignments"
          ? bias.keep
          : plan === "same-phase-reassign"
            ? bias.reassign
            : plan === "new-phase-keep-assignments"
              ? "may-bias"
              : "none",
      usersMaySwitchVariation:
        plan === "same-phase-reassign"
          ? severity !== "none"
          : plan === "new-phase-rerandomize" ||
            plan === "new-phase-exclude-exposed",
      analysisRestarts: plan.startsWith("new-phase"),
      banditRestarts: isBandit,
    };
  };

  const risks: RiskCode[] = [
    ...deliveryRisks,
    ...(live && changeType === "advanced" && !isBandit
      ? (["multiple-changes"] as const)
      : []),
    ...(live && isBandit ? (["bandit-restart"] as const) : []),
  ];

  return {
    // A new phase has no in-place form, so it always names how to seed it.
    requiresReleasePlan: changeType === "new-phase" || severity !== "none",
    risks: risks.map((code) => ({ code, message: RISK_MESSAGES[code] })),
    recommendedReleasePlan:
      changeType === "new-phase" || samePhaseUnsafe
        ? "new-phase-rerandomize"
        : isBandit
          ? "same-phase-keep-assignments"
          : bias.recommended,
    releasePlans: offeredPlans(changeType, isBandit).map(planAssessment),
    docUrl: MAKE_CHANGES_DOC_URL,
  };
}

export type PlanSelection =
  | { ok: true; plan: ReleasePlan | null }
  | { ok: false; reason: "required" }
  | {
      ok: false;
      reason: "not-allowed";
      rejection: ReleasePlanUnavailableReason;
    };

/** The plan to apply: the one requested, or null to apply in place. */
export function selectReleasePlan(
  assessment: ChangeAssessment,
  requested: ReleasePlan | undefined,
): PlanSelection {
  if (!requested) {
    return assessment.requiresReleasePlan
      ? { ok: false, reason: "required" }
      : { ok: true, plan: null };
  }
  const offered = assessment.releasePlans.find((p) => p.plan === requested);
  if (!offered) {
    return {
      ok: false,
      reason: "not-allowed",
      rejection: "unsafe-for-change-type",
    };
  }
  if (!offered.available) {
    return {
      ok: false,
      reason: "not-allowed",
      rejection: offered.unavailableReason ?? "unsafe-for-change-type",
    };
  }
  return { ok: true, plan: requested };
}
