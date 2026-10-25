import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import React, { ReactNode, useEffect, useMemo } from "react";
import clsx from "clsx";
import { FeaturePrerequisite, SavedGroupTargeting } from "shared/types/feature";
import { PiArrowSquareOut, PiLightbulb } from "react-icons/pi";
import {
  getNamespaceRanges,
  hasNarrowedRanges,
  NamespaceValue,
} from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  ChangeType,
  ReleasePlan,
} from "@/components/Experiment/MakeChangesFlow";
import { TargetingChanges } from "@/components/Experiment/TabbedPage/TargetingInfo";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DocLink } from "@/components/DocLink";
import { formatPercent } from "@/services/metrics";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  changeType?: ChangeType;
  releasePlan?: ReleasePlan;
  setReleasePlan: (releasePlan: ReleasePlan) => void;
}

export default function ReleaseChangesForm({
  experiment,
  form,
  changeType,
  releasePlan,
  setReleasePlan,
}: Props) {
  const settings = useOrgSettings();
  const orgStickyBucketing = !!settings.useStickyBucketing;
  const usingStickyBucketing =
    orgStickyBucketing && !experiment.disableStickyBucketing;

  const isBandit = experiment.type === "multi-armed-bandit";

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const formValues = form.getValues();

  const recommendedRolloutData = useMemo(
    () =>
      getRecommendedRolloutData({
        experiment,
        data: formValues,
        stickyBucketing: usingStickyBucketing,
      }),
    [experiment, formValues, usingStickyBucketing],
  );

  // set the release plan selector to the recommended value
  useEffect(() => {
    if (releasePlan) return; // only set if use hasn't interacted
    if (changeType === "phase") return;
    if (recommendedRolloutData.actualReleasePlan) {
      setReleasePlan(recommendedRolloutData.actualReleasePlan);
    }
  }, [
    recommendedRolloutData.actualReleasePlan,
    releasePlan,
    setReleasePlan,
    changeType,
  ]);

  // set the default values for each of the user prompt options
  useEffect(() => {
    if (releasePlan === "same-phase-sticky") {
      form.setValue("newPhase", false);
      form.setValue("reseed", isBandit);
      form.setValue("bucketVersion", experiment.bucketVersion);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    } else if (releasePlan === "same-phase-everyone") {
      form.setValue("newPhase", false);
      form.setValue("reseed", false);
      form.setValue("bucketVersion", (experiment.bucketVersion ?? 0) + 1);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    } else if (releasePlan === "new-phase") {
      form.setValue("newPhase", true);
      form.setValue("reseed", true);
      form.setValue("bucketVersion", (experiment.bucketVersion ?? 0) + 1);
      form.setValue("minBucketVersion", experiment.minBucketVersion ?? 0);
    } else if (releasePlan === "new-phase-same-seed") {
      form.setValue("newPhase", true);
      form.setValue("reseed", false);
      form.setValue("bucketVersion", experiment.bucketVersion);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    } else if (releasePlan === "new-phase-block-sticky") {
      form.setValue("newPhase", true);
      form.setValue("reseed", true);
      form.setValue("bucketVersion", (experiment.bucketVersion ?? 0) + 1);
      form.setValue("minBucketVersion", (experiment.bucketVersion ?? 0) + 1);
    }
    // todo: new phase sticky?
    if (!usingStickyBucketing) {
      form.setValue("bucketVersion", experiment.bucketVersion);
      form.setValue("minBucketVersion", experiment.minBucketVersion);
    }
  }, [
    releasePlan,
    usingStickyBucketing,
    form,
    experiment.bucketVersion,
    experiment.minBucketVersion,
    isBandit,
  ]);

  if (!lastPhase) return null;

  return (
    <div className="mt-4 mb-2">
      <SelectField
        size="legacy"
        label="Release plan"
        value={releasePlan || ""}
        options={getReleasePlanOptions({
          experiment,
          changeType,
          recommendedRolloutData,
        })}
        onChange={(v) => {
          const requiresStickyBucketing =
            !isBandit &&
            (v === "same-phase-sticky" || v === "new-phase-block-sticky");
          const disabled = requiresStickyBucketing && !usingStickyBucketing;
          if (disabled) return;
          setReleasePlan(v as ReleasePlan);
        }}
        sort={false}
        isSearchable={false}
        formatOptionLabel={({ value, label }) => {
          const requiresStickyBucketing =
            !isBandit &&
            (value === "same-phase-sticky" ||
              value === "new-phase-block-sticky");
          const recommended = isBandit
            ? value === recommendedRolloutData.recommendedReleasePlan &&
              changeType !== "phase"
            : value === recommendedRolloutData.recommendedReleasePlan;
          const disabled = requiresStickyBucketing && !usingStickyBucketing;
          return (
            <div
              className={clsx({
                "cursor-disabled": disabled,
              })}
            >
              <span style={{ opacity: disabled ? 0.5 : 1 }}>{label} </span>
              {requiresStickyBucketing && (
                <Tooltip
                  body={`${
                    usingStickyBucketing ? "Uses" : "Requires"
                  } Sticky Bucketing`}
                  className="mr-2"
                >
                  <span className="text-info small ml-2">
                    (Sticky Bucketing)
                  </span>
                </Tooltip>
              )}
              {recommended && (
                <span
                  className="text-muted uppercase-title float-right position-relative"
                  style={{ top: 3 }}
                >
                  recommended
                </span>
              )}
            </div>
          );
        }}
      />

      <div className="mt-4 mb-3">
        <label className="mb-1">Impact</label>
        <Text as="div" color="text-high" mb="2">
          {form.watch("newPhase")
            ? form.watch("reseed")
              ? `New phase${!isBandit ? ", new randomization seed." : "."}`
              : `New phase${!isBandit ? ", same randomization seed." : "."}`
            : form.watch("reseed")
              ? `Same phase${!isBandit ? ", new randomization seed." : "."}`
              : `Same phase${
                  !isBandit ? ", same randomization seed." : "."
                }`}{" "}
          {isBandit &&
            form.watch("newPhase") &&
            "Variation weights will be reset. "}
          {isBandit || usingStickyBucketing
            ? (form.watch("bucketVersion") ?? 0) <=
              (experiment.bucketVersion ?? 0)
              ? "Sticky Bucketed users will keep their assigned bucket."
              : (form.watch("minBucketVersion") ?? 0) <=
                  (experiment.minBucketVersion ?? 0)
                ? "Sticky Bucketed users will be reassigned."
                : "Sticky Bucketed users will be excluded from the experiment."
            : "No sticky bucketing."}
          {form.watch("newPhase") && isBandit && (
            <Callout status="warning" mt="2">
              This Bandit will restart. Variation weights will reset (
              {(() => {
                const variations = getLatestPhaseVariations(experiment);
                return variations
                  .map((_, i) =>
                    i < 3
                      ? formatPercent(1 / (variations.length ?? 2))
                      : i === 3
                        ? "..."
                        : null,
                  )
                  .filter(Boolean)
                  .join(", ");
              })()}
              ).
            </Callout>
          )}
        </Text>
        {recommendedRolloutData && changeType !== "phase" && (
          <ReleaseImpact
            recommendedRolloutData={recommendedRolloutData}
            releasePlan={releasePlan}
            usingStickyBucketing={usingStickyBucketing}
            newPhase={form.watch("newPhase")}
            isBandit={isBandit}
          />
        )}
      </div>

      {changeType === "phase" && releasePlan === "new-phase-same-seed" && (
        <Callout status="warning">
          Starting a new phase without re-randomizing can lead to carryover
          bias. Consider re-randomizing to mitigate.
        </Callout>
      )}

      <div className="mt-4 mb-1">
        <label className="mb-1">Changes</label>
        <TargetingChanges experiment={experiment} value={form.getValues()} />
      </div>
    </div>
  );
}

