import { FC } from "react";
import useDatasources from "../../hooks/useDatasources";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";

const EditDataSourceForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const [value, inputProps] = useForm({
    datasource: experiment.datasource || "",
    trackingKey: experiment.trackingKey || "",
  });
  const { datasources } = useDatasources();
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Edit Data Source"}
      open={true}
      close={cancel}
      submit={async () => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      }}
      cta="Save"
    >
      <div className="form-group">
        <label>Data Source</label>
        <select
          className="form-control"
          {...inputProps.datasource}
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
          {...inputProps.trackingKey}
        />
      </div>
    </Modal>
  );
};

export default EditDataSourceForm;
