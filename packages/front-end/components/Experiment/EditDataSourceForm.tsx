import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";

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
      <div className="form-group">
        <label>Data Source</label>
        <select
          className="form-control"
          {...form.register("datasource")}
          disabled={experiment.status !== "draft"}
        >
          <option value="">Manual</option>
          {datasources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Tracking Key</label>
        <input
          type="text"
          className="form-control"
          {...form.register("trackingKey")}
        />
      </div>
    </Modal>
  );
};

export default EditDataSourceForm;
