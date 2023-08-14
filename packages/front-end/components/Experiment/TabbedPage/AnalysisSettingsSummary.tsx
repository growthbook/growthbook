import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaChartBar, FaDatabase, FaFlask, FaTable } from "react-icons/fa";
import React, { ReactElement, useState } from "react";
import { GiPieChart } from "react-icons/gi";
import { HiCursorClick } from "react-icons/hi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBEdit } from "@/components/Icons";
import AnalysisForm from "../AnalysisForm";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function AnalysisSettingsSummary({ experiment, mutate }: Props) {
  const { getDatasourceById, getSegmentById, getMetricById } = useDefinitions();

  const [analysisModal, setAnalysisModal] = useState(false);

  const ds = getDatasourceById(experiment.datasource);
  const assignmentQuery = ds?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  );
  const segment = getSegmentById(experiment.segment || "");

  const activationMetric = getMetricById(experiment.activationMetric || "");

  const goals: string[] = [];
  experiment.metrics?.forEach((m) => {
    const name = getMetricById(m)?.name;
    if (name) goals.push(name);
  });
  const guardrails: string[] = [];
  experiment.guardrails?.forEach((m) => {
    const name = getMetricById(m)?.name;
    if (name) guardrails.push(name);
  });

  const numMetrics = goals.length + guardrails.length;

  const items: {
    value: string | number | ReactElement;
    tooltip?: string | ReactElement;
    icon?: ReactElement;
  }[] = [];

  items.push({
    value: ds ? ds.name : <em>no data source</em>,
    icon: <FaDatabase className="mr-1" />,
    tooltip: ds ? "data source" : "",
  });

  if (assignmentQuery) {
    items.push({
      value: assignmentQuery.name,
      icon: <FaTable className="mr-1" />,
      tooltip: "experiment assignment query",
    });
  }
  if (ds) {
    items.push({
      value: experiment.trackingKey,
      icon: <FaFlask className="mr-1" />,
      tooltip: "experiment key",
    });
  }
  if (segment) {
    items.push({
      value: segment.name,
      icon: <GiPieChart className="mr-1" />,
      tooltip: "segment",
    });
  }
  if (activationMetric) {
    items.push({
      value: activationMetric.name,
      icon: <HiCursorClick className="mr-1" />,
      tooltip: "activation metric",
    });
  }

  items.push({
    value: numMetrics + " metrics",
    icon: <FaChartBar className="mr-1" />,
    tooltip:
      numMetrics > 0 ? (
        <>
          <div className="mb-2 text-left">
            Goals:
            {goals.length > 0 ? (
              <ul className=" ml-0 pl-3 mb-0">
                {goals.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <em>none</em>
            )}
          </div>
          <div className="text-left">
            Guardrails:{" "}
            {guardrails.length > 0 ? (
              <ul className="ml-0 pl-3 mb-0">
                {guardrails.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <em>none</em>
            )}
          </div>
        </>
      ) : undefined,
  });

  return (
    <div className="px-3 py-2 bg-light border-bottom">
      {analysisModal && (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          experiment={experiment}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          editDates={false}
          editVariationIds={false}
          editMetrics={true}
        />
      )}
      <div className="row align-items-center text-muted">
        <div className="col-auto">
          Analysis Settings{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setAnalysisModal(true);
            }}
          >
            <GBEdit />
          </a>
        </div>
        {items.map((item, i) => (
          <Tooltip
            body={
              item.tooltip ? (
                <div className="text-center">{item.tooltip}</div>
              ) : (
                ""
              )
            }
            key={i}
          >
            <div
              key={i}
              className={`col-auto px-3 ${i > 0 ? "border-left" : ""}`}
            >
              <div>
                {item.icon ? <>{item.icon} </> : null}
                {item.value}
              </div>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
