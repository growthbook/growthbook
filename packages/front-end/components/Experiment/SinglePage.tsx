import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  FaArrowDown,
  FaExternalLinkAlt,
  FaLink,
  FaQuestionCircle,
} from "react-icons/fa";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { phaseSummary } from "@/services/utils";
import { date } from "@/services/dates";
import { getDefaultConversionWindowHours } from "@/services/env";
import { applyMetricOverrides } from "@/services/experiments";
import MoreMenu from "../Dropdown/MoreMenu";
import WatchButton from "../WatchButton";
import SortedTags from "../Tags/SortedTags";
import MarkdownInlineEdit from "../Markdown/MarkdownInlineEdit";
import DiscussionThread from "../DiscussionThread";
import HeaderWithEdit from "../Layout/HeaderWithEdit";
import DeleteButton from "../DeleteButton/DeleteButton";
import { GBAddCircle, GBEdit } from "../Icons";
import RightRailSection from "../Layout/RightRailSection";
import RightRailSectionGroup from "../Layout/RightRailSectionGroup";
import Modal from "../Modal";
import HistoryTable from "../HistoryTable";
import Code from "../SyntaxHighlighting/Code";
import Tooltip from "../Tooltip/Tooltip";
import { AttributionModelTooltip } from "./AttributionModelTooltip";
import ResultsIndicator from "./ResultsIndicator";
import EditStatusModal from "./EditStatusModal";
import EditExperimentNameForm from "./EditExperimentNameForm";
import { useSnapshot } from "./SnapshotProvider";
import ExperimentReportsList from "./ExperimentReportsList";
import AnalysisForm from "./AnalysisForm";
import VariationBox from "./VariationBox";
import Results from "./Results";
import StatusIndicator from "./StatusIndicator";

function getColWidth(v: number) {
  // 2 across
  if (v <= 2) return 6;

  // 3 across
  if (v === 3 || v === 6 || v === 9) return 4;

  // 4 across
  return 3;
}

function drawMetricRow(
  m: string,
  metric: MetricInterface,
  experiment: ExperimentInterfaceStringDates
) {
  const { newMetric, overrideFields } = applyMetricOverrides(
    metric,
    experiment.metricOverrides
  );
  return (
    <div className="row align-items-top" key={m}>
      <div className="col-sm-5">
        <div className="row">
          <div className="col-auto pr-0">-</div>
          <div className="col">
            <Link href={`/metric/${m}`}>
              <a className="font-weight-bold">{newMetric?.name}</a>
            </Link>
          </div>
        </div>
      </div>
      <div className="col-sm-5 ml-2">
        {newMetric && (
          <div className="small">
            {newMetric.conversionDelayHours || 0} to{" "}
            {(newMetric.conversionDelayHours || 0) +
              (newMetric.conversionWindowHours ||
                getDefaultConversionWindowHours())}{" "}
            hours{" "}
            {(overrideFields.includes("conversionDelayHours") ||
              overrideFields.includes("conversionWindowHours")) && (
              <span className="font-italic text-purple">(override)</span>
            )}
          </div>
        )}
      </div>
      <div className="col-sm-1">
        <div className="small">
          {overrideFields.includes("winRisk") ||
          overrideFields.includes("loseRisk") ? (
            <span className="font-italic text-purple">override</span>
          ) : (
            <span className="text-muted">default</span>
          )}
        </div>
      </div>
    </div>
  );
}

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  idea?: IdeaInterface;
  mutate: () => void;
  editMetrics?: () => void;
  editResult?: () => void;
  editVariations?: () => void;
  duplicate?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  newPhase?: () => void;
  editPhases?: () => void;
}

