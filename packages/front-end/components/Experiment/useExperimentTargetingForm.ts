import { useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import isEqual from "lodash/isEqual";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import {
  areVariationWeightsValid,
  changedTargeting,
  getTargetingDefaults,
} from "shared/experiments";
import { validateAndFixCondition } from "shared/util";
import { mergeContiguousRanges } from "@/components/Features/NamespaceSelectorUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import { useAuth } from "@/services/auth";
import { useIncrementer } from "@/hooks/useIncrementer";
import {
  useAttributeSchema,
  useStrictAttributeProjectScoping,
  validateUnregisteredAttributes,
} from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { allConnectionsSupportBucketingV2 } from "./HashVersionSelector";
import { ChangeType } from "./MakeChangesFlow";
import {
  experimentFieldChanges,
  StageTargeting,
} from "./TabbedPage/ExperimentEdits";

export interface UseExperimentTargetingFormResult {
  form: UseFormReturn<ExperimentTargetingData>;
  // Loosely typed because `useForm` accepts a `DeepPartial<ExperimentTargetingData>`
  // and the namespace shape produced here doesn't always match the strict
  // `ExperimentTargetingData` shape (legacy vs. multi-range namespaces).
  defaultValues: Record<string, unknown>;
  conditionKey: number;
  prerequisiteTargetingSdkIssues: boolean;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
  canSubmit: boolean;
  /** Writes the form, or hands the validated payload to `stage` instead. */
  onSubmit: (
    mutate: () => void,
    scope?: ChangeType,
    stage?: StageTargeting,
  ) => () => Promise<void>;
}

/** What the experiment targets now, with the hash version the org's SDKs can run. */
export function useTargetingDefaults(
  experiment: ExperimentInterfaceStringDates,
) {
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    experiment.project,
  );
  return getTargetingDefaults(experiment, hasSDKWithNoBucketingV2 ? 1 : 2);
}

// Without `attributeScopeProjects` the pre-flight falls back to
// `experiment.project`. A staged `draft` is what the form opens on.
export function useExperimentTargetingForm(
  experiment: ExperimentInterfaceStringDates,
  attributeScopeProjects?: string[] | null,
  draft?: ExperimentTargetingData | null,
): UseExperimentTargetingFormResult {
  const { apiCall } = useAuth();
  const orgSettings = useOrgSettings();
  // Unfiltered so the pre-flight can distinguish unknown vs out-of-project.
  const allAttributesSchema = useAttributeSchema(false);
  const strictScoping = useStrictAttributeProjectScoping();
  const [conditionKey, forceConditionRender] = useIncrementer();
  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const stored = useTargetingDefaults(experiment);
  const defaultValues = draft ?? stored;
  // As the form opened, so a change saved since conflicts instead of being
  // overwritten.
  const [opened] = useState(() => ({ experiment, targeting: stored }));

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });

  const onSubmit = (
    mutate: () => void,
    scope: ChangeType = "advanced",
    stage?: StageTargeting,
  ) =>
    form.handleSubmit(async (value) => {
      // Targeting fields (saved groups, condition, prerequisites) are only
      // editable from the targeting modal and the unscoped/advanced flow. Skip
      // their non-change-aware validation otherwise so a traffic- or
      // namespace-only save can't be blocked by a stale targeting value the
      // user never saw.
      const targetingEditable = scope === "targeting" || scope === "advanced";

      if (targetingEditable) {
        validateSavedGroupTargeting(value.savedGroups);

        validateAndFixCondition(value.condition, (condition) => {
          form.setValue("condition", condition);
          forceConditionRender();
        });

        if (value.prerequisites) {
          if (value.prerequisites.some((p) => !p.id)) {
            throw new Error("Cannot have empty prerequisites");
          }
        }
      }

      if (prerequisiteTargetingSdkIssues) {
        throw new Error("Prerequisite targeting issues must be resolved");
      }

      if (
        experiment.type !== "multi-armed-bandit" &&
        (value.newPhase ||
          !isEqual(value.variationWeights, lastPhase?.variationWeights)) &&
        !areVariationWeightsValid(value.variationWeights)
      ) {
        throw new Error("Variation weights must add up to 100%.");
      }

      // Existing persisted attribute values. Passed as `existingParts` so the
      // pre-flight only validates attributes the user actually changed —
      // unchanged stale hash/fallback/condition values won't block unrelated
      // saves even though we still POST the full payload.
      const existingAttributeParts = {
        hashAttribute: experiment.hashAttribute || "id",
        fallbackAttribute: experiment.fallbackAttribute || "",
        condition: lastPhase?.condition ?? "",
      };

      // Opt-in client-side pre-flight — mirrors the back-end check in the
      // experiment update planner so typo'd attributes fail fast without a
      // round-trip and with the same error wording.
      validateUnregisteredAttributes(
        {
          hashAttribute: (value as { hashAttribute?: string }).hashAttribute,
          fallbackAttribute: (value as { fallbackAttribute?: string })
            .fallbackAttribute,
          condition: value.condition,
        },
        "experiment",
        {
          attributeSchema: allAttributesSchema,
          requireRegisteredAttributes: orgSettings.requireRegisteredAttributes,
          project:
            value.attributeScopeAllProjects && !strictScoping
              ? null
              : attributeScopeProjects !== undefined
                ? attributeScopeProjects
                : experiment.project || undefined,
        },
        existingAttributeParts,
      );

      // Collapse contiguous / overlapping namespace ranges on save so the
      // persisted phase carries a clean shape (e.g. [0.6, 0.9] + [0.9, 1] →
      // [0.6, 1]). We do this here rather than while the user is editing so
      // ranges don't flicker and collapse mid-edit.
      const ns = value.namespace as
        | { enabled?: boolean; ranges?: [number, number][] }
        | undefined;
      if (ns?.enabled && ns.ranges && ns.ranges.length > 0) {
        ns.ranges = mergeContiguousRanges(ns.ranges);
      }

      if (stage) {
        stage(value, opened);
        return;
      }

      // Only what changed, so a save over someone else's change is refused.
      await apiCall(`/experiment/${experiment.id}/changes`, {
        method: "POST",
        body: JSON.stringify({
          ...experimentFieldChanges(
            opened.experiment,
            changedTargeting(value, opened.targeting),
          ),
          release: { newPhase: value.newPhase, reseed: value.reseed },
        }),
      });
      mutate();
    });

  return {
    form,
    defaultValues,
    conditionKey,
    prerequisiteTargetingSdkIssues,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  };
}
