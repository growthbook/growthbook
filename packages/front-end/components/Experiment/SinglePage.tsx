import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  FaArrowDown,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaLink,
  FaQuestionCircle,
} from "react-icons/fa";
import { MdRocketLaunch } from "react-icons/md";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import uniq from "lodash/uniq";
import { MetricRegressionAdjustmentStatus } from "back-end/types/report";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { getDefaultConversionWindowHours } from "@/services/env";
import {
  applyMetricOverrides,
  getRegressionAdjustmentsForMetric,
} from "@/services/experiments";
import useSDKConnections from "@/hooks/useSDKConnections";
import useOrgSettings from "@/hooks/useOrgSettings";
import { AppFeatures } from "@/types/app-features";
import track from "@/services/track";
import MoreMenu from "../Dropdown/MoreMenu";
import WatchButton from "../WatchButton";
import SortedTags from "../Tags/SortedTags";
import MarkdownInlineEdit from "../Markdown/MarkdownInlineEdit";
import DiscussionThread from "../DiscussionThread";
import HeaderWithEdit from "../Layout/HeaderWithEdit";
import DeleteButton from "../DeleteButton/DeleteButton";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "../Icons";
import RightRailSection from "../Layout/RightRailSection";
import RightRailSectionGroup from "../Layout/RightRailSectionGroup";
import Modal from "../Modal";
import HistoryTable from "../HistoryTable";
import Code from "../SyntaxHighlighting/Code";
import Tooltip from "../Tooltip/Tooltip";
import Button from "../Button";
import PremiumTooltip from "../Marketing/PremiumTooltip";
import { AttributionModelTooltip } from "./AttributionModelTooltip";
import ResultsIndicator from "./ResultsIndicator";
import EditStatusModal from "./EditStatusModal";
import EditExperimentNameForm from "./EditExperimentNameForm";
import { useSnapshot } from "./SnapshotProvider";
import ExperimentReportsList from "./ExperimentReportsList";
import AnalysisForm from "./AnalysisForm";
import Results from "./Results";
import StatusIndicator from "./StatusIndicator";
import ExpandablePhaseSummary from "./ExpandablePhaseSummary";
import VariationsTable from "./VariationsTable";
import VisualChangesetModal from "./VisualChangesetModal";

