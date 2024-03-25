import { FC } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { useAuth } from "@front-end/services/auth";
import { generateVariationId } from "@front-end/services/features";
import Modal from "@front-end/components/Modal";
import ExperimentVariationsInput from "./ExperimentVariationsInput";

const EditVariationsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
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