function ReleaseImpact({
  recommendedRolloutData,
  releasePlan = "",
  usingStickyBucketing = false,
  newPhase,
  isBandit = false,
}: {
  recommendedRolloutData: RecommendedRolloutData;
  releasePlan?: ReleasePlan;
  usingStickyBucketing?: boolean;
  newPhase: boolean;
  isBandit: boolean;
}) {
  const switchToSB =
    !usingStickyBucketing ||
    !["same-phase-sticky", "new-phase-block-sticky"].includes(releasePlan);
  const riskLevel = recommendedRolloutData.riskLevels[releasePlan];
  const variationHopping = recommendedRolloutData.variationHopping[releasePlan];

  let recommendStickyBucketing = false;
  if (riskLevel !== "safe") {
    if (
      recommendedRolloutData.reasons.moreRestrictiveTargeting ||
      recommendedRolloutData.reasons.otherTargetingChanges ||
      recommendedRolloutData.reasons.decreaseCoverage
    ) {
      recommendStickyBucketing = true;
    }
    if (
      recommendedRolloutData.reasons.changeVariationWeights ||
      recommendedRolloutData.reasons.disableVariation ||
      recommendedRolloutData.reasons.addToNamespace ||
      recommendedRolloutData.reasons.decreaseNamespaceRange ||
      recommendedRolloutData.reasons.otherNamespaceChanges
    ) {
      recommendStickyBucketing = false;
    }
  }

  const { reasons } = recommendedRolloutData;
  const showReasons = riskLevel !== "safe" && releasePlan !== "new-phase";
  const notes: ReactNode[] = [
    ...(showReasons
      ? [
          reasons.moreRestrictiveTargeting && (
            <>
              <strong>More restrictive targeting conditions</strong> without
              starting a new phase may bias results. Some users already in the
              experiment analysis may begin receiving the default feature value.
            </>
          ),
          reasons.otherTargetingChanges && (
            <>
              <strong>Ambiguous changes to targeting conditions</strong> without
              starting a new phase may bias results. Some users already in the
              experiment analysis may begin receiving the default feature value.
            </>
          ),
          reasons.decreaseCoverage && (
            <>
              <strong>Decreased traffic coverage</strong> without starting a new
              phase may bias results. Some users already in the experiment
              analysis will begin receiving the default feature value.
            </>
          ),
          reasons.changeVariationWeights && (
            <>
              <strong>Changing variation weights</strong> could lead to
              statistical bias and/or multiple exposures.
            </>
          ),
          reasons.disableVariation && (
            <>
              <strong>Disabling or re-enabling a variation</strong> could lead
              to statistical bias and/or multiple exposures.
            </>
          ),
          (reasons.addToNamespace ||
            reasons.decreaseNamespaceRange ||
            reasons.otherNamespaceChanges) && (
            <>
              <strong>More restrictive namespace targeting</strong> without
              starting a new phase may bias results as users in your experiment
              analysis may fall back to the default feature value.
            </>
          ),
        ]
      : []),
    newPhase && "Starting a new phase restarts the analysis collection window.",
  ].filter(Boolean);
  // One place for what would help, rather than a tip under each risk.
  const tips = [
    showReasons &&
      `Re-randomize traffic${
        recommendStickyBucketing && switchToSB ? " or use Sticky Bucketing" : ""
      } to help mitigate.`,
    !isBandit &&
      variationHopping &&
      releasePlan !== "same-phase-sticky" &&
      "You may be able to use Sticky Bucketing to prevent variation hopping.",
  ].filter(Boolean);
  const showDocs =
    !isBandit &&
    ((variationHopping && releasePlan !== "same-phase-sticky") ||
      recommendStickyBucketing);

  return (
    <Flex direction="column" gap="2">
      <Box>
        <HelperText status={riskLevel === "safe" ? "success" : "warning"}>
          {riskLevel === "safe" ? (
            "Your changes will not bias experiment results."
          ) : riskLevel === "warning" ? (
            "Your changes may bias experiment results."
          ) : (
            <>
              Your changes have a <strong>high risk</strong> of biasing
              experiment results.
            </>
          )}
          {/* Under the line they explain, lined up with its text. */}
          {notes.map((note, i) => (
            <Box key={i} mt="1">
              <Text color="text-mid">{note}</Text>
            </Box>
          ))}
        </HelperText>
      </Box>
      <HelperText status={variationHopping ? "warning" : "success"}>
        {variationHopping
          ? "Some users may change their assigned variation."
          : "Users will keep their assigned variation."}
      </HelperText>
      {tips.length ? (
        <Callout status="info" icon={<PiLightbulb />}>
          {tips.join(" ")}
          {showDocs ? (
            <>
              {" "}
              <DocLink docSection="stickyBucketing">
                Learn about Sticky Bucketing <PiArrowSquareOut />
              </DocLink>
            </>
          ) : null}
        </Callout>
      ) : null}
    </Flex>
  );
}

