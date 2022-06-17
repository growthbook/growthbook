import { FC } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "../components/LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import Link from "next/link";
import Avatar from "../components/Avatar";
import { ago, datetime } from "../services/dates";
import { phaseSummary } from "../services/utils";

const eventActionMapping = {
  "experiment.start": "started experiment",
  "experiment.stop": "stopped experiment",
  "experiment.results": "added results for experiment",
  "experiment.phase": "started a new phase for experiment",
  "feature.publish": "changed the rules for the feature",
  "feature.update": "updated feature information",
  "feature.toggle": "changed feature environment",
};

const Activity: FC = () => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
    features: { id: string }[];
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

  return (
    <div className="container-fluid p-3">
      <div className="list-group"></div>
      {data.events.map((event) => {
        let details = null;
        try {
          details = JSON.parse(event.details);
        } catch (e) {
          // Ignore errors
          console.error(e);
        }

        return (
          <div key={event.id} className="d-flex mb-3">
            <div>
              <Avatar email={event.user.email} className="mr-2" />
            </div>
            <Link
              href={
                nameMap.has(event.entity.id)
                  ? `/experiment/${event.entity.id}`
                  : `/features/${event.entity.id}`
              }
            >
              <a className="list-group-item list-group-item-action">
                <div className="d-flex w-100">
                  <div className="mb-1">
                    <strong>{event.user.name}</strong>{" "}
                    {eventActionMapping[event.event] || "modified"}{" "}
                    <strong>
                      {nameMap.get(event.entity.id) || event.entity.id}
                    </strong>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div
                    className="text-muted"
                    title={datetime(event.dateCreated)}
                  >
                    {ago(event.dateCreated)}
                  </div>
                </div>
                {details &&
                  (event.event === "experiment.start" ||
                    event.event === "experiment.phase") && (
                    <small>{phaseSummary(details)}</small>
                  )}
                {event.event === "experiment.stop" && (
                  <small>
                    {details && details.reason && (
                      <span className="mr-3">
                        <strong>Reason: </strong> {details.reason}
                      </span>
                    )}
                    {details && details.results && (
                      <>
                        <strong>Result: </strong> {details.results}
                      </>
                    )}
                  </small>
                )}
                {event.event === "feature.toggle" && (
                  <small>
                    {details.post.on ? (
                      <span className="mr-3">
                        In <strong>{details.context.environment}</strong>, the
                        feature was turned <strong>on</strong>
                      </span>
                    ) : (
                      <span className="mr-3">
                        In <strong>{details.context.environment}</strong>, the
                        feature was turned <strong>off</strong>
                      </span>
                    )}
                  </small>
                )}
              </a>
            </Link>
          </div>
        );
      })}
    </div>
  );
};

export default Activity;
