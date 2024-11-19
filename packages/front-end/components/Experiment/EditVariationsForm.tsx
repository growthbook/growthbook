import React, { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import track from "@/services/track";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";

const EditVariationsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}> = ({ experiment, cancel, mutate, source }) => {
  const lastPhaseIndex = experiment.phases.length - 1;
  // const lastPhase: ExperimentPhaseStringDates | undefined =
  //   experiment.phases[lastPhaseIndex];

  const defaultValues = {
    // condition: lastPhase?.condition ?? "",
    // savedGroups: lastPhase?.savedGroups ?? [],
    // prerequisites: lastPhase?.prerequisites ?? [],
    // coverage: lastPhase?.coverage ?? 1,
    // hashAttribute: experiment.hashAttribute || "id",
    // fallbackAttribute: experiment.fallbackAttribute || "",
    // hashVersion: experiment.hashVersion || (hasSDKWithNoBucketingV2 ? 1 : 2),
    // disableStickyBucketing: experiment.disableStickyBucketing ?? false,
    // bucketVersion: experiment.bucketVersion || 1,
    // minBucketVersion: experiment.minBucketVersion || 0,
    // namespace: lastPhase?.namespace || {
    //   enabled: false,
    //   name: "",
    //   range: [0, 1],
    // },
    // seed: lastPhase?.seed ?? "",
    // trackingKey: experiment.trackingKey || "",
    phases: experiment.phases,
    variations: experiment.variations,
    // variationWeights:
    //   lastPhase?.variationWeights ??
    //   getEqualWeights(experiment.variations.length, 4),
    // newPhase: false,
    // reseed: true,
  };

  const form = useForm<ExperimentInterfaceStringDates>({
    defaultValues,
  });
  const { apiCall } = useAuth();

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
        valueType={"string"}
        setWeight={(i, weight) =>
          form.setValue(
            `phases.${lastPhaseIndex}.variationWeights.${i}`,
            weight
          )
        }
        valueAsId={true}
        variations={
          form.watch("variations")?.map((v, i) => {
            return {
              value: v.key || "",
              name: v.name,
              weight: form.watch(
                `phases.${lastPhaseIndex}.variationWeights.${i}`
              ), // todo: use current phase
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
                screenshots: [],
                ...data,
                key: data.value || `${i}` || "",
              };
            })
          );
          form.setValue(
            `phases.${lastPhaseIndex}.variationWeights`,
            v.map((v) => v.weight)
          );
        }}
        showPreview={false}
        disableCoverage
        customSplitOn={true}
      />
    </Modal>
  );
};

export default EditVariationsForm;
