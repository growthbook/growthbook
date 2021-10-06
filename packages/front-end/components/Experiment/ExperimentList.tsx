import Link from "next/link";
import React from "react";
import useApi from "../../hooks/useApi";
import { ago, datetime } from "../../services/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LoadingOverlay from "../LoadingOverlay";
import { useDefinitions } from "../../services/DefinitionsContext";

export default function ExperimentList({
  num,
  status,
}: {
  num: number;
  status: "draft" | "running" | "stopped";
}): React.ReactElement {
  const { project } = useDefinitions();
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project || ""}`);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  let exps = [];
  data.experiments.forEach((e) => {
    if (e.status === status) return exps.push(e);
  });

  if (!exps.length) {
    return <div>no {status} experiments</div>;
  }
  if (exps.length > num) {
    exps = exps.slice(0, num);
  }
  //console.log(exps);
  return (
    <>
      {exps.map((test) => {
        // get start and end dates by looking for min and max start dates of main and rollup phases
        let startDate = test.dateCreated,
          endDate;
        test.phases.forEach((p) => {
          if (p.phase === "main" || p.phase === "ramp") {
            if (!startDate || p.dateStarted < startDate)
              startDate = p.dateStarted;
            if (!endDate || p.dateEnded > endDate) endDate = p.dateEnded;
          }
        });

        return (
          <div key={test.id} className="d-flex mb-3">
            <Link href="/experiment/[eid]" as={`/experiment/${test.id}`}>
              <a className="list-group-item w-100 ">
                <div className="d-flex w-100">
                  <div className="mb-1">
                    <strong>{test.name}</strong>{" "}
                  </div>
                  <div style={{ flex: 1 }} />
                  <div className="text-muted" title={datetime(startDate)}>
                    {ago(startDate)}
                  </div>
                </div>
              </a>
            </Link>
          </div>
        );
      })}
    </>
  );
}
