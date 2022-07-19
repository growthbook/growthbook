import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "../../services/DefinitionsContext";
import MoreMenu from "../Dropdown/MoreMenu";
import WatchButton from "../WatchButton";
import StatusIndicator from "./StatusIndicator";
import SortedTags from "../Tags/SortedTags";
import MarkdownInlineEdit from "../Markdown/MarkdownInlineEdit";
import Markdown from "../Markdown/Markdown";
import DimensionChooser from "../Dimensions/DimensionChooser";
import { phaseSummary } from "../../services/utils";
import { date } from "../../services/dates";
import { useState } from "react";
import RefreshSnapshotButton from "./RefreshSnapshotButton";
import Results from "./Results";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function SinglePage({ experiment, mutate }: Props) {
  const {
    getProjectById,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    projects,
  } = useDefinitions();

  const [dimension, setDimension] = useState("");

  const project = getProjectById(experiment.project || "");
  const datasource = getDatasourceById(experiment.datasource);
  const segment = getSegmentById(experiment.segment || "");
  const activationMetric = getMetricById(experiment.activationMetric || "");

  const phase = experiment.phases?.[experiment.phases?.length - 1];

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = exposureQueries.find(
    (q) => q.id === experiment.exposureQueryId
  );

  return (
    <div className="container-fluid">
      <div className="row align-items-center">
        <div className="col-auto">
          <h1>{experiment.name}</h1>
        </div>
        <div className="col-auto">
          <StatusIndicator
            archived={experiment.archived}
            status={experiment.status}
          />
        </div>
        <div className="col-auto ml-left">
          <WatchButton itemType="experiment" item={experiment.id} />
        </div>
        <div className="col-auto">
          <MoreMenu id="exp-more-menu"></MoreMenu>
        </div>
      </div>
      <div className="row align-items-center">
        {projects.length > 0 && (
          <div className="col-auto">
            Project:{" "}
            {project ? (
              <span className="badge badge-secondary">{project.name}</span>
            ) : (
              <em>None</em>
            )}
          </div>
        )}
        <div className="col-auto">
          Tags:{" "}
          {experiment.tags?.length > 0 ? (
            <SortedTags tags={experiment.tags} />
          ) : (
            <em>None</em>
          )}
        </div>

        <div className="col-auto ml-auto">
          <a href="#">View Audit Log</a>
        </div>
      </div>
      <div>
        <MarkdownInlineEdit
          value={experiment.description}
          save={async (description) => {
            console.log(description);
          }}
        />
        <h3>Hypothesis</h3>
        <Markdown>{experiment.hypothesis || "*none*"}</Markdown>
      </div>
      <div>
        <h2>Variations</h2>
        {experiment.variations.map((v, i) => (
          <div className="border shadow p-2" key={i}>
            <h4>{v.name}</h4>
            <small className="text-muted">Id: {v.key || i}</small>
          </div>
        ))}
      </div>
      <div>
        <h2>Results</h2>
        <div className="row">
          <div className="col-md-2">
            <div className="bg-light p-2">
              <div className="mb-2">
                <small className="text-weight-bold text-muted">
                  DATA SOURCE
                </small>
                {datasource?.name || "None"}
              </div>
              <div className="mb-2">
                <small className="text-weight-bold text-muted">
                  ASSIGNMENT QUERY
                </small>
                {exposureQuery?.name || "None"}
              </div>
              <div className="mb-2">
                <small className="text-weight-bold text-muted">
                  EXPERIMENT ID
                </small>
                {experiment.trackingKey || "None"}
              </div>
              <div className="mb-2">
                <small className="text-weight-bold text-muted">SEGMENT</small>
                {segment?.name || <em>All Users</em>}
              </div>
              <div className="mb-2">
                <small className="text-weight-bold text-muted">
                  ACTIVATION METRIC
                </small>
                {activationMetric?.name || "None"}
              </div>
              <hr />
              <div className="mb-2">
                <small className="text-weight-bold text-muted">DIMENSION</small>
                <DimensionChooser value={dimension} setValue={setDimension} />
              </div>
              {phase && (
                <div>
                  <hr />
                  <div className="mb-2">
                    <small className="text-weight-bold text-muted">
                      EXPERIMENT PHASE
                    </small>
                    {phase ? phaseSummary(phase) : "None"}
                  </div>
                  <div className="mb-2">
                    <small className="text-weight-bold text-muted">
                      DATE RANGE
                    </small>
                    {date(phase.dateStarted)} to{" "}
                    {phase.dateEnded ? date(phase.dateEnded) : "now"}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col">
            <Results
              experiment={experiment}
              mutateExperiment={mutate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
