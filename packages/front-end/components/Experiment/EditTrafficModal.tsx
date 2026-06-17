import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import { useAuth } from "@/services/auth";
import { distributeWeights } from "@/services/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTrafficModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

  const { apiCall } = useAuth();
  const isBandit = experiment.type === "multi-armed-bandit";

  // Keep variation row metadata (name/value/id) in local state so the input
  // can add/edit variations. Weights/coverage live in the form, and on submit
  // we post full variation definitions, weights, and coverage to
  // `/experiment/:id` (postExperiment), which persists all three in one call.
  const [variationRows, setVariationRows] = useState(() =>
    getLatestPhaseVariations(experiment).map((v, i) => ({
      value: v.key || i + "",
      name: v.name,
      id: v.id,
    })),
  );

  const submitTraffic = async () => {
    const weights = distributeWeights(
      variationRows.map(
        (_, i) =>
          form.getValues(`variationWeights.${i}`) ?? 1 / variationRows.length,
      ),
      true,
    );

    // Preserve metadata (key/description/screenshots) for existing variations;
    // fall back to sensible defaults for newly added ones.
    const variations = variationRows.map((row, i) => {
      const existing = experiment.variations.find((v) => v.id === row.id);
      return {
        id: row.id,
        key: row.value || i + "",
        name: row.name,
        description: existing?.description ?? "",
        screenshots: existing?.screenshots ?? [],
      };
    });

    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify({
        variations,
        variationWeights: weights,
        coverage: form.getValues("coverage"),
      }),
    });
    mutate();
  };

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Traffic"
        ctaEnabled={canSubmit}
        submit={submitTraffic}
        size="lg"
      >
        <div className="pt-2">
          <FeatureVariationsInput
            valueType={"string"}
            coverage={form.watch("coverage")}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`variationWeights.${i}`, weight)
            }
            variations={variationRows.map((v, i) => ({
              ...v,
              weight: form.watch(`variationWeights.${i}`),
            }))}
            setVariations={(next: SortableVariation[]) => {
              setVariationRows(
                next.map((v) => ({
                  value: v.value,
                  name: v.name ?? "",
                  id: v.id,
                })),
              );
              form.setValue(
                "variationWeights",
                next.map((v) => v.weight),
              );
              form.setValue(
                "variations",
                next.map((v) => ({ id: v.id, status: "active" as const })),
              );
            }}
            showPreview={true}
            hideVariations={isBandit}
            label="Traffic Percentage & Variation Weights"
            startEditingSplits={true}
          />
        </div>
      </ModalStandard>
    );
  }

  return (
    <MakeChangesFlow
      experiment={experiment}
      form={form}
      defaultValues={defaultValues}
      onSubmit={(scope) => onSubmit(mutate, scope)()}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
