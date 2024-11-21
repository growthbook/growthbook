import React, { FC } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { getEqualWeights } from "shared/experiments";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import track from "@/services/track";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { distributeWeights } from "@/services/utils";

const EditVariationsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}> = ({ experiment, cancel, mutate, source }) => {
  const lastPhaseIndex = experiment.phases.length - 1;
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[lastPhaseIndex];

  const defaultValues = {
    variations: experiment.variations,
    variationWeights:
      lastPhase?.variationWeights ??
      getEqualWeights(experiment.variations.length, 4),
  };

  const form = useForm<
    ExperimentInterfaceStringDates & { variationWeights: number[] }
  >({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <Modal
      trackingEventModalType="edit-variations-form"
      trackingEventModalSource={source}
      header={"Edit Variations"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const data = { ...value };
        data.variations = [...data.variations];

        // fix some common bugs
        if (!isBandit) {
          const newWeights = [
            ...data.variations.map((_, i) =>
              Math.min(
                Math.max(
                  data.variationWeights?.[i] ??
                    1 / (data.variations?.length || 2),
                  0
                ),
                1
              )
            ),
          ];
          data.variationWeights = distributeWeights(newWeights, true);
        } else {
          if (
            data.variations.length !== data.variationWeights.length ||
            data.variations.length !== lastPhase.variationWeights.length
          ) {
            // only recompute weights if original weights are the wrong size
            data.variationWeights = getEqualWeights(
              data.variations.length || 2,
              4
            );
          } else {
            data.variationWeights = [...lastPhase.variationWeights];
          }
        }

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
        track("edited-variations");
      })}
      cta="Save"
    >
      <FeatureVariationsInput
        label={null}
        setWeight={(i, weight) => {
          form.setValue(`variationWeights.${i}`, weight);
        }}
        valueAsId={isBandit}
        hideSplits={isBandit}
        showDescriptions
        variations={
          form.watch("variations")?.map((v, i) => {
            return {
              value: v.key || "",
              name: v.name,
              description: v.description,
              screenshots: v.screenshots,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            };
          }) ?? []
        }
        setVariations={(v) => {
          form.setValue(
            "variations",
            v.map((data, i) => {
              return {
                // default values
                name: "",
                description: "",
                screenshots: [],
                ...data,
                key: data.value || `${i}` || "",
              };
            })
          );
          form.setValue(
            `variationWeights`,
            v.map((v) => v.weight)
          );
        }}
        showPreview={false}
        disableCoverage
      />
    </Modal>
  );
};

export default EditVariationsForm;
