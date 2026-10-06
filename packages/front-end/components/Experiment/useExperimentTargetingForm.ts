import { useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import omit from "lodash/omit";
import pick from "lodash/pick";
import isEqual from "lodash/isEqual";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
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

// What the targeting modal edits, for a caller that applies it to its own
// draft instead of saving (the Setup page; set in review). The rest of the
// targeting payload (coverage, split, namespace, ...) isn't the modal's.
export const TARGETING_DRAFT_FIELDS = [
  "condition",
  "savedGroups",
  "prerequisites",
  "hashAttribute",
  "fallbackAttribute",
  "attributeScopeAllProjects",
  "hashVersion",
  "disableStickyBucketing",
] as const;
export type TargetingDraft = Pick<
  ExperimentTargetingData,
  (typeof TARGETING_DRAFT_FIELDS)[number]
>;
// A caller's draft of what the targeting and namespace modals edit: either,
// both, or parts of them (set in review).
export type ExperimentTargetingDraft = Partial<
  TargetingDraft & Pick<ExperimentTargetingData, "namespace">
>;

// Whether two TargetingDraft-shaped values differ in substance. The
// condition editor rewrites the condition on mount (empty → "{}", JSON
// reformatted), so conditions compare by meaning, not text.
export function targetingDraftChanged(
  a: Partial<ExperimentTargetingData>,
  b: Partial<ExperimentTargetingData>,
): boolean {
  const parse = (condition: string | undefined) => {
    const c = (condition ?? "").trim();
    if (!c) return {};
    try {
      return JSON.parse(c);
    } catch {
      return c;
    }
  };
  return (
    !isEqual(parse(a.condition), parse(b.condition)) ||
    !isEqual(
      omit(pick(a, TARGETING_DRAFT_FIELDS), "condition"),
      omit(pick(b, TARGETING_DRAFT_FIELDS), "condition"),
    )
  );
}

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
  // With apply, the values are checked and tidied as for a save, then handed
  // to apply instead of saved.
  onSubmit: (
    mutate: () => void,
    scope?: ChangeType,
    apply?: (value: ExperimentTargetingData) => void,
  ) => () => Promise<void>;
}

// Shared by the targeting and traffic modals, which both POST to the same
// `/experiment/:id/targeting` endpoint. When `attributeScopeProjects` is
// omitted the pre-flight falls back to `experiment.project`.
// initialTargeting starts the form from a caller's draft instead of the
// experiment.
export function useExperimentTargetingForm(
  experiment: ExperimentInterfaceStringDates,
  attributeScopeProjects?: string[] | null,
  initialTargeting?: ExperimentTargetingDraft | null,
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

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    experiment.project,
  );

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const defaultValues = {
    ...getTargetingDefaults(experiment, hasSDKWithNoBucketingV2),
    ...(initialTargeting ?? {}),
  };

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });

  const onSubmit = (
    mutate: () => void,
    scope: ChangeType = "advanced",
    apply?: (value: ExperimentTargetingData) => void,
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

      // Existing persisted attribute values. Passed as `existingParts` so the
      // pre-flight only validates attributes the user actually changed —
      // unchanged stale hash/fallback/condition values won't block unrelated
      // saves even though we still POST the full payload.
      const existingAttributeParts = {
        hashAttribute: experiment.hashAttribute || "id",
        fallbackAttribute: experiment.fallbackAttribute || "",
        condition: lastPhase?.condition ?? "",
      };

      // Opt-in client-side pre-flight — mirrors the back-end check in
      // postExperimentTargeting so typo'd attributes fail fast without a
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

      if (apply) {
        apply(value);
        return;
      }

      await apiCall(`/experiment/${experiment.id}/targeting`, {
        method: "POST",
        body: JSON.stringify(value),
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

// The targeting payload as the experiment has it saved. Also the Setup
// page's base when it saves an applied ExperimentTargetingDraft.
export function getTargetingDefaults(
  experiment: ExperimentInterfaceStringDates,
  hasSDKWithNoBucketingV2: boolean,
) {
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];
  const lastPhaseVariations = getLatestPhaseVariations(experiment);
  return {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    prerequisites: lastPhase?.prerequisites ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
    attributeScopeAllProjects: experiment.attributeScopeAllProjects ?? false,
    hashVersion: experiment.hashVersion || (hasSDKWithNoBucketingV2 ? 1 : 2),
    disableStickyBucketing: experiment.disableStickyBucketing ?? false,
    bucketVersion: experiment.bucketVersion || 1,
    minBucketVersion: experiment.minBucketVersion || 0,
    namespace: (() => {
      const saved = lastPhase?.namespace;
      if (!saved) {
        // Canonical blank shape; matches what NamespaceSelector writes so
        // `isEqual(watched, defaults)` can't misfire from shape drift.
        return {
          enabled: false,
          name: "",
          format: "legacy" as const,
          ranges: [] as [number, number][],
        };
      }
      // Fold legacy `range` → `ranges` so defaults line up with the shape
      // NamespaceSelector produces immediately on mount.
      if ("range" in saved && !("ranges" in saved)) {
        return { ...omit(saved, "range"), ranges: [saved.range] };
      }
      return saved;
    })(),
    seed: lastPhase?.seed ?? "",
    trackingKey: experiment.trackingKey || "",
    variationWeights:
      lastPhase?.variationWeights ??
      getEqualWeights(lastPhaseVariations.length, 4),
    variations:
      lastPhase?.variations ??
      lastPhaseVariations.map((v) => ({
        id: v.id,
        status: "active" as const,
      })),
    newPhase: false,
    reseed: true,
  };
}