function drawMetricRow(
  m: string,
  metric: MetricInterface,
  experiment: ExperimentInterfaceStringDates,
  ignoreConversionEnd: boolean
) {
  const { newMetric, overrideFields } = applyMetricOverrides(
    metric,
    experiment.metricOverrides
  );
  if (!newMetric) return null;

  const conversionStart = newMetric.conversionDelayHours || 0;
  const conversionEnd =
    (newMetric.conversionDelayHours || 0) +
    (newMetric.conversionWindowHours || getDefaultConversionWindowHours());

  const hasOverrides =
    overrideFields.includes("conversionDelayHours") ||
    (!ignoreConversionEnd && overrideFields.includes("conversionWindowHours"));

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
            {conversionStart}{" "}
            {ignoreConversionEnd ? "" : "to " + conversionEnd + " "}
            hours{" "}
            {hasOverrides && (
              <span className="font-italic text-purple">(override)</span>
            )}
          </div>
        )}
      </div>
      <div className="col-sm-1">
        <div className="small">
          {overrideFields.includes("winRisk") ||
          overrideFields.includes("loseRisk") ||
          overrideFields.includes("regressionAdjustmentOverride") ||
          overrideFields.includes("regressionAdjustmentEnabled") ||
          overrideFields.includes("regressionAdjustmentDays") ? (
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
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editMetrics?: () => void;
  editResult?: () => void;
  editVariations?: () => void;
  duplicate?: () => void;
  editTags?: () => void;
  editProject?: () => void;
  newPhase?: () => void;
  editPhases?: () => void;
  editPhase?: (i: number | null) => void;
}

export default function SinglePage({
  experiment,
  idea,
  visualChangesets,
  mutate,
  editMetrics,
  editResult,
  editVariations,
  duplicate,
  editTags,
  editProject,
  newPhase,
  editPhases,
  editPhase,
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
  const [visualEditorModal, setVisualEditorModal] = useState(false);

  const growthbook = useGrowthBook<AppFeatures>();

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);
  const settings = useOrgSettings();
  const { users, hasCommercialFeature } = useUser();

  const { data: sdkConnectionsData } = useSDKConnections();

  const project = getProjectById(experiment.project || "");
  const datasource = getDatasourceById(experiment.datasource);
  const segment = getSegmentById(experiment.segment || "");
  const activationMetric = getMetricById(experiment.activationMetric || "");

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = exposureQueries.find(
    (q) => q.id === experiment.exposureQueryId
  );

  const statsEngine = settings.statsEngine || "bayesian";

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );

  const allExperimentMetricIds = uniq([
    ...experiment.metrics,
    ...(experiment.guardrails ?? []),
  ]);
  const allExperimentMetrics = allExperimentMetricIds.map((m) =>
    getMetricById(m)
  );
  const denominatorMetricIds = uniq(
    allExperimentMetrics.map((m) => m?.denominator).filter((m) => m)
  );
  const denominatorMetrics = denominatorMetricIds.map((m) => getMetricById(m));

  const [
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
  ] = useMemo(() => {
    const metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[] = [];
    let regressionAdjustmentAvailable = true;
    let regressionAdjustmentEnabled = false;
    for (const metric of allExperimentMetrics) {
      if (!metric) continue;
      const {
        metricRegressionAdjustmentStatus,
      } = getRegressionAdjustmentsForMetric({
        metric: metric,
        denominatorMetrics: denominatorMetrics,
        experimentRegressionAdjustmentEnabled: !!experiment.regressionAdjustmentEnabled,
        organizationSettings: settings,
        metricOverrides: experiment.metricOverrides,
      });
      if (metricRegressionAdjustmentStatus.regressionAdjustmentEnabled) {
        regressionAdjustmentEnabled = true;
      }
      metricRegressionAdjustmentStatuses.push(metricRegressionAdjustmentStatus);
    }
    if (!experiment.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = false;
    }
    if (!settings.statsEngine || settings.statsEngine === "bayesian") {
      regressionAdjustmentAvailable = false;
      regressionAdjustmentEnabled = false;
    }
    if (
      !datasource?.type ||
      datasource?.type === "google_analytics" ||
      datasource?.type === "mixpanel"
    ) {
      // these do not implement getExperimentMetricQuery
      regressionAdjustmentAvailable = false;
      regressionAdjustmentEnabled = false;
    }
    if (!hasRegressionAdjustmentFeature) {
      regressionAdjustmentEnabled = false;
    }
    return [
      regressionAdjustmentAvailable,
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatuses,
    ];
  }, [
    allExperimentMetrics,
    denominatorMetrics,
    settings,
    experiment.regressionAdjustmentEnabled,
    experiment.metricOverrides,
    datasource?.type,
    hasRegressionAdjustmentFeature,
  ]);

  const onRegressionAdjustmentChange = async (enabled: boolean) => {
    await apiCall(`/experiment/${experiment.id}/`, {
      method: "POST",
      body: JSON.stringify({
        regressionAdjustmentEnabled: !!enabled,
      }),
    });
    mutate();
  };

  const hasPermission = permissions.check("createAnalyses", experiment.project);

  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");

  const canEdit = hasPermission && !experiment.archived;

  const ignoreConversionEnd =
    experiment.attributionModel === "experimentDuration";

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u.name || u.email);

  const hasSDKWithVisualExperimentsEnabled = sdkConnectionsData?.connections.some(
    (connection) => connection.includeVisualExperiments
  );

  // See if at least one visual change has been made with the editor
  const hasSomeVisualChanges = visualChangesets?.some((vc) =>
    vc.visualChanges.some(
      (changes) => changes.css || changes.domMutations?.length > 0
    )
  );

  return (
    <div className="container-fluid experiment-details pagecontents">
      <div className="mb-2 mt-1">
        <Link
          href={`/experiments${
            experiment.status === "draft"
              ? "#drafts"
              : experiment.status === "stopped"
              ? "#stopped"
              : ""
          }`}
        >
          <a>
            <GBCircleArrowLeft /> Back to all experiments
          </a>
        </Link>
      </div>
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
      {visualEditorModal && (
        <VisualChangesetModal
          mode="add"
          experiment={experiment}
          mutate={mutate}
          close={() => setVisualEditorModal(false)}
        />
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
          <div className="appbox h-100">
            <div className="p-3">
              <MarkdownInlineEdit
                value={experiment.description}
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
              />{" "}
            </div>
            <div className="px-3">
              <HeaderWithEdit edit={editVariations}>
                <>
                  Variations <small>({experiment.variations.length})</small>
                </>
              </HeaderWithEdit>
            </div>
            <VariationsTable
              experiment={experiment}
              visualChangesets={visualChangesets}
              mutate={mutate}
              canEdit={canEdit}
            />
          </div>
        </div>
        <div className="col-md-4">
          <RightRailSection
            title="Experiment Settings"
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
                  <Tooltip body={datasource?.description || ""}>
                    <Link href={`/datasources/${datasource?.id}`}>
                      {datasource?.name}
                    </Link>
                  </Tooltip>
                )}
              </RightRailSectionGroup>
              {experiment.hashAttribute && (
                <RightRailSectionGroup
                  title="Assignment Attribute"
                  type="commaList"
                >
                  {experiment.hashAttribute}
                </RightRailSectionGroup>
              )}
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
                  title="Analysis Segment"
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
                    {experiment.attributionModel === "experimentDuration"
                      ? "Experiment Duration"
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
                  Conversion {ignoreConversionEnd ? "Delay" : "Window"}{" "}
                  <Tooltip
                    body={
                      ignoreConversionEnd
                        ? `Wait this long after viewing the experiment before we start counting conversions for a user.`
                        : `After a user sees the experiment, only include
                          metric conversions within the specified time window.`
                    }
                  >
                    <FaQuestionCircle />
                  </Tooltip>
                </div>
                <div className="col-sm-2">Behavior</div>
              </div>
              <>
                {experiment.metrics.map((m) => {
                  const metric = getMetricById(m);
                  return drawMetricRow(
                    m,
                    metric,
                    experiment,
                    ignoreConversionEnd
                  );
                })}
                {experiment.guardrails?.length > 0 && (
                  <>
                    <div className="row mb-1 mt-3 text-muted">
                      <div className="col-5">Guardrails</div>
                      <div className="col-5">
                        Conversion {ignoreConversionEnd ? "Delay" : "Window"}
                      </div>
                      <div className="col-sm-2">Behavior</div>
                    </div>
                    {experiment.guardrails.map((m) => {
                      const metric = getMetricById(m);
                      return drawMetricRow(
                        m,
                        metric,
                        experiment,
                        ignoreConversionEnd
                      );
                    })}
                  </>
                )}
                {experiment.activationMetric && (
                  <>
                    <div className="row mb-1 mt-3 text-muted">
                      <div className="col-5">Activation Metric</div>
                      <div className="col-5">
                        Conversion {ignoreConversionEnd ? "Delay" : "Window"}
                      </div>
                      <div className="col-sm-2">Behavior</div>
                    </div>
                    {drawMetricRow(
                      experiment.activationMetric,
                      getMetricById(experiment.activationMetric),
                      experiment,
                      ignoreConversionEnd
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
            <div className="appbox mb-0">
              {experiment.phases?.length > 0 ? (
                <div>
                  {experiment.phases.map((phase, i) => (
                    <ExpandablePhaseSummary
                      key={i}
                      phase={phase}
                      i={i}
                      editPhase={editPhase}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center p-3">
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

      {growthbook.isOn("visual-editor-ui") &&
      experiment.status === "draft" &&
      experiment.phases.length > 0 ? (
        <div>
          {visualChangesets.length > 0 ? (
            <div className="mb-4">
              {!hasSomeVisualChanges ? (
                <div className="alert alert-info">
                  Open the Visual Editor above and add at least one change to
                  your experiment before you start
                </div>
              ) : hasSDKWithVisualExperimentsEnabled ? (
                <div className="appbox text-center px-3 py-5">
                  <p>Done setting everything up?</p>
                  <Button
                    color="primary"
                    className="btn-lg"
                    onClick={async () => {
                      await apiCall(`/experiment/${experiment.id}/status`, {
                        method: "POST",
                        body: JSON.stringify({
                          status: "running",
                        }),
                      });
                      await mutate();
                      track("Start experiment", {
                        source: "visual-editor-ui",
                        action: "main CTA",
                      });
                    }}
                  >
                    Start Experiment <MdRocketLaunch />
                  </Button>{" "}
                  <Button
                    className="ml-2"
                    color="link"
                    onClick={async () => {
                      editPhase(experiment.phases.length - 1);
                      track("Edit phase", { source: "visual-editor-ui" });
                    }}
                  >
                    Edit Targeting
                  </Button>
                </div>
              ) : (
                <div className="w-100 mt-2 mb-0 alert alert-warning">
                  <div className="mb-2">
                    <strong>
                      <FaExclamationTriangle /> You must configure one of your
                      SDK Connections to include Visual Experiments before
                      starting
                    </strong>
                  </div>
                  Go to <Link href="/sdks">SDK Connections</Link>
                </div>
              )}
            </div>
          ) : (
            <div className="appbox text-center px-3 pt-4 pb-3 mb-4">
              <p>
                Use our Visual Editor to make changes to your site without
                deploying code
              </p>

              {hasVisualEditorFeature && canEdit ? (
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => {
                    setVisualEditorModal(true);
                    track("Open visual editor modal", {
                      source: "visual-editor-ui",
                      action: "add",
                    });
                  }}
                >
                  Open Visual Editor
                </button>
              ) : (
                <div className="ml-3">
                  <PremiumTooltip commercialFeature={"visual-editor"}>
                    <div className="btn btn-primary btn-lg disabled">
                      Open Visual Editor
                    </div>
                  </PremiumTooltip>
                </div>
              )}

              <div className="text-right">
                <p className="mb-1 text-muted small">Want to skip this step?</p>
                <Button
                  color=""
                  className="btn-sm btn-outline-primary"
                  onClick={async () => {
                    await apiCall(`/experiment/${experiment.id}/status`, {
                      method: "POST",
                      body: JSON.stringify({
                        status: "running",
                      }),
                    });
                    await mutate();
                    track("Start experiment", {
                      source: "visual-editor-ui",
                      action: "bypass visual editor",
                    });
                  }}
                >
                  Start Experiment <MdRocketLaunch />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
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
            <div className="appbox" style={{ overflowX: "initial" }}>
              {experiment.phases?.length > 0 ? (
                <Results
                  experiment={experiment}
                  mutateExperiment={mutate}
                  editMetrics={editMetrics}
                  editResult={editResult}
                  editPhases={editPhases}
                  alwaysShowPhaseSelector={true}
                  reportDetailsLink={false}
                  statsEngine={statsEngine}
                  regressionAdjustmentAvailable={regressionAdjustmentAvailable}
                  regressionAdjustmentEnabled={regressionAdjustmentEnabled}
                  metricRegressionAdjustmentStatuses={
                    metricRegressionAdjustmentStatuses
                  }
                  onRegressionAdjustmentChange={onRegressionAdjustmentChange}
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
        </>
      )}

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
