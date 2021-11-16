import Link from "next/link";
import React from "react";
import useApi from "../../hooks/useApi";
import { ago, datetime } from "../../services/dates";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhase,
} from "back-end/types/experiment";
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
  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });
  //console.log(exps);
  return (
    <ul className="list-unstyled simple-divider ">
      {exps.map((test, i) => {
        // get start and end dates by looking for min and max start dates of main and rollup phases
        let startDate = test.dateCreated,
          endDate;
        let phase: ExperimentPhase;
        test.phases.forEach((p) => {
          if (p.phase === "main" || p.phase === "ramp") {
            if (!startDate || p.dateStarted < startDate) {
              startDate = p.dateStarted;
              phase = p;
            }
            if (!endDate || p.dateEnded > endDate) endDate = p.dateEnded;
          }
        });
        const weights = phase?.variationWeights
          ? phase.variationWeights.map((x) => Math.round(x * 100))
          : [];
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
                      <span className="text-purple">
                        {percentFormatter.format(phase?.coverage || 0)}
                      </span>{" "}
                      traffic,{" "}
                      <span className="text-purple">{weights.join("/")}</span>{" "}
                      split
                    </div>
                  </div>
                  <div className="d-flex">
                    <div className="text-muted" title={datetime(startDate)}>
                      {ago(startDate)}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div>
                      {" "}
                      {test.variations.length} variations, {phase?.phase} phase
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
