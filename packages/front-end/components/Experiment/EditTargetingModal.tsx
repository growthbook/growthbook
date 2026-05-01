import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import omit from "lodash/omit";
import { useState } from "react";
import { validateAndFixCondition } from "shared/util";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { mergeContiguousRanges } from "@/components/Features/NamespaceSelectorUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { allConnectionsSupportBucketingV2 } from "./HashVersionSelector";
import TargetingForm from "./TargetingForm";
import MakeChangesFlow from "./MakeChangesFlow";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTargetingModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const { apiCall } = useAuth();
  const [conditionKey, forceConditionRender] = useIncrementer();

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    experiment.project,
  );

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const lastPhaseVariations = getLatestPhaseVariations(experiment);

  const defaultValues = {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    prerequisites: lastPhase?.prerequisites ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
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

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });

  const onSubmit = form.handleSubmit(async (value) => {
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

    if (prerequisiteTargetingSdkIssues) {
      throw new Error("Prerequisite targeting issues must be resolved");
    }

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

    await apiCall(`/experiment/${experiment.id}/targeting`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
  });

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Targeting"
        ctaEnabled={canSubmit}
        submit={onSubmit}
        size="lg"
      >
        <TargetingForm
          experiment={experiment}
          form={form}
          safeToEdit={true}
          conditionKey={conditionKey}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
      </ModalStandard>
    );
  }

  return (
    <MakeChangesFlow
      experiment={experiment}
      form={form}
      defaultValues={defaultValues}
      onSubmit={onSubmit}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
