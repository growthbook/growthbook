import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaClock, FaCog, FaDatabase, FaFlask, FaTable } from "react-icons/fa";
import React, { ReactElement, useState } from "react";
import { GiPieChart } from "react-icons/gi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
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

  const items: {
    value: string | number;
    tooltip?: string;
    icon?: ReactElement;
  }[] = [];

  if (ds) {
    items.push({
      value: ds.name,
      icon: <FaDatabase className="mr-1" />,
      tooltip: "data source",
    });
  }
  if (assignmentQuery) {
    items.push({
      value: assignmentQuery.name,
      icon: <FaTable className="mr-1" />,
      tooltip: "experiment assignment query",
    });
  }
  items.push({
    value: experiment.trackingKey,
    icon: <FaFlask className="mr-1" />,
    tooltip: "experiment key",
  });
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
      icon: <FaClock className="mr-1" />,
      tooltip: "activation metric",
    });
  }

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
        />
      )}
      <div className="row align-items-center text-muted">
        {items.map((item, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <div>&bull;</div> : null}
            <Tooltip
              body={
                item.tooltip ? (
                  <div className="text-center">{item.tooltip}</div>
                ) : (
                  ""
                )
              }
            >
              <div key={i} className="col-auto px-3">
                <div>
                  {item.icon ? <>{item.icon} </> : null}
                  {item.value}
                </div>
              </div>
            </Tooltip>
          </React.Fragment>
        ))}
        <div className="ml-auto"></div>
        <div className="col-auto">
          <a
            href="#"
            style={{ fontSize: "1.2em" }}
            onClick={(e) => {
              e.preventDefault();
              setAnalysisModal(true);
            }}
          >
            <FaCog />
          </a>
        </div>
      </div>
    </div>
  );
}
