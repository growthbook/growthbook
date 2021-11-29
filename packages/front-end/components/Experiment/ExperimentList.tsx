import Link from "next/link";
import React from "react";
import useApi from "../../hooks/useApi";
import { ago, datetime } from "../../services/dates";
import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
} from "back-end/types/experiment";
import LoadingOverlay from "../LoadingOverlay";
import { useDefinitions } from "../../services/DefinitionsContext";
import { phaseSummary } from "../../services/utils";

export default function ExperimentList({
  num,
  status,
}: {
  num: number;
  status: ExperimentStatus;
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

  return (
    <ul className="list-unstyled simple-divider ">
      {exps.map((test, i) => {
        // get start and end dates by looking for min and max start dates of main and rollup phases
        let startDate = test.dateCreated,
          endDate;

        test.phases.forEach((p) => {
          if (p.phase === "main" || p.phase === "ramp") {
            if (!startDate || p.dateStarted < startDate) {
              startDate = p.dateStarted;
            }
            if (!endDate || p.dateEnded > endDate) endDate = p.dateEnded;
          }
        });
        const currentPhase = test.phases[test.phases.length - 1];
        return (
          <li key={i} className="w-100 hover-highlight">
            <div key={test.id} className="d-flex">
              <Link href={`/experiment/${test.id}`}>
                <a className="w-100 no-link-color">
                  <div className="d-flex w-100">
                    <div className="mb-1">
                      <strong>{test.name}</strong>{" "}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div className="">
                      <span className="purple-phase">
                        {phaseSummary(currentPhase)}
                      </span>
                    </div>
                  </div>
                  <div className="d-flex">
                    <div className="text-muted" title={datetime(startDate)}>
                      {ago(startDate)}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div>
                      {" "}
                      {test.variations.length} variations, {currentPhase?.phase}{" "}
                      phase
                    </div>
                  </div>
                </a>
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
