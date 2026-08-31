import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FieldAlignedVariationNumber from "@/components/Experiment/FieldAlignedVariationNumber";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  close: () => void;
  mutate: () => void;
  source?: string;
}

// The description on its own. `EditVariationMetadataModal` covers name and
// description together, for the places that edit both.
const EditVariationDescriptionModal: FC<Props> = ({
  experiment,
  variationIndex,
  close,
  mutate,
  source,
}) => {
  const { apiCall } = useAuth();
  const variations = getLatestPhaseVariations(experiment).map((v) => ({
    id: v.id,
    key: v.key,
    name: v.name,
    description: v.description,
    screenshots: v.screenshots,
  }));
  const variation = variations[variationIndex];

  const form = useForm({
    defaultValues: { description: variation?.description ?? "" },
  });

  if (!variation) return null;

  return (
    <ModalStandard
      trackingEventModalType="edit-variation-description"
      trackingEventModalSource={source}
      header="Edit Description"
      open={true}
      close={close}
      submit={form.handleSubmit(async (value) => {
        const updatedVariations = variations.map((v, i) =>
          i === variationIndex ? { ...v, description: value.description } : v,
        );

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ variations: updatedVariations }),
        });
        mutate();
        track("edited-variation-description");
      })}
      cta="Save"
    >
      <Flex direction="row" gap="3" align="start">
        <FieldAlignedVariationNumber number={variationIndex} />
        <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
          <Field
            label="Description"
            textarea
            containerClassName="mb-0"
            {...form.register("description")}
          />
        </Flex>
      </Flex>
    </ModalStandard>
  );
};

export default EditVariationDescriptionModal;
