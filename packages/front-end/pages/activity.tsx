import { FC, useState } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "../components/LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import { HistoryTableRow } from "../components/HistoryTable";

const Activity: FC = () => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  const [open, setOpen] = useState("");

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  return (
    <>
      <table className="table appbox">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Name</th>
            <th>User</th>
            <th>Event</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((event) => (
            <HistoryTableRow
              event={event}
              key={event.id}
              open={open === event.id}
              setOpen={(open) => {
                setOpen(open ? event.id : "");
              }}
              isActivity={true}
              itemName={
                nameMap.has(event.entity.id) && nameMap.get(event.entity.id)
              }
              url={
                event.entity.object === "feature"
                  ? `/features/${event.entity.id}`
                  : `/${event.entity.object}/${event.entity.id}`
              }
            />
          ))}
        </tbody>
      </table>
    </>
  );
};

export default Activity;
