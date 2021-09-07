import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

const EditDataSourceForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm({
    defaultValues: {
      datasource: experiment.datasource || "",
      trackingKey: experiment.trackingKey || "",
    },
  });
  const { datasources } = useDefinitions();
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Edit Data Source"}
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
      <Field
        label="Data Source"
        {...form.register("datasource")}
        disabled={experiment.status !== "draft"}
        initialOption="Manual"
        options={datasources.map((d) => ({ value: d.id, display: d.name }))}
      />
      <Field label="Tracking Key" {...form.register("trackingKey")} />
    </Modal>
  );
};

export default EditDataSourceForm;
