import { FC } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import { generateVariationId } from "@/services/features";
import Modal from "@/components/Modal";
import track from "@/services/track";
import ExperimentVariationsInput from "./ExperimentVariationsInput";

const EditVariationsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}> = ({ experiment, cancel, mutate, source }) => {
  const form = useForm<{
    variations: Variation[];
  }>({
    defaultValues: {
      variations: experiment.variations
        ? experiment.variations
        : [
            {
              name: "Control",
              description: "",
              key: "0",
              screenshots: [],
              id: generateVariationId(),
            },
            {
              name: "Variation",
              description: "",
              key: "1",
              screenshots: [],
              id: generateVariationId(),
            },
          ],
    },
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
      <ExperimentVariationsInput
        variations={form.watch("variations")}
        setVariations={(variations) => form.setValue("variations", variations)}
      />
    </Modal>
  );
};

export default EditVariationsForm;
