import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { FeatureValueType } from "shared/types/feature";
import {
  castFeatureValue,
  isManagedByExperiment,
  validateFeatureValue,
} from "shared/util";
import { Box } from "@radix-ui/themes";
import { useState } from "react";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ValueTypeField from "@/components/Features/FeatureModal/ValueTypeField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { distributeWeights } from "@/services/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import track from "@/services/track";
import EditTrafficModal from "./EditTrafficModal";
import ExperimentManagedFeatureVariationEditor from "./ExperimentManagedFeatureVariationEditor";
import { ManagedSortableVariation } from "./ExperimentManagedFeatureVariationRow";

/** Boolean is a poor fit for most experiments, so it sits last. */
const VALUE_TYPE_ORDER: FeatureValueType[] = [
  "string",
  "json",
  "number",
  "boolean",
];

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  safeToEdit: boolean;
  // Auto-focus this variation's Name field when the modal opens.
  focusVariationId?: string | null;
  // Append a new variation on open and focus its Name field.
  addVariationOnOpen?: boolean;
}

/**
 * The Edit Traffic & Variations modal for an experiment whose implementation is
 * a single Feature Flag: the variations table gains a Value column, and saving
 * stages the flag's values alongside the experiment change. A flag the
 * experiment manages also gets the value-type picker.
 *
 * A fork of `EditTrafficModal` rather than a branch inside it — this path
 * carries its own state, its own second write, and its own editor, and none of
 * that belongs in the form every other experiment uses. Anything else is
 * delegated straight back.
 */
export default function ExperimentManagedTrafficModal({
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
}: Props) {
  const managedFeature =
    (linkedFeatures ?? []).find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;

  // A Value column can only name "the" flag when the experiment has exactly one
  // implementation; with several, or a flag alongside visual changes or a
  // redirect, it would be editing one of them arbitrarily.
  const soleFeature =
    (linkedFeatures ?? []).length === 1 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects
      ? (linkedFeatures ?? [])[0]
      : null;

  // A flag this experiment does not manage can only be edited here while the
  // experiment is a draft — the server refuses otherwise, because a running
  // experiment's shared flag has to be edited and published from the flag
  // itself. A managed flag carries no such limit: it is read-only on the
  // Feature Flag page and publishes from the experiment at any time.
  const editableSoleFeature =
    soleFeature &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    soleFeature.state !== "locked" &&
    soleFeature.state !== "archived" &&
    soleFeature.state !== "discarded"
      ? soleFeature
      : null;

  const targetFeature = managedFeature ?? editableSoleFeature;

  // No single editable flag, or not the direct-edit path: the original modal
  // owns it.
  if (!targetFeature || !safeToEdit) {
    return (
      <EditTrafficModal
        close={close}
        experiment={experiment}
        linkedFeatures={linkedFeatures}
        mutate={mutate}
        safeToEdit={safeToEdit}
        focusVariationId={focusVariationId}
        addVariationOnOpen={addVariationOnOpen}
      />
    );
  }

  return (
    <ManagedTrafficForm
      close={close}
      experiment={experiment}
      mutate={mutate}
      targetFeature={targetFeature}
      canEditValueType={!!managedFeature}
      focusVariationId={focusVariationId}
      addVariationOnOpen={addVariationOnOpen}
    />
  );
}

