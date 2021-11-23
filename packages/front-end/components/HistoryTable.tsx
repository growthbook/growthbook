import { FC, useState } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "./LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import Modal from "./Modal";
import { ago, datetime } from "../services/dates";
import Code from "./Code";
import Link from "next/link";

function EventDetails({
  event,
  setModal,
}: {
  event: AuditInterface;
  setModal: (contents: string) => void;
}) {
  if (event.event === "experiment.analysis" && event.details) {
    const details = JSON.parse(event.details);
    if (details && details.report) {
      return (
        <Link href={`/report/${details.report}`}>
          <a>View Report</a>
        </Link>
      );
    }
  }
  // TODO: More special actions depending on event type
  if (event.details) {
    return (
      <button
        className="btn btn-link btn-sm"
        onClick={(e) => {
          e.preventDefault();
          setModal(event.details);
        }}
      >
        View Details
      </button>
    );
  }

  return null;
}

const HistoryTable: FC<{ type: "experiment" | "metric"; id: string }> = ({
  id,
  type,
}) => {
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
                <EventDetails event={event} setModal={setModal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

export default HistoryTable;
