import { FC } from "react";
import useDatasources from "../../hooks/useDatasources";
import Modal from "../Modal";
import { SegmentInterface } from "back-end/types/segment";
import useForm from "../../hooks/useForm";
import TextareaAutosize from "react-textarea-autosize";
import { useAuth } from "../../services/auth";
import { useSegments } from "../../services/SegmentsContext";

const SegmentForm: FC<{
  close: () => void;
  current: Partial<SegmentInterface>;
}> = ({ close, current }) => {
  const { apiCall } = useAuth();
  const { datasources, getById } = useDatasources();
  const { refresh } = useSegments();
  const [value, inputProps] = useForm(
    {
      name: current.name || "",
      sql: current.sql || "",
      datasource: (current.id ? current.datasource : datasources[0]?.id) || "",
      targeting: current.targeting || "",
    },
    current.id
  );
  const filteredDatasources = datasources.filter(
    (d) => d.type !== "google_analytics"
  );

  const datasource = getById(value.datasource);

  return (
    <Modal
      close={close}
      open={true}
      header={current ? "Edit Segment" : "New Segment"}
      submit={async () => {
        await apiCall(current.id ? `/segments/${current.id}` : `/segments`, {
          method: current.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        refresh();
      }}
    >
      <div className="form-group">
        Name
        <input
          type="text"
          required
          className="form-control"
          {...inputProps.name}
        />
      </div>
      <div className="form-group">
        Data Source
        <select className="form-control" required {...inputProps.datasource}>
          <option value="">Choose one...</option>
          {filteredDatasources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        {datasource?.type === "mixpanel" ? "Event Condition" : "SQL"}
        <TextareaAutosize
          className="form-control"
          required
          {...inputProps.sql}
          minRows={3}
          placeholder={
            datasource?.type === "mixpanel"
              ? "event.properties.$browser === 'Chrome'"
              : "SELECT user_id, date FROM mytable"
          }
        />
        <small className="form-text text-muted">
          {datasource?.type === "mixpanel" ? (
            <>
              Javascript condition used to filter events. Has access to an{" "}
              <code>event</code> variable.
            </>
          ) : (
            <>
              Select two columns named <code>user_id</code> and{" "}
              <code>date</code>
            </>
          )}
        </small>
      </div>
      <div className="form-group">
        Targeting Rules (optional)
        <TextareaAutosize
          className="form-control"
          {...inputProps.targeting}
          minRows={2}
          placeholder="premium = true"
        />
        <small className="form-text text-muted">
          One targeting rule per line. Available operators: <code>=</code>,{" "}
          <code>!=</code>, <code>&lt;</code>, <code>&gt;</code>, <code>~</code>,{" "}
          <code>!~</code>
        </small>
      </div>
    </Modal>
  );
};
export default SegmentForm;
