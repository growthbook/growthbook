import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

const EditTargetingForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm({
    defaultValues: {
      targetURLRegex: experiment.targetURLRegex || "",
      userIdType: experiment.userIdType || "anonymous",
    },
  });
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();

  const supportsUserIds =
    getDatasourceById(experiment.datasource)?.type !== "mixpanel";

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
      {supportsUserIds && (
        <Field
          label="Login State"
          {...form.register("userIdType")}
          options={["user", "anonymous"]}
        />
      )}
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
