import { UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import type {
  ChangeAssessment,
  ExperimentChangeType,
  ReleasePlan,
  ReleasePlanAssessment,
  RiskCode,
} from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import React, { ReactNode, useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import clsx from "clsx";
import { BiHide, BiShow } from "react-icons/bi";
import { BsCheckCircle, BsExclamationCircle } from "react-icons/bs";
import { PiLightbulb } from "react-icons/pi";
import useOrgSettings from "@/hooks/useOrgSettings";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import { DocLink } from "@/components/DocLink";
import { formatPercent } from "@/services/metrics";
import Callout from "@/ui/Callout";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  changeType?: ExperimentChangeType;
  assessment: ChangeAssessment | null;
  assessmentError: string | null;
  releasePlan?: ReleasePlan;
  setReleasePlan: (releasePlan: ReleasePlan) => void;
}

const PLAN_LABELS: Record<ReleasePlan, string> = {
  "new-phase-rerandomize": "New Phase, re-randomize traffic",
  "new-phase-keep-assignments": "New Phase, do not re-randomize",
  "new-phase-exclude-exposed":
    "New Phase, re-randomize traffic, block bucketed users",
  "same-phase-reassign": "Same Phase, apply changes to everyone",
  "same-phase-keep-assignments":
    "Same Phase, apply changes to new traffic only",
};

const BANDIT_PLAN_LABELS: Partial<Record<ReleasePlan, string>> = {
  "new-phase-rerandomize": "New Phase, reset Bandit",
  "same-phase-keep-assignments": "Same phase",
};

const STICKY_ONLY_PLANS: ReleasePlan[] = [
  "same-phase-keep-assignments",
  "new-phase-exclude-exposed",
];

const RISK_COPY: Partial<Record<RiskCode, ReactNode>> = {
  "more-restrictive-targeting": (
    <>
      <strong>More restrictive targeting conditions</strong> without starting a
      new phase may bias results. Some users already in the experiment analysis
      may begin receiving the default feature value.
    </>
  ),
  "ambiguous-targeting-change": (
    <>
      <strong>Ambiguous changes to targeting conditions</strong> without
      starting a new phase may bias results. Some users already in the
      experiment analysis may begin receiving the default feature value.
    </>
  ),
  "decrease-coverage": (
    <>
      <strong>Decreased traffic coverage</strong> without starting a new phase
      may bias results. Some users already in the experiment analysis will begin
      receiving the default feature value.
    </>
  ),
  "change-variation-weights": (
    <>
      <strong>Changing variation weights</strong> could lead to statistical bias
      and/or multiple exposures.
    </>
  ),
  "add-to-namespace": (
    <>
      <strong>More restrictive namespace targeting</strong> without starting a
      new phase may bias results as users in your experiment analysis may fall
      back to the default feature value.
    </>
  ),
};
// Both namespace risks share one line, as before.
RISK_COPY["decrease-namespace-range"] = RISK_COPY["add-to-namespace"];

// Risks Sticky Bucketing mitigates; namespace and weight changes it can't.
const STICKY_MITIGATED: RiskCode[] = [
  "more-restrictive-targeting",
  "ambiguous-targeting-change",
  "decrease-coverage",
];
const STICKY_UNMITIGATED: RiskCode[] = [
  "change-variation-weights",
  "add-to-namespace",
  "decrease-namespace-range",
];

function impactText(plan: ReleasePlan, isBandit: boolean): string {
  const phase = plan.startsWith("new-phase") ? "New phase" : "Same phase";
  if (isBandit) return `${phase}.`;
  const reseed =
    plan === "new-phase-rerandomize" || plan === "new-phase-exclude-exposed";
  return `${phase}, ${reseed ? "new" : "same"} randomization seed.`;
}

function stickyText(
  plan: ReleasePlan,
  isBandit: boolean,
  usingStickyBucketing: boolean,
): string {
  if (!isBandit && !usingStickyBucketing) return "No sticky bucketing.";
  if (
    !usingStickyBucketing ||
    plan === "same-phase-keep-assignments" ||
    plan === "new-phase-keep-assignments"
  ) {
    return "Sticky Bucketed users will keep their assigned bucket.";
  }
  if (plan === "new-phase-exclude-exposed") {
    return "Sticky Bucketed users will be excluded from the experiment.";
  }
  return "Sticky Bucketed users will be reassigned.";
}

export default function ReleaseChangesForm({
  experiment,
  form,
  changeType,
  assessment,
  assessmentError,
  releasePlan,
  setReleasePlan,
}: Props) {
  const settings = useOrgSettings();
  const usingStickyBucketing =
    !!settings.useStickyBucketing && !experiment.disableStickyBucketing;

  const isBandit = experiment.type === "multi-armed-bandit";

  const [showFullTargetingInfo, setShowFullTargetingInfo] = useState(false);

  if (!experiment.phases.length) return null;

  if (assessmentError) {
    return (
      <Callout status="error" mt="4">
        {assessmentError}
      </Callout>
    );
  }
  if (!assessment) {
    return (
      <div className="mt-4 mb-2 text-center">
        <LoadingSpinner />
      </div>
    );
  }

  const selected = assessment.releasePlans.find((p) => p.plan === releasePlan);

  return (
    <div className="mt-4 mb-2">
      <SelectField
        size="legacy"
        label="Release plan"
        value={releasePlan || ""}
        options={assessment.releasePlans.map((p) => ({
          label:
            (isBandit && BANDIT_PLAN_LABELS[p.plan]) || PLAN_LABELS[p.plan],
          value: p.plan,
        }))}
        onChange={(v) => {
          const plan = assessment.releasePlans.find((p) => p.plan === v);
          if (!plan?.available) return;
          setReleasePlan(plan.plan);
        }}
        sort={false}
        isSearchable={false}
        formatOptionLabel={({ value, label }) => {
          const plan = assessment.releasePlans.find((p) => p.plan === value);
          const disabled = !plan?.available;
          const requiresStickyBucketing =
            !isBandit && STICKY_ONLY_PLANS.includes(value as ReleasePlan);
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
              {value === assessment.recommendedReleasePlan && (
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

      {selected && (
        <div className="mt-4 mb-3">
          <label className="mb-1">Impact</label>
          <div className="font-weight-semibold">
            {impactText(selected.plan, isBandit)}{" "}
            {stickyText(selected.plan, isBandit, usingStickyBucketing)}
            {selected.banditRestarts && (
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
          </div>
        </div>
      )}

      {selected && changeType !== "new-phase" && (
        <ImpactTooltips
          assessment={assessment}
          plan={selected}
          usingStickyBucketing={usingStickyBucketing}
          isBandit={isBandit}
        />
      )}
      {changeType === "new-phase" &&
        releasePlan === "new-phase-keep-assignments" && (
          <Callout status="warning">
            Starting a new phase without re-randomizing can lead to carryover
            bias. Consider re-randomizing to mitigate.
          </Callout>
        )}

      {changeType !== "new-phase" && (
        <div className="mt-4 mb-1">
          <div className="d-flex">
            <label>Targeting and traffic changes</label>
            <div className="flex-1" />
            <div className="position-relative small" style={{ bottom: -6 }}>
              <a
                role="button"
                className="link-purple ml-3"
                onClick={() => setShowFullTargetingInfo(!showFullTargetingInfo)}
              >
                {showFullTargetingInfo ? (
                  <>
                    <BiHide className="mr-1" />
                    Show changes only
                  </>
                ) : (
                  <>
                    <BiShow className="mr-1" />
                    Show full targeting
                  </>
                )}
              </a>
            </div>
          </div>
          <div className="appbox bg-light px-3 pt-3 pb-0 mb-0">
            <TargetingInfo
              experiment={experiment}
              noHeader={true}
              targetingFieldsOnly={true}
              separateTrafficSplitDisplay={true}
              showDecimals={true}
              showNamespaceRanges={true}
              showChanges={true}
              showFullTargetingInfo={showFullTargetingInfo}
              changes={form.getValues()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ImpactTooltips({
  assessment,
  plan,
  usingStickyBucketing,
  isBandit,
}: {
  assessment: ChangeAssessment;
  plan: ReleasePlanAssessment;
  usingStickyBucketing: boolean;
  isBandit: boolean;
}) {
  const riskCodes = assessment.risks.map((r) => r.code);
  const switchToSB =
    !usingStickyBucketing || !STICKY_ONLY_PLANS.includes(plan.plan);
  const recommendStickyBucketing =
    plan.bias !== "none" &&
    riskCodes.some((r) => STICKY_MITIGATED.includes(r)) &&
    !riskCodes.some((r) => STICKY_UNMITIGATED.includes(r));
  const reasons = [
    ...new Set(riskCodes.map((code) => RISK_COPY[code]).filter(Boolean)),
  ];

  return (
    <div className="appbox bg-light px-3 pt-3 pb-0 mb-0">
      <div className="mb-1 font-weight-bold">Statistical impact</div>
      <div
        className={clsx("mb-3", {
          "text-success": plan.bias === "none",
          "text-warning-muted": plan.bias !== "none",
        })}
      >
        {plan.bias === "none" && (
          <span className="font-weight-semibold">
            <BsCheckCircle className="mr-1" /> Your changes will not bias
            experiment results.
          </span>
        )}
        {plan.bias === "may-bias" && (
          <span className="font-weight-semibold">
            <BsExclamationCircle className="mr-1" /> The changes you have made
            may bias experiment results.
          </span>
        )}
        {plan.bias === "high-risk" && (
          <span className="font-weight-semibold">
            <BsExclamationCircle className="mr-1" /> The changes you have made
            have a <strong>high risk</strong> of biasing experiment results.
          </span>
        )}
        {plan.analysisRestarts && (
          <div className="ml-4 mt-2 text-dark">
            Note: starting a new phase restarts the analysis collection window.
          </div>
        )}
        {plan.bias !== "none" && (
          <div className="mt-2 mb-0">
            <div className="pl-4">
              {reasons.map((reason, i) => (
                <div className="mt-2" key={i}>
                  {reason}
                </div>
              ))}
            </div>

            <Callout status="info" mt="2" mb="0" icon={<PiLightbulb />}>
              Re-randomize traffic{" "}
              {recommendStickyBucketing && switchToSB
                ? " or use Sticky Bucketing"
                : ""}{" "}
              to help mitigate.
            </Callout>
          </div>
        )}
      </div>

      <div className="mb-1 font-weight-bold">User experience impact</div>
      <div
        className={clsx("mb-3", {
          "text-success": !plan.usersMaySwitchVariation,
          "text-warning-muted": plan.usersMaySwitchVariation,
        })}
      >
        {plan.usersMaySwitchVariation ? (
          <div className="font-weight-semibold">
            <BsExclamationCircle className="mr-1" /> Some users may change their
            assigned variation.
          </div>
        ) : (
          <div className="font-weight-semibold">
            <BsCheckCircle className="mr-1" /> Users will keep their assigned
            variation.
          </div>
        )}

        {!isBandit &&
          plan.usersMaySwitchVariation &&
          plan.plan !== "same-phase-keep-assignments" && (
            <Callout status="info" mt="2" mb="0" icon={<PiLightbulb />}>
              You may be able to use Sticky Bucketing to prevent variation
              hopping.
            </Callout>
          )}
      </div>

      {!isBandit &&
        ((plan.usersMaySwitchVariation &&
          plan.plan !== "same-phase-keep-assignments") ||
          recommendStickyBucketing) && (
          <div className="text-right mb-2 small">
            <DocLink useRadix={false} docSection="stickyBucketing">
              Learn about Sticky Bucketing <FaExternalLinkAlt />
            </DocLink>
          </div>
        )}
    </div>
  );
}
