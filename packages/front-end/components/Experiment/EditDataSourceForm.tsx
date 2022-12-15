import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";

const EditDataSourceForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { datasources, getDatasourceById } = useDefinitions();
  const form = useForm({
    defaultValues: {
      datasource: experiment.datasource || "",
      exposureQueryId:
        getExposureQuery(
          getDatasourceById(experiment.datasource)?.settings,
          experiment.exposureQueryId,
          experiment.userIdType
        )?.id || "",
      trackingKey: experiment.trackingKey || "",
    },
  });
  const { apiCall } = useAuth();

  const datasource = getDatasourceById(form.watch("datasource"));

  const supportsExposureQueries = datasource?.properties?.exposureQueries;
  const exposureQueries = datasource?.settings?.queries?.exposure || [];

  return (
    <Modal
      header={"Edit Data Source Settings"}
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
      <SelectField
        label="Data Source"
        value={form.watch("datasource")}
        onChange={(v) => form.setValue("datasource", v)}
        disabled={experiment.status !== "draft"}
        initialOption="Manual"
        name="datasource"
        autoFocus={true}
        options={datasources.map((d) => ({ value: d.id, label: d.name }))}
        helpText={
          experiment.status !== "draft"
            ? "Cannot edit the data source while experiment is live. Revert to a draft first."
            : ""
        }
      />
      {supportsExposureQueries && (
        <SelectField
          label="Assignment Table"
          value={form.watch("exposureQueryId")}
          required
          onChange={(v) => form.setValue("exposureQueryId", v)}
          options={exposureQueries.map((q) => {
            return {
              label: q.name,
              value: q.id,
            };
          })}
        />
      )}
      <Field label="Experiment Id" {...form.register("trackingKey")} />
    </Modal>
  );
};

export default EditDataSourceForm;
