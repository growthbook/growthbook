import { FC } from "react";
import TextareaAutosize from "react-textarea-autosize";
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
    segment: experiment.segment || "",
    targeting: experiment.targeting || "",
  });
  const { apiCall } = useAuth();
  const { segments, getDatasourceById } = useDefinitions();

  const segmentsWithTargeting = segments
    ? segments.filter((s) => s.targeting && s.targeting.length >= 5)
    : [];

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
          {segmentsWithTargeting.length > 0 && (
            <div className="form-group">
              <label>Segment</label>
              <select className="form-control" {...inputProps.segment}>
                <option value="">Everyone</option>
                {segmentsWithTargeting.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Custom Targeting (optional)</label>
            <TextareaAutosize
              className="form-control"
              {...inputProps.targeting}
              placeholder={`e.g. premium = true`}
              minRows={2}
              maxRows={5}
            />
            <small className="form-text text-muted">
              One targeting rule per line. Available operators: <code>=</code>,{" "}
              <code>!=</code>, <code>&lt;</code>, <code>&gt;</code>,{" "}
              <code>~</code>, <code>!~</code>
            </small>
          </div>
        </>
      )}
    </Modal>
  );
};

export default EditTargetingForm;
