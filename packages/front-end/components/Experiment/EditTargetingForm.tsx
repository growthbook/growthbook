import { FC } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";

const EditTargetingForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const [value, inputProps] = useForm({
    targetURLRegex: experiment.targetURLRegex || "",
    userIdType: experiment.userIdType || "anonymous",
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
      submit={async () => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      }}
      cta="Save"
    >
      {supportsUserIds && (
        <div className="form-group">
          <label>Login State</label>
          <select className="form-control" {...inputProps.userIdType}>
            <option value="user">User</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
      )}
      {experiment.implementation !== "custom" && (
        <>
          <div className="form-group">
            <label>URL Targeting</label>
            <input
              type="text"
              className="form-control"
              required={experiment.implementation === "visual"}
              {...inputProps.targetURLRegex}
            />
            <small className="form-text text-muted">
              e.g. <code>https://example.com/pricing</code> or{" "}
              <code>^/post/[0-9]+</code>
            </small>
          </div>
        </>
      )}
    </Modal>
  );
};

export default EditTargetingForm;
