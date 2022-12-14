import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";

const EditTargetingForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm({
    defaultValues: {
      targetURLRegex: experiment.targetURLRegex || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Edit Targeting"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta="Save"
    >
      {experiment.implementation !== "custom" && (
        <Field
          label="URL Targeting"
          required={experiment.implementation === "visual"}
          {...form.register("targetURLRegex")}
          helpText={
            <>
              e.g. <code>https://example.com/pricing</code> or{" "}
              <code>^/post/[0-9]+</code>
            </>
          }
        />
      )}
    </Modal>
  );
};

export default EditTargetingForm;
