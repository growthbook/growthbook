import { FC } from "react";
import { AuditInterface } from "back-end/types/audit";
import Link from "next/link";
import useApi from "../hooks/useApi";
import { date, datetime } from "../services/dates";
import LoadingOverlay from "./LoadingOverlay";
import Avatar from "./Avatar/Avatar";
//import { phaseSummary } from "../services/utils";

const eventActionMapping = {
  "experiment.start": "started experiment",
  "experiment.stop": "stopped experiment",
  "experiment.results": "added results for experiment",
  "experiment.phase": "started a new phase for experiment",
};

const ActivityList: FC<{
  num?: number;
}> = ({ num = 0 }) => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

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
  const events = num !== 0 ? data.events.slice(0, num) : data.events;

  return (
    <div className="">
      <ul className="list-unstyled simple-divider pl-0 mb-0">
        {events.map((event) => {
          return (
            <li key={event.id} className="media d-flex w-100 hover-highlight">
              <Link href={`/experiment/${event.entity.id}`}>
                <a className="no-link-color w-100">
                  {"email" in event.user && event.user.email && (
                    <Avatar
                      email={event.user.email}
                      className="mr-2 float-left"
                      size={24}
                    />
                  )}
                  <div className="d-flex flex-column flex-fill ">
                    <div className="mb-1">
                      <strong>
                        {("name" in event.user && event.user.name) ||
                          ("apiKey" in event.user && "API Key")}
                      </strong>{" "}
                      {eventActionMapping[event.event] || "modified"}{" "}
                      <strong>
                        {nameMap.get(event.entity.id) || event.entity.id}
                      </strong>
                    </div>
                    <div
                      className="text-muted"
                      title={datetime(event.dateCreated)}
                    >
                      {date(event.dateCreated)}
                    </div>
                    {/*{details &&*/}
                    {/*  (event.event === "experiment.start" ||*/}
                    {/*    event.event === "experiment.phase") && (*/}
                    {/*    <small>{phaseSummary(details)}</small>*/}
                    {/*  )}*/}
                    {/*{event.event === "experiment.stop" && (*/}
                    {/*  <small>*/}
                    {/*    {details && details.reason && (*/}
                    {/*      <span className="mr-3">*/}
                    {/*        <strong>Reason: </strong> {details.reason}*/}
                    {/*      </span>*/}
                    {/*    )}*/}
                    {/*    {details && details.results && (*/}
                    {/*      <>*/}
                    {/*        <strong>Result: </strong> {details.results}*/}
                    {/*      </>*/}
                    {/*    )}*/}
                    {/*  </small>*/}
                    {/*)}*/}
                  </div>
                </a>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ActivityList;
