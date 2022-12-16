import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";

const EditExperimentNameForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm<{ name: string }>({
    defaultValues: {
      name: experiment.name || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Edit Name"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta="Save"
    >
      <Field label="Name" {...form.register("name")} />
    </Modal>
  );
};

export default EditExperimentNameForm;