type RiskLevel = "safe" | "warning" | "danger";

interface RecommendedRolloutData {
  recommendedReleasePlan: ReleasePlan | undefined;
  actualReleasePlan: ReleasePlan | undefined;
  riskLevels: {
    "new-phase": RiskLevel;
    "same-phase-sticky": RiskLevel;
    "same-phase-everyone": RiskLevel;
    "new-phase-block-sticky": RiskLevel;
  };
  variationHopping: {
    "new-phase": boolean;
    "same-phase-sticky": boolean;
    "same-phase-everyone": boolean;
    "new-phase-block-sticky": boolean;
  };
  disableSamePhase: boolean;
  reasons: {
    moreRestrictiveTargeting?: boolean;
    otherTargetingChanges?: boolean;
    decreaseCoverage?: boolean;
    addToNamespace?: boolean;
    decreaseNamespaceRange?: boolean;
    otherNamespaceChanges?: boolean;
    changeVariationWeights?: boolean;
    disableVariation?: boolean;
  };
}
function getRecommendedRolloutData({
  experiment,
  data,
  stickyBucketing,
}: {
  experiment: ExperimentInterfaceStringDates;
  data: ExperimentTargetingData;
  stickyBucketing: boolean;
}): RecommendedRolloutData {
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];
  const isBandit = experiment.type === "multi-armed-bandit";

  let recommendedReleasePlan: ReleasePlan | undefined = undefined;
  let actualReleasePlan: ReleasePlan | undefined = undefined;
  let riskLevels: RecommendedRolloutData["riskLevels"] = {
    "new-phase": "safe",
    "same-phase-sticky": "safe",
    "same-phase-everyone": "safe",
    "new-phase-block-sticky": "safe",
  };
  const variationHopping: RecommendedRolloutData["variationHopping"] = {
    "new-phase": true,
    "same-phase-sticky": false,
    "same-phase-everyone": false,
    "new-phase-block-sticky": true,
  };
  let disableSamePhase = false;

  // Returned meta:
  let reasons: RecommendedRolloutData["reasons"] = {};

  // Decision variables (1-8):
  let moreRestrictiveTargeting = false;
  let otherTargetingChanges = false;
  let decreaseCoverage = false;
  let addToNamespace = false;
  let decreaseNamespaceRange = false;
  const otherNamespaceChanges = false;
  let changeVariationWeights = false;
  const disableVariation = false;

  // Assign decision variables (1-8)
  // ===============================

  // 1. More restrictive targeting (conditions)?
  // Remove outer curly braces from condition so we can use it to look for substrings
  // e.g. If they have 3 conditions ANDed together and delete one, that is a safe change
  // But if they add new conditions or modify an existing one, that is not
  // There are some edge cases with '$or' that are not handled correctly, but those are super rare
  const strippedCondition = data.condition.slice(1).slice(0, -1);
  if (!(lastPhase.condition || "").includes(strippedCondition)) {
    moreRestrictiveTargeting = true;
  }
  const savedGroupsRestrictiveness = compareSavedGroups(
    data.savedGroups || [],
    lastPhase.savedGroups || [],
  );

  const prerequisiteRestrictiveness = comparePrerequisites(
    data.prerequisites || [],
    lastPhase.prerequisites || [],
  );

  // 1. More restrictive targeting (saved groups & prerequisites)?
  if (
    savedGroupsRestrictiveness === "more" ||
    prerequisiteRestrictiveness === "more"
  ) {
    moreRestrictiveTargeting = true;
  }
  // 2. Other targeting changes (saved groups & prerequisites)?
  if (
    savedGroupsRestrictiveness === "other" ||
    prerequisiteRestrictiveness === "other"
  ) {
    otherTargetingChanges = true;
  }

  // 3. Decrease coverage?
  if (data.coverage < (lastPhase.coverage ?? 1)) {
    decreaseCoverage = true;
  }

  // 4. Add to namespace?
  if (
    data.namespace?.enabled &&
    (!lastPhase.namespace?.enabled ||
      data.namespace.name !== lastPhase.namespace?.name)
  ) {
    addToNamespace = true;
  }

  // 5. Decrease namespace range?
  if (
    data.namespace?.enabled &&
    lastPhase.namespace?.enabled &&
    data.namespace.name === lastPhase.namespace.name
  ) {
    const currentRanges = data.namespace
      ? getNamespaceRanges(data.namespace as NamespaceValue)
      : ([[0, 1]] as [number, number][]);
    const lastRanges = lastPhase.namespace
      ? getNamespaceRanges(lastPhase.namespace as NamespaceValue)
      : ([[0, 1]] as [number, number][]);

    // Warn whenever any user from the previous ranges would be excluded —
    // this covers both total-coverage reduction and range shifts that keep
    // the same total size but move the window (e.g. [0.2,0.6] → [0.0,0.4]).
    if (hasNarrowedRanges(lastRanges, currentRanges)) {
      decreaseNamespaceRange = true;
    }
  }

  // 6. Other namespace changes?
  // nothing here yet

  // 7.
  // Changing variation weights will almost certainly cause an SRM error
  if (
    JSON.stringify(data.variationWeights) !==
    JSON.stringify(lastPhase.variationWeights)
  ) {
    changeVariationWeights = true;
  }

  // // 8. Disable variation?
  // todo: blocked variations not implemented yet

  // Make recommendations, control available options
  // --> based on decision variables (1-8) and sticky bucketing support
  // ===============================

  if (!isBandit) {
    // A. Nothing risky has changed
    if (
      !moreRestrictiveTargeting &&
      !otherTargetingChanges &&
      !decreaseCoverage &&
      !addToNamespace &&
      !decreaseNamespaceRange &&
      !otherNamespaceChanges &&
      !changeVariationWeights &&
      !disableVariation
    ) {
      // recommend no release changes
      recommendedReleasePlan = "same-phase-sticky";
      actualReleasePlan = stickyBucketing
        ? recommendedReleasePlan
        : "same-phase-everyone";
      variationHopping["same-phase-everyone"] = false;
    } else {
      // B. Calculate recommendations as if sticky bucketing is enabled
      // (We will override these later if it is not. Calculating this allows us to
      // show the user the benefits of enabling sticky bucketing)
      if (moreRestrictiveTargeting || decreaseCoverage || disableVariation) {
        // safe
        recommendedReleasePlan = "same-phase-sticky";
        actualReleasePlan = recommendedReleasePlan;
        riskLevels = {
          "new-phase": "safe",
          "same-phase-sticky": "safe",
          "same-phase-everyone": disableVariation ? "danger" : "warning",
          "new-phase-block-sticky": "safe",
        };
        variationHopping["same-phase-everyone"] = true;
        reasons = {
          ...reasons,
          moreRestrictiveTargeting,
          decreaseCoverage,
          disableVariation,
        };
      }
      if (otherTargetingChanges) {
        // warning
        recommendedReleasePlan = "new-phase";
        actualReleasePlan = recommendedReleasePlan;
        riskLevels = {
          "new-phase": "safe",
          "same-phase-sticky": "warning",
          "same-phase-everyone": "danger",
          "new-phase-block-sticky": "safe",
        };
        variationHopping["same-phase-everyone"] = true;
        reasons = { ...reasons, otherTargetingChanges };
      }
      if (
        addToNamespace ||
        decreaseNamespaceRange ||
        otherNamespaceChanges ||
        changeVariationWeights
      ) {
        // danger
        recommendedReleasePlan = "new-phase";
        actualReleasePlan = recommendedReleasePlan;
        disableSamePhase = true;
        riskLevels = {
          "new-phase": "safe",
          "same-phase-sticky": "danger",
          "same-phase-everyone": "danger",
          "new-phase-block-sticky": "safe",
        };
        variationHopping["same-phase-everyone"] = true;
        reasons = {
          ...reasons,
          addToNamespace,
          decreaseNamespaceRange,
          otherNamespaceChanges,
          changeVariationWeights,
        };
      }

      // C. Calculate recommendations when sticky bucketing is disabled
      if (!stickyBucketing) {
        // reset
        actualReleasePlan = "same-phase-everyone";
        riskLevels = {
          "new-phase": "safe",
          "same-phase-sticky": "safe",
          "same-phase-everyone": "safe",
          "new-phase-block-sticky": "safe",
        };
        variationHopping["same-phase-everyone"] = false;
        disableSamePhase = false;
        reasons = {};

        if (moreRestrictiveTargeting || decreaseCoverage) {
          // warning
          actualReleasePlan = "new-phase";
          riskLevels = {
            "new-phase": "safe",
            "same-phase-sticky": "safe",
            "same-phase-everyone": "warning",
            "new-phase-block-sticky": "safe",
          };
          variationHopping["same-phase-everyone"] = true;
          reasons = {
            ...reasons,
            moreRestrictiveTargeting,
            decreaseCoverage,
          };
        }
        if (
          addToNamespace ||
          decreaseNamespaceRange ||
          otherNamespaceChanges ||
          otherTargetingChanges ||
          changeVariationWeights ||
          disableVariation
        ) {
          // danger
          actualReleasePlan = "new-phase";
          disableSamePhase = true;
          riskLevels = {
            "new-phase": "safe",
            "same-phase-sticky": "danger",
            "same-phase-everyone": "danger",
            "new-phase-block-sticky": "safe",
          };
          variationHopping["same-phase-everyone"] = true;
          reasons = {
            ...reasons,
            otherTargetingChanges,
            otherNamespaceChanges,
            changeVariationWeights,
            disableVariation,
          };
        }
      }
    }
  }
  // isBandit
  else {
    // Start with safe change (nothing || rollout change)
    recommendedReleasePlan = "same-phase-sticky";
    actualReleasePlan = recommendedReleasePlan;
    disableSamePhase = false;
    riskLevels = {
      "new-phase": "safe",
      "same-phase-sticky": "safe",
      "same-phase-everyone": "safe",
      "new-phase-block-sticky": "safe",
    };
    variationHopping["new-phase"] = true;
    variationHopping["same-phase-sticky"] = false;

    // If anything other than traffic changes, force a new phase
    if (
      moreRestrictiveTargeting ||
      otherTargetingChanges ||
      addToNamespace ||
      decreaseNamespaceRange ||
      otherNamespaceChanges ||
      changeVariationWeights ||
      disableVariation
    ) {
      recommendedReleasePlan = undefined;
      actualReleasePlan = "new-phase";
      disableSamePhase = true;
    }
  }

  return {
    recommendedReleasePlan,
    actualReleasePlan,
    riskLevels,
    variationHopping,
    disableSamePhase,
    reasons,
  };
}

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

  // Merge data.savedGroups
  for (const group of current) {
    if (group.match === "any") {
      totalCurrentAnyGroups++;
    } else {
      for (const id of group.ids) {
        mergedDataIds[group.match].add(id);
      }
    }
  }
  // Merge lastPhase.savedGroups
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

  // compare ANY group counts
  if (totalCurrentAnyGroups > totalLastPhaseAnyGroups) {
    moreRestrictive = true;
  }
  if (totalCurrentAnyGroups < totalLastPhaseAnyGroups) {
    lessRestrictive = true;
  }

  // Compare merged groups
  for (const matchType of ["all", "none"] as ("all" | "none")[]) {
    const currentIds = mergedDataIds[matchType];
    const lastIds = mergedLastPhaseIds[matchType];

    const addedIds = new Set([...currentIds].filter((id) => !lastIds.has(id)));
    const removedIds = new Set(
      [...lastIds].filter((id) => !currentIds.has(id)),
    );

    if (addedIds.size > 0) {
      moreRestrictive = true;
    }
    if (removedIds.size > 0) {
      lessRestrictive = true;
    }
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
    // loop through current prerequisites and see if all match last
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

function getReleasePlanOptions({
  experiment,
  changeType,
  recommendedRolloutData,
}: {
  experiment: ExperimentInterfaceStringDates;
  changeType?: ChangeType;
  recommendedRolloutData: RecommendedRolloutData;
}) {
  if (experiment.type !== "multi-armed-bandit") {
    return [
      { label: "New Phase, re-randomize traffic", value: "new-phase" },
      ...(changeType === "phase"
        ? [
            {
              label: "New Phase, do not re-randomize",
              value: "new-phase-same-seed",
            },
          ]
        : []), //todo: make for "new phase" only
      ...(changeType === "advanced"
        ? [
            {
              label: "New Phase, re-randomize traffic, block bucketed users",
              value: "new-phase-block-sticky",
            },
          ]
        : []),
      ...(changeType !== "phase" &&
      (!recommendedRolloutData.disableSamePhase || changeType === "advanced")
        ? [
            {
              label: "Same Phase, apply changes to everyone",
              value: "same-phase-everyone",
            },
            {
              label: "Same Phase, apply changes to new traffic only",
              value: "same-phase-sticky",
            },
          ]
        : []),
    ];
  } else {
    return [
      { label: "New Phase, reset Bandit", value: "new-phase" },
      ...(!recommendedRolloutData.disableSamePhase && changeType !== "phase"
        ? [
            {
              label: "Same phase",
              value: "same-phase-sticky",
            },
          ]
        : []),
    ];
  }
}
