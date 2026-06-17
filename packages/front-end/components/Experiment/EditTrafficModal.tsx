import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
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

  const isBandit = experiment.type === "multi-armed-bandit";

  // POC: keep variation row metadata (name/value/id) in local state so the
  // input can add/edit variations. Weights stay in the form (the source of
  // truth submitted to /targeting), and we mirror the phase `variations`
  // (id/status) on change. Note: brand-new variations won't persist through
  // the targeting endpoint since it doesn't write `experiment.variations`.
  const [variationRows, setVariationRows] = useState(() =>
    getLatestPhaseVariations(experiment).map((v, i) => ({
      value: v.key || i + "",
      name: v.name,
      id: v.id,
    })),
  );

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Traffic"
        ctaEnabled={canSubmit}
        submit={onSubmit(mutate, "traffic")}
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
