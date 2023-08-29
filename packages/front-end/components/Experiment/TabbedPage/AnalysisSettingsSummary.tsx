import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaChartBar, FaDatabase, FaFlask, FaTable } from "react-icons/fa";
import React, { ReactElement, useState } from "react";
import { GiPieChart } from "react-icons/gi";
import { HiCursorClick } from "react-icons/hi";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { StatsEngine } from "back-end/types/stats";
import { MetricRegressionAdjustmentStatus } from "back-end/types/report";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBEdit } from "@/components/Icons";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { trackSnapshot } from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import AnalysisForm from "../AnalysisForm";
import OverflowText from "./OverflowText";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  statsEngine: StatsEngine;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  editMetrics?: () => void;
}

export default function AnalysisSettingsSummary({
  experiment,
  mutate,
  statsEngine,
  regressionAdjustmentEnabled,
  metricRegressionAdjustmentStatuses,
  editMetrics,
}: Props) {
  const { getDatasourceById, getSegmentById, getMetricById } = useDefinitions();
  const {
    snapshot,
    analysis,
    dimension,
    mutateSnapshot,
    phase,
  } = useSnapshot();
  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;
  const phaseObj = experiment.phases?.[phase];
  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });
  const { apiCall } = useAuth();

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
    noTransform?: boolean;
  }[] = [];

  items.push({
    value: ds ? ds.name : <em>no data source</em>,
    icon: <FaDatabase className="mr-1" />,
    tooltip: ds ? "Data Source" : "",
  });

  if (assignmentQuery) {
    items.push({
      value: assignmentQuery.name,
      icon: <FaTable className="mr-1" />,
      tooltip: "Experiment Assignment Query",
    });
  }
  if (ds) {
    items.push({
      value: experiment.trackingKey,
      icon: <FaFlask className="mr-1" />,
      tooltip: "Experiment Key",
    });
  }
  if (segment) {
    items.push({
      value: segment.name,
      icon: <GiPieChart className="mr-1" />,
      tooltip: "Segment",
    });
  }
  if (activationMetric) {
    items.push({
      value: activationMetric.name,
      icon: <HiCursorClick className="mr-1" />,
      tooltip: "Activation Metric",
    });
  }

  items.push({
    value: numMetrics + " metrics",
    icon: <FaChartBar className="mr-1" />,
    noTransform: true,
    tooltip:
      numMetrics > 0 ? (
        <>
          <div className="mb-2 text-left">
            <strong>Goals:</strong>
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
            <strong>Guardrails:</strong>{" "}
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
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
        />
      )}
      <div className="row align-items-center text-muted">
        <div className="col-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setAnalysisModal(true);
            }}
          >
            <span className="text-dark">Analysis Settings</span> <GBEdit />
          </a>
        </div>
        {items.map((item, i) => (
          <Tooltip
            body={
              item.tooltip && item.noTransform ? (
                <div>{item.tooltip}</div>
              ) : item.tooltip ? (
                <div className="text-center">
                  <strong>{item.tooltip}:</strong>
                  <div>{item.value}</div>
                </div>
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
              <div style={{ cursor: "default" }}>
                {item.icon ? <>{item.icon} </> : null}
                {item.noTransform ? (
                  item.value
                ) : (
                  <OverflowText maxWidth={150}>{item.value}</OverflowText>
                )}
              </div>
            </div>
          </Tooltip>
        ))}
        <div className="flex-1" />
        <div className="col-auto">
          <ResultMoreMenu
            id={snapshot?.id || ""}
            forceRefresh={async () => {
              await apiCall<{ snapshot: ExperimentSnapshotInterface }>(
                `/experiment/${experiment.id}/snapshot?force=true`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    phase,
                    dimension,
                    statsEngine,
                    regressionAdjustmentEnabled,
                    metricRegressionAdjustmentStatuses,
                  }),
                }
              )
                .then((res) => {
                  trackSnapshot(
                    "create",
                    "ForceRerunQueriesButton",
                    datasource?.type || null,
                    res.snapshot
                  );
                  mutateSnapshot();
                })
                .catch((e) => {
                  console.error(e);
                });
            }}
            configure={() => setAnalysisModal(true)}
            editMetrics={editMetrics}
            notebookUrl={`/experiments/notebook/${snapshot?.id}`}
            notebookFilename={experiment.trackingKey}
            generateReport={true}
            queries={snapshot?.queries}
            queryError={snapshot?.error}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasData}
            metrics={experiment.metrics}
            results={analysis?.results}
            variations={variations}
            trackingKey={experiment.trackingKey}
            dimension={dimension}
            project={experiment.project}
            showPhaseSelector={false}
            mutateExperiment={mutate}
          />
        </div>
      </div>
    </div>
  );
}