function ManagedTrafficForm({
  close,
  experiment,
  mutate,
  targetFeature,
  canEditValueType,
  focusVariationId,
  addVariationOnOpen,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  /** The Feature Flag this experiment manages. */
  targetFeature: LinkedFeatureInfo;
  /** Only a flag this experiment manages may be re-typed from here. */
  canEditValueType: boolean;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const isBandit = experiment.type === "multi-armed-bandit";
  const feature = targetFeature?.feature ?? null;

  // Every change to an existing flag's values is a draft edit — including the
  // value a newly added variation needs.
  const canEditValues =
    !!feature && permissionsUtil.canEditFeatureDrafts(feature);

  const [valueType, setValueType] = useState<FeatureValueType>(
    feature?.valueType ?? "string",
  );
  const [featureValues, setFeatureValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        (targetFeature?.values ?? []).map((v) => [v.variationId, v.value]),
      ),
  );

  const typeChanged = !!feature && valueType !== feature.valueType;

  /** Re-express what is already there rather than clearing it. */
  const handleValueTypeChange = (next: FeatureValueType) => {
    if (next === valueType) return;
    setFeatureValues((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, v], i) => [
          id,
          castFeatureValue({ value: v, from: valueType, to: next, index: i }),
        ]),
      ),
    );
    setValueType(next);
  };

  const latestPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<
    ExperimentInterfaceStringDates & {
      variationWeights: number[];
      coverage: number;
    }
  >({
    defaultValues: {
      variations: getLatestPhaseVariations(experiment).map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description,
        screenshots: v.screenshots,
      })),
      variationWeights:
        latestPhase?.variationWeights ??
        getEqualWeights(experiment.variations.length, 4),
      coverage: latestPhase?.coverage ?? 1,
    },
  });

  // Only the managed editor's rows carry a flag value; read it structurally so
  // the shared editor's row type still satisfies this.
  const featureValueOf = (row: { id: string; featureValue?: string }) =>
    row.featureValue ?? "";

  const sharedVariationProps = {
    label: null,
    valueAsId: isBandit,
    hideSplits: isBandit,
    coverage: form.watch("coverage"),
    setCoverage: (coverage: number) => form.setValue("coverage", coverage),
    setWeight: (i: number, weight: number) =>
      form.setValue(`variationWeights.${i}`, weight),
    variations:
      form.watch("variations")?.map((v, i) => ({
        value: v.key || "",
        name: v.name,
        description: v.description,
        screenshots: v.screenshots,
        weight: form.watch(`variationWeights.${i}`),
        id: v.id,
        featureValue: featureValues[v.id] ?? "",
      })) ?? [],
    setVariations: (v: ManagedSortableVariation[]) => {
      setFeatureValues(
        Object.fromEntries(v.map((row) => [row.id, featureValueOf(row)])),
      );
      form.setValue(
        "variations",
        v.map((data) => {
          const { value, ...newData } = data;
          return {
            name: "",
            description: "",
            screenshots: [],
            ...newData,
            key: value,
          };
        }),
      );
      form.setValue(
        "variationWeights",
        v.map((row) => row.weight),
      );
    },
    showPreview: true,
    autoFocusVariationId: focusVariationId,
    autoAddVariationOnMount: addVariationOnOpen,
  };

  const submit = form.handleSubmit(async (value) => {
    const originalVariationCount = getLatestPhaseVariations(experiment).length;
    const data = { ...value };
    data.variations = [...value.variations].map((variation, i) => {
      if (!variation.key) variation.key = i + "";
      return variation;
    });

    // fix some common bugs
    if (!isBandit) {
      const newWeights = [
        ...data.variations.map((_, i) =>
          Math.min(
            Math.max(
              data.variationWeights?.[i] ?? 1 / (data.variations?.length || 2),
              0,
            ),
            1,
          ),
        ),
      ];
      data.variationWeights = distributeWeights(newWeights, true);
    } else {
      const latestVariationWeights = latestPhase?.variationWeights ?? [];
      if (
        data.variations.length !== data.variationWeights.length ||
        data.variations.length !== latestVariationWeights.length
      ) {
        // only recompute weights if original weights are the wrong size
        data.variationWeights = getEqualWeights(data.variations.length || 2, 4);
      } else {
        data.variationWeights = [...latestVariationWeights];
      }
    }

    // Experiment state first, then the flag's values. The second call re-sends
    // the variations so the server still cross-checks that every variation has a
    // value — a new variation and the value it needs are validated together.
    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (feature && canEditValues) {
      const values = data.variations.map((v, i) => ({
        variationId: v.id,
        value: validateFeatureValue(
          {
            valueType,
            // A schema describes the type it was written for.
            jsonSchema: typeChanged ? undefined : feature.jsonSchema,
          },
          featureValues[v.id] ??
            castFeatureValue({
              value: v.key || String(i),
              from: "string",
              to: valueType,
              index: i,
            }),
          `Variation ${i}`,
        ),
      }));

      await apiCall(`/experiment/${experiment.id}/features`, {
        method: "POST",
        body: JSON.stringify({
          variations: data.variations,
          variationWeights: data.variationWeights,
          features: {
            [feature.id]: {
              variations: values,
              ...(typeChanged && { valueType }),
              revisionOptions:
                targetFeature?.pendingDraft != null
                  ? { targetVersion: targetFeature.pendingDraft.version }
                  : { forceNewDraft: true },
            },
          },
        }),
      });
    }

    mutate();
    track("edited-traffic");

    const numVariationsAdded = data.variations.length - originalVariationCount;
    if (numVariationsAdded > 0) {
      track("Added Variations", {
        source: "edit-traffic-modal",
        numVariationsAdded,
        totalVariations: data.variations.length,
      });
    }
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Traffic & Variations"
      submit={submit}
      size="lg"
    >
      <div className="pt-2">
        {/* Shared by both editors; the managed copy adds the value column, the
            type picker and the flag-specific props on top. */}
        {feature ? (
          <ExperimentManagedFeatureVariationEditor
            {...sharedVariationProps}
            belowCoverage={
              canEditValueType ? (
                <Box mb="3">
                  <ValueTypeField
                    value={valueType}
                    order={VALUE_TYPE_ORDER}
                    onChange={(v) => {
                      if (v !== "config" && canEditValues)
                        handleValueTypeChange(v);
                    }}
                  />
                </Box>
              ) : null
            }
            valueType={valueType}
            feature={feature}
            sparse={targetFeature?.sparse}
          />
        ) : (
          <FeatureVariationsInput {...sharedVariationProps} />
        )}
      </div>
    </ModalStandard>
  );
}
