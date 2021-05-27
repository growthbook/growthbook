import { FC, useState } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "./LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import Modal from "./Modal";
import { ago, datetime } from "../services/dates";
import Code from "./Code";

const HistoryTable: FC<{ type: "experiment" | "metric"; id: string }> = ({
  id,
  type,
}) => {
  // TODO: Special actions for some event types (e.g. delete manual snapshot)

  const [modal, setModal] = useState(null);

  const { data, error } = useApi<{ events: AuditInterface[] }>(
    `/history/${type}/${id}`
  );

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      {modal && (
        <Modal close={() => setModal(null)} open={true} header="Event Details">
          <Code
            language="json"
            code={JSON.stringify(JSON.parse(modal), null, 2)}
          />
        </Modal>
      )}
      <h4>Audit Log</h4>
      <table className="table appbox">
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Event</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((event) => (
            <tr key={event.id}>
              <td title={datetime(event.dateCreated)}>
                {ago(event.dateCreated)}
              </td>
              <td>{event.user.name || event.user.email}</td>
              <td>{event.event}</td>
              <td>
                {event.details ? (
                  <button
                    className="btn btn-link btn-sm"
                    onClick={(e) => {
                      e.preventDefault();
                      setModal(event.details);
                    }}
                  >
                    View Details
                  </button>
                ) : (
                  ""
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

export default HistoryTable;
