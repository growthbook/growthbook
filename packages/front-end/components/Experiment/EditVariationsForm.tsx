import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import { generateVariationId } from "@/services/features";
import Modal from "../Modal";
import ExperimentVariationsWrapper, {
  SortableExperimentVariation,
} from "./ExperimentVariationsWrapper";

export interface SortableExperimentInterfaceStringDates
  extends ExperimentInterfaceStringDates {
  variations: SortableExperimentVariation[];
}

const EditVariationsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm<Partial<SortableExperimentInterfaceStringDates>>({
    defaultValues: {
      variations: experiment.variations
        ? experiment.variations.map((v) => {
            const id = generateVariationId();
            return {
              name: "",
              description: "",
              value: "",
              key: "",
              ...v,
              id: id,
            };
          })
        : [
            {
              name: "Control",
              value: "",
              description: "",
              key: "",
              screenshots: [],
              id: generateVariationId(),
            },
            {
              name: "Variation",
              description: "",
              value: "",
              key: "",
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

        //MKTODO: Remove the temp id's?

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
      cta="Save"
    >
      <ExperimentVariationsWrapper
        variations={form.watch("variations")}
        setVariations={(variations) => form.setValue("variations", variations)}
      />
    </Modal>
  );
};

export default EditVariationsForm;