export default function SinglePage({
  experiment,
  idea,
  mutate,
  editMetrics,
  editResult,
  editVariations,
  duplicate,
  editTags,
  editProject,
  newPhase,
  editPhases,
}: Props) {
  const {
    getProjectById,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    projects,
    project: currentProject,
  } = useDefinitions();

  const router = useRouter();

  const { phase: phaseIndex } = useSnapshot();

  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);
  const { users } = useUser();

  const project = getProjectById(experiment.project || "");
  const datasource = getDatasourceById(experiment.datasource);
  const segment = getSegmentById(experiment.segment || "");
  const activationMetric = getMetricById(experiment.activationMetric || "");

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = exposureQueries.find(
    (q) => q.id === experiment.exposureQueryId
  );

  const hasPermission = permissions.check("createAnalyses", experiment.project);

  const canEdit = hasPermission && !experiment.archived;

  const variationCols = getColWidth(experiment.variations.length);

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u.name || u.email);

  return (
    <div className="container-fluid experiment-details pagecontents">
      {reportSettingsOpen && (
        <AnalysisForm
          cancel={() => setReportSettingsOpen(false)}
          experiment={experiment}
          mutate={mutate}
          phase={phaseIndex}
          editDates={false}
          editVariationIds={false}
        />
      )}
      {editNameOpen && (
        <EditExperimentNameForm
          experiment={experiment}
          mutate={mutate}
          cancel={() => setEditNameOpen(false)}
        />
      )}
      {auditModal && (
        <Modal
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="experiment" id={experiment.id} />
        </Modal>
      )}
      {watchersModal && (
        <Modal
          open={true}
          header="Experiment Watchers"
          close={() => setWatchersModal(false)}
          closeCta="Close"
        >
          <ul>
            {usersWatching.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </Modal>
      )}
      {statusModal && (
        <EditStatusModal
          experiment={experiment}
          close={() => setStatusModal(false)}
          mutate={mutate}
        />
      )}
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h1 className="mb-0">{experiment.name}</h1>
        </div>
        <div className="col-auto">
          <StatusIndicator
            archived={experiment.archived}
            status={experiment.status}
          />
        </div>
        {experiment.status === "stopped" && experiment.results && (
          <div className="col-auto">
            <ResultsIndicator results={experiment.results} />
          </div>
        )}
        {experiment.status !== "draft" && (
          <a href="#results">
            <FaArrowDown /> Jump to results
          </a>
        )}
        <div className="col-auto ml-auto">
          <WatchButton itemType="experiment" item={experiment.id} />
        </div>
        <div className="col-auto">
          <MoreMenu>
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={() => setEditNameOpen(true)}
              >
                Edit name
              </button>
            )}
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={() => setStatusModal(true)}
              >
                Edit status
              </button>
            )}
            <button
              className="dropdown-item"
              onClick={() => setAuditModal(true)}
            >
              Audit log
            </button>
            <button
              className="dropdown-item"
              onClick={() => setWatchersModal(true)}
            >
              View watchers{" "}
              <span className="badge badge-pill badge-info">
                {usersWatching.length}
              </span>
            </button>
            {duplicate && (
              <button className="dropdown-item" onClick={duplicate}>
                Duplicate
              </button>
            )}
            {!experiment.archived && hasPermission && (
              <button
                className="dropdown-item"
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    await apiCall(`/experiment/${experiment.id}/archive`, {
                      method: "POST",
                    });
                    mutate();
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                Archive
              </button>
            )}
            {experiment.archived && hasPermission && (
              <button
                className="dropdown-item"
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    await apiCall(`/experiment/${experiment.id}/unarchive`, {
                      method: "POST",
                    });
                    mutate();
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                Unarchive
              </button>
            )}
            {hasPermission && (
              <DeleteButton
                className="dropdown-item text-danger"
                useIcon={false}
                text="Delete"
                displayName="Experiment"
                onClick={async () => {
                  await apiCall<{ status: number; message?: string }>(
                    `/experiment/${experiment.id}`,
                    {
                      method: "DELETE",
                      body: JSON.stringify({ id: experiment.id }),
                    }
                  );
                  router.push("/experiments");
                }}
              />
            )}
          </MoreMenu>
        </div>
      </div>
      <div className="row align-items-center mb-4">
        {projects.length > 0 && (
          <div className="col-auto">
            Project:{" "}
            {project ? (
              <span className="badge badge-secondary">{project.name}</span>
            ) : (
              <em>None</em>
            )}{" "}
            {editProject && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  editProject();
                }}
              >
                <GBEdit />
              </a>
            )}
          </div>
        )}
        {idea && (
          <div className="col-auto">
            <div className="d-flex align-items-center">
              <div className="mr-1">Idea:</div>
              <div>
                {idea.impactScore > 0 && (
                  <div
                    className="badge badge-primary mr-1"
                    title="Impact Score"
                  >
                    {idea.impactScore}
                    <small>/100</small>
                  </div>
                )}
                <Link href={`/idea/${idea.id}`}>
                  <a
                    style={{
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "inline-block",
                      whiteSpace: "nowrap",
                      verticalAlign: "middle",
                    }}
                    title={idea.text}
                  >
                    <FaExternalLinkAlt /> {idea.text}
                  </a>
                </Link>
              </div>
            </div>
          </div>
        )}
        <div className="col-auto">
          Tags:{" "}
          {experiment.tags?.length > 0 ? (
            <SortedTags tags={experiment.tags} />
          ) : (
            <em>None</em>
          )}{" "}
          {editTags && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                editTags();
              }}
            >
              <GBEdit />
            </a>
          )}
        </div>
      </div>
      {currentProject && currentProject !== experiment.project && (
        <div className="alert alert-warning p-2 mb-2 text-center">
          This experiment is not in your current project.{" "}
          <a
            href="#"
            className="a"
            onClick={async (e) => {
              e.preventDefault();
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({
                  currentProject,
                }),
              });
              mutate();
            }}
          >
            Move it to{" "}
            <strong>
              {getProjectById(currentProject)?.name || "the current project"}
            </strong>
          </a>
        </div>
      )}
      <div className="row mb-4">
        <div className="col-md-8">
          <div className="appbox p-3 h-100">
            <MarkdownInlineEdit
              value={experiment.description || experiment.observations}
              save={async (description) => {
                await apiCall(`/experiment/${experiment.id}`, {
                  method: "POST",
                  body: JSON.stringify({ description }),
                });
                mutate();
              }}
              canCreate={canEdit}
              canEdit={canEdit}
              className="mb-4"
              header="Description"
            />
            <MarkdownInlineEdit
              value={experiment.hypothesis}
              save={async (hypothesis) => {
                await apiCall(`/experiment/${experiment.id}`, {
                  method: "POST",
                  body: JSON.stringify({ hypothesis }),
                });
                mutate();
              }}
              canCreate={canEdit}
              canEdit={canEdit}
              className="mb-4"
              label="hypothesis"
              header="Hypothesis"
            />
            <HeaderWithEdit edit={editVariations}>Variations</HeaderWithEdit>
            <div className="row">
              {experiment.variations.map((v, i) => (
                <div key={i} className={`col-md-${variationCols} mb-2`}>
                  <VariationBox
                    canEdit={canEdit}
                    experimentId={experiment.id}
                    i={i}
                    mutate={mutate}
                    v={v}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <RightRailSection
            title="Analysis Settings"
            open={() => setReportSettingsOpen(true)}
            canOpen={canEdit}
          >
            <div className="appbox px-3 pt-3 pb-2">
              <RightRailSectionGroup
                title="Data Source"
                type="commaList"
                titleClassName="align-top"
              >
                {datasource && (
                  <div className="d-inline-block" style={{ maxWidth: 300 }}>
                    <div>
                      <Link href={`/datasources/${datasource?.id}`}>
                        {datasource?.name}
                      </Link>
                    </div>
                    <div className="text-gray font-weight-normal small text-ellipsis">
                      {datasource?.description}
                    </div>
                  </div>
                )}
              </RightRailSectionGroup>
              {exposureQuery && (
                <RightRailSectionGroup
                  title="Assignment Query"
                  type="commaList"
                >
                  {exposureQuery?.name}
                </RightRailSectionGroup>
              )}
              {datasource && (
                <RightRailSectionGroup title="Experiment Id" type="commaList">
                  {experiment.trackingKey}
                </RightRailSectionGroup>
              )}
              {datasource?.properties?.segments && (
                <RightRailSectionGroup
                  title="Segment"
                  type="commaList"
                  empty="All Users"
                >
                  {segment?.name}
                </RightRailSectionGroup>
              )}
              {experiment.activationMetric && (
                <RightRailSectionGroup
                  title="Activation Metric"
                  type="commaList"
                >
                  {activationMetric?.name}
                </RightRailSectionGroup>
              )}
              {experiment.queryFilter && (
                <RightRailSectionGroup title="Custom Filter" type="custom">
                  <Code
                    language={datasource?.properties?.queryLanguage}
                    code={experiment.queryFilter}
                    expandable={true}
                  />
                </RightRailSectionGroup>
              )}
              <RightRailSectionGroup title="Attribution Model" type="custom">
                <AttributionModelTooltip>
                  <strong>
                    {experiment.attributionModel === "allExposures"
                      ? "All Exposures"
                      : "First Exposure"}
                  </strong>{" "}
                  <FaQuestionCircle />
                </AttributionModelTooltip>
              </RightRailSectionGroup>
            </div>
          </RightRailSection>
          <div className="mb-4"></div>
          <RightRailSection
            title="Metrics"
            open={() => editMetrics && editMetrics()}
            canOpen={editMetrics && !experiment.archived}
          >
            <div className="appbox p-3">
              <div className="row mb-1 text-muted">
                <div className="col-5">Goals</div>
                <div className="col-5">
                  Conversion Window{" "}
                  <Tooltip
                    body={`After a user sees the experiment, only include
                          metric conversions within the specified time window.`}
                  >
                    <FaQuestionCircle />
                  </Tooltip>
                </div>
                <div className="col-sm-2">Behavior</div>
              </div>
              <>
                {experiment.metrics.map((m) => {
                  const metric = getMetricById(m);
                  return drawMetricRow(m, metric, experiment);
                })}
                {experiment.guardrails?.length > 0 && (
                  <>
                    <div className="row mb-1 mt-3 text-muted">
                      <div className="col-5">Guardrails</div>
                      <div className="col-5">Conversion Window</div>
                      <div className="col-sm-2">Behavior</div>
                    </div>
                    {experiment.guardrails.map((m) => {
                      const metric = getMetricById(m);
                      return drawMetricRow(m, metric, experiment);
                    })}
                  </>
                )}
                {experiment.activationMetric && (
                  <>
                    <div className="row mb-1 mt-3 text-muted">
                      <div className="col-5">Activation Metric</div>
                      <div className="col-5">Conversion Window</div>
                      <div className="col-sm-2">Behavior</div>
                    </div>
                    {drawMetricRow(
                      experiment.activationMetric,
                      getMetricById(experiment.activationMetric),
                      experiment
                    )}
                  </>
                )}
              </>
            </div>
          </RightRailSection>
          <div className="mb-4"></div>
          <RightRailSection
            title="Phases"
            open={editPhases}
            canOpen={!!editPhases}
          >
            <div className="appbox p-3 mb-0">
              {experiment.phases?.length > 0 ? (
                <div>
                  {experiment.phases.map((phase, i) => (
                    <div key={i} className={`${i ? "mt-2" : ""} d-flex`}>
                      <div className="mr-2">{i + 1}:</div>
                      <div className="small">
                        <div>{phaseSummary(phase)}</div>
                        <div>
                          <strong>{date(phase.dateStarted)}</strong> to{" "}
                          <strong>
                            {phase.dateEnded ? date(phase.dateEnded) : "now"}
                          </strong>
                        </div>
                      </div>
                      <div></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center">
                  <em>No experiment phases defined.</em>
                  {newPhase && (
                    <div className="mt-2">
                      <button
                        className="btn btn-outline-primary btn-sm"
                        onClick={newPhase}
                      >
                        <GBAddCircle /> Add a Phase
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </RightRailSection>
        </div>
      </div>
      <div className="mb-4 position-relative">
        <div style={{ position: "absolute", top: -70 }} id="results"></div>
        <h3>
          Results{" "}
          <a
            href="#results"
            className="small"
            style={{ verticalAlign: "middle" }}
          >
            <FaLink />
          </a>
        </h3>
        <div className="appbox">
          {experiment.phases?.length > 0 ? (
            <Results
              experiment={experiment}
              mutateExperiment={mutate}
              editMetrics={editMetrics}
              editResult={editResult}
              editPhases={editPhases}
              alwaysShowPhaseSelector={true}
              reportDetailsLink={false}
            />
          ) : (
            <div className="text-center my-5">
              <p>There are no experiment phases yet.</p>
              <button className="btn btn-primary btn-lg" onClick={newPhase}>
                Add a Phase
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mb-4">
        <ExperimentReportsList experiment={experiment} />
      </div>
      <div className="pb-3">
        <h2>Discussion</h2>
        <DiscussionThread
          type="experiment"
          id={experiment.id}
          allowNewComments={!experiment.archived}
          project={experiment.project}
        />
      </div>
    </div>
  );
}
