import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  FaAngleRight,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaQuestionCircle,
  FaRegLightbulb,
} from "react-icons/fa";
import { MdRocketLaunch } from "react-icons/md";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import uniq from "lodash/uniq";
import {
  MetricRegressionAdjustmentStatus,
  ReportInterface,
} from "back-end/types/report";
import { DEFAULT_REGRESSION_ADJUSTMENT_ENABLED } from "shared/constants";
import { getAffectedEnvsForExperiment } from "shared/util";
import { getScopedSettings } from "shared/settings";
import { date } from "shared/dates";
import Collapsible from "react-collapsible";
import { DiscussionInterface } from "back-end/types/discussion";
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
import track from "@/services/track";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import MoreMenu from "../Dropdown/MoreMenu";
import WatchButton from "../WatchButton";
import SortedTags from "../Tags/SortedTags";
import MarkdownInlineEdit from "../Markdown/MarkdownInlineEdit";
import DiscussionThread from "../DiscussionThread";
import HeaderWithEdit from "../Layout/HeaderWithEdit";
import DeleteButton from "../DeleteButton/DeleteButton";
import {
  GBAddCircle,
  GBCircleArrowLeft,
  GBCuped,
  GBEdit,
  GBSequential,
} from "../Icons";
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
  metric: MetricInterface | null,
  experiment: ExperimentInterfaceStringDates,
  ignoreConversionEnd: boolean
) {
  if (!metric) return null;
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

  const isArchived = metric.status === "archived";

  return (
    <div className="row align-items-top" key={m}>
      <div className="col-sm-5">
        <div className="row">
          <div className="col-auto pr-0">-</div>
          <div className="col">
            <Link href={`/metric/${m}`}>
              <a className="font-weight-bold">
                {newMetric?.name}
                {isArchived ? (
                  <span className="text-muted small"> (archived)</span>
                ) : null}
              </a>
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
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  editVariations?: (() => void) | null;
  duplicate?: (() => void) | null;
  editTags?: (() => void) | null;
  editProject?: (() => void) | null;
  newPhase?: (() => void) | null;
  editPhases?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
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
  const [resultsTab, setResultsTab] = useLocalStorage<string>(
    `experiment-page__${experiment.id}__results-tab`,
    "overview"
  );
  const [customReportsOpen, setCustomReportsOpen] = useLocalStorage<boolean>(
    `experiment-page__${experiment.id}__custom-reports-open`,
    false
  );
  const [discussionOpen, setDiscussionOpen] = useLocalStorage<boolean>(
    `experiment-page__${experiment.id}__discussion-open`,
    false
  );

  const {
    getProjectById,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    projects,
    project: currentProject,
  } = useDefinitions();

  const router = useRouter();

  const { phase: phaseIndex, snapshot } = useSnapshot();
  const { data: reportsData } = useApi<{
    reports: ReportInterface[];
  }>(`/experiment/${experiment.id}/reports`);
  const { data: discussionData } = useApi<{ discussion: DiscussionInterface }>(
    `/discussion/experiment/${experiment.id}`
  );

  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const lastPhase = experiment?.phases?.[experiment?.phases?.length - 1];
  const startDate = experiment?.phases?.[0]?.dateStarted;
  const endDate = lastPhase?.dateEnded;

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);
  const orgSettings = useOrgSettings();
  const { organization, users, hasCommercialFeature } = useUser();

  const { data: sdkConnectionsData } = useSDKConnections();

  const projectId = experiment.project;
  const project = getProjectById(experiment.project || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment,
  });

  const datasource = getDatasourceById(experiment.datasource);
  const segment = getSegmentById(experiment.segment || "");
  const activationMetric = getMetricById(experiment.activationMetric || "");

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = exposureQueries.find(
    (q) => q.id === experiment.exposureQueryId
  );

  const statsEngine = scopedSettings.statsEngine.value;

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
  const denominatorMetricIds = uniq<string>(
    allExperimentMetrics.map((m) => m?.denominator).filter(Boolean) as string[]
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => getMetricById(m as string))
    .filter(Boolean) as MetricInterface[];

  const [
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    regressionAdjustmentHasValidMetrics,
  ] = useMemo(() => {
    const metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[] = [];
    let regressionAdjustmentAvailable = true;
    let regressionAdjustmentEnabled = true;
    let regressionAdjustmentHasValidMetrics = false;
    for (const metric of allExperimentMetrics) {
      if (!metric) continue;
      const {
        metricRegressionAdjustmentStatus,
      } = getRegressionAdjustmentsForMetric({
        metric: metric,
        denominatorMetrics: denominatorMetrics,
        experimentRegressionAdjustmentEnabled:
          experiment.regressionAdjustmentEnabled ??
          DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
        organizationSettings: orgSettings,
        metricOverrides: experiment.metricOverrides,
      });
      if (metricRegressionAdjustmentStatus.regressionAdjustmentEnabled) {
        regressionAdjustmentEnabled = true;
        regressionAdjustmentHasValidMetrics = true;
      }
      metricRegressionAdjustmentStatuses.push(metricRegressionAdjustmentStatus);
    }
    if (!experiment.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = false;
    }
    if (statsEngine === "bayesian") {
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
      regressionAdjustmentHasValidMetrics,
    ];
  }, [
    allExperimentMetrics,
    denominatorMetrics,
    orgSettings,
    statsEngine,
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

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");
  const hasVisualEditorPermission =
    canEditExperiment &&
    permissions.check("runExperiments", experiment.project, []);

  let hasRunExperimentsPermission = true;
  const envs = getAffectedEnvsForExperiment({ experiment });
  if (envs.length > 0) {
    if (!permissions.check("runExperiments", experiment.project, envs)) {
      hasRunExperimentsPermission = false;
    }
  }
  const canRunExperiment = canEditExperiment && hasRunExperimentsPermission;

  const ignoreConversionEnd =
    experiment.attributionModel === "experimentDuration";

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u?.name || u?.email);

  const hasSDKWithVisualExperimentsEnabled = sdkConnectionsData?.connections.some(
    (connection) => connection.includeVisualExperiments
  );

  // See if at least one visual change has been made with the editor
  const hasSomeVisualChanges = visualChangesets?.some((vc) =>
    vc.visualChanges.some(
      (changes) => changes.css || changes.domMutations?.length > 0
    )
  );

  const experimentPendingWithVisualChanges =
    experiment.status === "draft" &&
    experiment.phases.length > 0 &&
    hasVisualEditorPermission;

  return (
    <div className="container-fluid experiment-details pagecontents pb-3">
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
      <div className="row align-items-center mb-2">
        <div className="col-auto">
          <h1 className="mb-0">{experiment.name}</h1>
        </div>

        <div className="col-auto ml-auto">
          <WatchButton itemType="experiment" item={experiment.id} />
        </div>
        <div className="col-auto">
          <MoreMenu>
            {canRunExperiment && (
              <button
                className="dropdown-item"
                onClick={() => setEditNameOpen(true)}
              >
                Edit name
              </button>
            )}
            {canRunExperiment && (
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
            {canRunExperiment && (
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
            {canCreateAnalyses && experiment.archived && (
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
            {canCreateAnalyses && (
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

      <div className="mb-4 pt-2 pb-0 border rounded bg-light">
        <div className="mx-3 mb-2">
          <div className="row align-items-center mb-2">
            {(projects.length > 0 || projectIsDeReferenced) && (
              <div className="col-auto pr-3">
                Project:{" "}
                {projectIsDeReferenced ? (
                  <Tooltip
                    body={
                      <>
                        Project <code>{projectId}</code> not found
                      </>
                    }
                  >
                    <span className="text-danger">
                      <FaExclamationTriangle /> Invalid project
                    </span>
                  </Tooltip>
                ) : projectId ? (
                  <strong>{projectName}</strong>
                ) : (
                  <em className="text-muted">None</em>
                )}
                {editProject && (
                  <a
                    role="button"
                    className="ml-2 cursor-pointer"
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
            <div className="col-auto pr-3">
              Tags:{" "}
              {experiment.tags?.length > 0 ? (
                <SortedTags tags={experiment.tags} skipFirstMargin={true} />
              ) : (
                <em className="text-muted">None</em>
              )}{" "}
              {editTags && (
                <a
                  role="button"
                  className="ml-1 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    editTags();
                  }}
                >
                  <GBEdit />
                </a>
              )}
            </div>

            <div className="flex-1 col"></div>
            {startDate && (
              <div className="col-auto pr-2">
                <span className="small">
                  {date(startDate)}
                  {endDate && <> — {date(endDate)}</>}
                </span>
              </div>
            )}
            <div className="col-auto">
              <div
                className="border rounded overflow-hidden d-flex mt-1"
                style={{
                  backgroundColor: "var(--surface-background-color)",
                  boxShadow: "0 2px 5px rgba(0,0,0,.1) inset",
                }}
              >
                <div
                  className="d-flex px-3"
                  style={{ height: 30, lineHeight: "30px" }}
                >
                  <StatusIndicator
                    archived={experiment.archived}
                    status={experiment.status}
                    newUi={true}
                  />
                </div>
                {experiment.status === "stopped" && experiment.results && (
                  <div
                    className="d-flex border-left"
                    style={{ height: 30, lineHeight: "30px" }}
                  >
                    <ResultsIndicator
                      results={experiment.results}
                      newUi={true}
                    />
                  </div>
                )}
              </div>
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
                  {getProjectById(currentProject)?.name ||
                    "the current project"}
                </strong>
              </a>
            </div>
          )}
        </div>

        <div className="px-3">
          <MarkdownInlineEdit
            value={experiment.description ?? ""}
            save={async (description) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ description }),
              });
              mutate();
            }}
            canCreate={canEditExperiment}
            canEdit={canEditExperiment}
            className="mb-3"
            containerClassName="mb-1"
            headerClassName="font-weight-bolder"
            label="description"
            header="Description"
          />

          <MarkdownInlineEdit
            value={experiment.hypothesis ?? ""}
            save={async (hypothesis) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ hypothesis }),
              });
              mutate();
            }}
            canCreate={canEditExperiment}
            canEdit={canEditExperiment}
            label="hypothesis"
            header={
              <>
                <FaRegLightbulb /> Hypothesis
              </>
            }
            className="mb-3"
            containerClassName="mb-1"
            headerClassName="font-weight-bolder"
          />

          {idea && (
            <div className="mb-3">
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
                </div>
              </div>
              <div>
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
          )}
        </div>
      </div>

      <div className="mb-4 pt-3 appbox">
        <Collapsible
          trigger={
            <div className="px-3 pb-3">
              <HeaderWithEdit
                edit={editVariations ?? undefined}
                editElement={<div className="btn-link">Edit Variations</div>}
                stopPropagation={true}
                containerClassName="justify-content-between"
              >
                <>
                  <FaAngleRight className="chevron" /> Variations{" "}
                  <small>({experiment.variations.length})</small>
                </>
              </HeaderWithEdit>
            </div>
          }
          open={variationsOpen}
          onTriggerOpening={() => setVariationsOpen(true)}
          onTriggerClosing={() => setVariationsOpen(false)}
          transitionTime={150}
        >
          <div className="">
            <VariationsTable
              experiment={experiment}
              visualChangesets={visualChangesets}
              mutate={mutate}
              canEditExperiment={canEditExperiment}
              canEditVisualChangesets={hasVisualEditorPermission}
              setVisualEditorModal={setVisualEditorModal}
              newUi={true}
            />
          </div>
        </Collapsible>
      </div>

      {experimentPendingWithVisualChanges ? (
        <div>
          {visualChangesets.length > 0 ? (
            <div className="mb-4">
              {!hasSomeVisualChanges ? (
                <div className="alert alert-info">
                  Open{" "}
                  <strong>
                    Variations <FaAngleRight /> Visual Changes
                  </strong>{" "}
                  above and add at least one <strong>Visual Editor</strong>{" "}
                  change to your experiment before you start
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
                      if (editPhase) editPhase(experiment.phases.length - 1);
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

              {hasVisualEditorFeature ? (
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
        <></>
      )}

      {!experimentPendingWithVisualChanges && (
        <ControlledTabs
          newStyle={true}
          className="mt-3 mb-4"
          buttonsClassName="px-5"
          tabContentsClassName="border px-3 pt-3"
          setActive={(tab) => setResultsTab(tab ?? "overview")}
          active={resultsTab}
        >
          <Tab id="overview" display="Overview" padding={false}>
            <div className="mb-2" style={{ overflowX: "initial" }}>
              {experiment.phases?.length > 0 ? (
                <Results
                  experiment={experiment}
                  mutateExperiment={mutate}
                  editMetrics={editMetrics ?? undefined}
                  editResult={editResult ?? undefined}
                  editPhases={editPhases ?? undefined}
                  alwaysShowPhaseSelector={true}
                  reportDetailsLink={false}
                  statsEngine={statsEngine}
                  regressionAdjustmentAvailable={regressionAdjustmentAvailable}
                  regressionAdjustmentEnabled={regressionAdjustmentEnabled}
                  regressionAdjustmentHasValidMetrics={
                    regressionAdjustmentHasValidMetrics
                  }
                  metricRegressionAdjustmentStatuses={
                    metricRegressionAdjustmentStatuses
                  }
                  onRegressionAdjustmentChange={onRegressionAdjustmentChange}
                />
              ) : (
                <div className="text-center my-5">
                  <p>There are no experiment phases yet.</p>
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={newPhase ?? undefined}
                  >
                    Add a Phase
                  </button>
                </div>
              )}
            </div>
          </Tab>

          <Tab id="config" display="Configure" padding={false}>
            <div className="mb-4 mx-2">
              <RightRailSection
                title="Experiment Settings"
                open={() => setReportSettingsOpen(true)}
                canOpen={canEditExperiment}
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
                    <RightRailSectionGroup
                      title="Experiment Id"
                      type="commaList"
                    >
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
                        language={
                          datasource?.properties?.queryLanguage ?? "none"
                        }
                        code={experiment.queryFilter}
                        expandable={true}
                      />
                    </RightRailSectionGroup>
                  )}
                  <RightRailSectionGroup
                    title="Attribution Model"
                    type="custom"
                  >
                    <AttributionModelTooltip>
                      <strong>
                        {experiment.attributionModel === "experimentDuration"
                          ? "Experiment Duration"
                          : "First Exposure"}
                      </strong>{" "}
                      <FaQuestionCircle />
                    </AttributionModelTooltip>
                  </RightRailSectionGroup>
                  {statsEngine === "frequentist" && (
                    <>
                      <RightRailSectionGroup
                        title={
                          <>
                            <GBCuped size={16} /> Regression Adjustment (CUPED)
                          </>
                        }
                        type="custom"
                      >
                        {regressionAdjustmentEnabled ? "Enabled" : "Disabled"}
                      </RightRailSectionGroup>
                      <RightRailSectionGroup
                        title={
                          <>
                            <GBSequential size={16} /> Sequential Testing
                          </>
                        }
                        type="custom"
                      >
                        {experiment.sequentialTestingEnabled ??
                        !!orgSettings.sequentialTestingEnabled
                          ? "Enabled"
                          : "Disabled"}
                      </RightRailSectionGroup>
                    </>
                  )}
                </div>
              </RightRailSection>
              <div className="mb-4"></div>
              <RightRailSection
                title="Metrics"
                open={() => editMetrics && editMetrics()}
                canOpen={(editMetrics && !experiment.archived) ?? undefined}
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
                    {(experiment.guardrails?.length ?? 0) > 0 && (
                      <>
                        <div className="row mb-1 mt-3 text-muted">
                          <div className="col-5">Guardrails</div>
                          <div className="col-5">
                            Conversion{" "}
                            {ignoreConversionEnd ? "Delay" : "Window"}
                          </div>
                          <div className="col-sm-2">Behavior</div>
                        </div>
                        {experiment.guardrails?.map((m) => {
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
                            Conversion{" "}
                            {ignoreConversionEnd ? "Delay" : "Window"}
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
                open={editPhases ?? undefined}
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
                          editPhase={editPhase ?? undefined}
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
          </Tab>
        </ControlledTabs>
      )}

      {!experimentPendingWithVisualChanges && (
        <div className="mb-4 pt-3 appbox">
          <Collapsible
            trigger={
              <div className="row mx-2 pb-3">
                <div className="col h3">
                  <FaAngleRight className="chevron" /> Custom Reports{" "}
                  <small>({reportsData?.reports?.length || 0})</small>
                </div>
                {snapshot && (
                  <div className="col-auto mr-2">
                    <Button
                      className="btn btn-outline-primary float-right"
                      color="outline-info"
                      stopPropagation={true}
                      onClick={async () => {
                        const res = await apiCall<{ report: ReportInterface }>(
                          `/experiments/report/${snapshot.id}`,
                          {
                            method: "POST",
                          }
                        );
                        if (!res.report) {
                          throw new Error("Failed to create report");
                        }
                        await router.push(`/report/${res.report.id}`);
                      }}
                    >
                      <span className="h4 pr-2 m-0 d-inline-block align-top">
                        <GBAddCircle />
                      </span>
                      Add Custom Report
                    </Button>
                  </div>
                )}
              </div>
            }
            open={customReportsOpen}
            onTriggerOpening={() => setCustomReportsOpen(true)}
            onTriggerClosing={() => setCustomReportsOpen(false)}
            transitionTime={150}
          >
            <div className="px-4 mb-4">
              <ExperimentReportsList experiment={experiment} newUi={true} />
            </div>
          </Collapsible>
        </div>
      )}

      <div className="mb-4 pt-3 appbox">
        <Collapsible
          trigger={
            <div className="h3 px-3 pb-2">
              <FaAngleRight className="chevron" /> Discussion{" "}
              <small>
                ({discussionData?.discussion?.comments?.length || 0})
              </small>
            </div>
          }
          open={discussionOpen}
          onTriggerOpening={() => setDiscussionOpen(true)}
          onTriggerClosing={() => setDiscussionOpen(false)}
          transitionTime={150}
        >
          <div className="px-4 mb-4">
            <DiscussionThread
              type="experiment"
              id={experiment.id}
              allowNewComments={!experiment.archived}
              project={experiment.project}
            />
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
