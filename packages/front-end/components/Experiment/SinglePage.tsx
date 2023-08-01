import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  FaAngleRight,
  FaClock,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaQuestionCircle,
  FaRegLightbulb,
} from "react-icons/fa";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import uniq from "lodash/uniq";
import {
  MetricRegressionAdjustmentStatus,
  ReportInterface,
} from "back-end/types/report";
import { DEFAULT_REGRESSION_ADJUSTMENT_ENABLED } from "shared/constants";
import {
  MatchingRule,
  getAffectedEnvsForExperiment,
  getMatchingRules,
  includeExperimentInPayload,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { date } from "shared/dates";
import Collapsible from "react-collapsible";
import { DiscussionInterface } from "back-end/types/discussion";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { FeatureInterface } from "back-end/types/feature";
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
import { useLocalStorage } from "@/hooks/useLocalStorage";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import LinkedFeatureFlag from "@/components/Experiment/LinkedFeatureFlag";
import { useEnvironments, useFeaturesList } from "@/services/features";
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
import { DocLink } from "../DocLink";
import FeatureFromExperimentModal from "../Features/FeatureModal/FeatureFromExperimentModal";
import { openVisualEditor } from "../OpenVisualEditorLink";
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
import StatusBanner from "./StatusBanner";
import AddLinkedChangesBanner from "./AddLinkedChangesBanner";
import { StartExperimentBanner } from "./StartExperimentBanner";

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

type ResultsTab = "results" | "config";

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
  const [metaInfoOpen, setMetaInfoOpen] = useLocalStorage<boolean>(
    `experiment-page__${experiment.id}__meta-info-open`,
    true
  );
  const [resultsTab, setResultsTab] = useLocalStorage<ResultsTab>(
    `experiment-page__${experiment.id}__results-tab`,
    "results"
  );
  const [customReportsOpen, setCustomReportsOpen] = useLocalStorage<boolean>(
    `experiment-page__${experiment.id}__custom-reports-open`,
    true
  );
  const [discussionOpen, setDiscussionOpen] = useLocalStorage<boolean>(
    `experiment-page__${experiment.id}__discussion-open`,
    true
  );

  const {
    getProjectById,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    projects,
    datasources,
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

  const { features, mutate: mutateFeatures } = useFeaturesList(false);

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex] as
    | undefined
    | ExperimentPhaseStringDates;
  const phase = phases[phaseIndex || 0] as
    | undefined
    | ExperimentPhaseStringDates;
  const startDate = phases?.[0]?.dateStarted
    ? date(phases[0].dateStarted)
    : null;
  const endDate =
    phases.length > 0
      ? lastPhase?.dateEnded
        ? date(lastPhase.dateEnded ?? "")
        : "now"
      : null;
  const hasNamespace = lastPhase?.namespace && lastPhase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? lastPhase.namespace.range[1] - lastPhase.namespace.range[0]
    : 1;

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const environments = useEnvironments();

  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);
  const [featureModal, setFeatureModal] = useState(false);

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);
  const orgSettings = useOrgSettings();
  const {
    organization,
    users,
    getUserDisplay,
    hasCommercialFeature,
  } = useUser();

  const { data: sdkConnectionsData } = useSDKConnections();

  const projectId = experiment.project;
  const project = getProjectById(experiment.project || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const ownerName = getUserDisplay(experiment.owner, false) || "";

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

  const linkedFeatures: {
    feature: FeatureInterface;
    rules: MatchingRule[];
  }[] = [];
  const environmentIds = environments.map((e) => e.id);
  features.forEach((feature) => {
    const rules = getMatchingRules(
      feature,
      (rule) =>
        (rule.type === "experiment" &&
          experiment.trackingKey === (rule.trackingKey || feature.id)) ||
        (rule.type === "experiment-ref" && rule.experimentId === experiment.id),
      environmentIds
    );

    if (rules.length > 0) {
      linkedFeatures.push({ feature, rules });
    }
  });

  const numLinkedChanges = visualChangesets.length + linkedFeatures.length;

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u?.name || u?.email);

  const experimentHasPhases = phases.length > 0;

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
          onCreate={async (vc) => {
            // Try to immediately open the visual editor
            await openVisualEditor(vc);
          }}
        />
      )}
      {statusModal && (
        <EditStatusModal
          experiment={experiment}
          close={() => setStatusModal(false)}
          mutate={mutate}
        />
      )}
      {featureModal && (
        <FeatureFromExperimentModal
          features={features}
          experiment={experiment}
          close={() => setFeatureModal(false)}
          onSuccess={async () => {
            await mutateFeatures();
          }}
        />
      )}
      <div className="row align-items-center mb-1">
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

      <div className="mb-4">
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
          <div className="col-auto pr-3 ml-2">
            Tags:{" "}
            {experiment.tags?.length > 0 ? (
              <span className="d-inline-block" style={{ maxWidth: 250 }}>
                <SortedTags tags={experiment.tags} skipFirstMargin={true} />
              </span>
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
          <div className="col-auto pr-3 ml-2">
            Owner:{" "}
            {ownerName ? (
              <strong>{ownerName}</strong>
            ) : (
              <em className="text-muted">None</em>
            )}{" "}
          </div>
          {numLinkedChanges > 0 ? (
            <div
              className="col-auto ml-5 pr-3 d-flex flex-column"
              style={{ height: 42, justifyContent: "space-between" }}
            >
              <div>Linked changes</div>
              <div style={{ marginLeft: 4 }}>
                {linkedFeatures.length === 1 && numLinkedChanges === 1 ? (
                  <Link href={`/features/${linkedFeatures[0].feature.id}`}>
                    <a>
                      <BsFlag /> {linkedFeatures[0].feature.id}
                    </a>
                  </Link>
                ) : (
                  <>
                    {linkedFeatures.length > 0 ? (
                      <>
                        <Tooltip
                          body={
                            <div className="d-flex align-items-center">
                              <span className="small text-uppercase mr-2">
                                Feature Flags:
                              </span>{" "}
                              {linkedFeatures.length} change
                              {linkedFeatures.length === 1 ? "" : "s"}
                            </div>
                          }
                        >
                          <div className="d-inline-block">
                            <BsFlag style={{ marginLeft: 2 }} />{" "}
                            <span className="">{linkedFeatures.length}</span>
                          </div>
                        </Tooltip>
                        {visualChangesets.length > 0 ? ", " : null}
                      </>
                    ) : null}
                    {visualChangesets.length > 0 ? (
                      <Tooltip
                        body={
                          <div className="d-flex align-items-center">
                            <span className="small text-uppercase mr-2">
                              Visual Editor:
                            </span>{" "}
                            {visualChangesets.length} change
                            {visualChangesets.length === 1 ? "" : "s"}
                          </div>
                        }
                      >
                        <div className="d-inline-block">
                          <RxDesktop style={{ marginLeft: 2 }} />{" "}
                          <span className="">{visualChangesets.length}</span>
                        </div>
                      </Tooltip>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}
          <div
            className="col-auto ml-5 pr-3 d-flex flex-column"
            style={{ height: 42, justifyContent: "space-between" }}
          >
            <div>Experiment key</div>
            <ClickToCopy compact={true}>{experiment.trackingKey}</ClickToCopy>
          </div>

          <div className="flex-1 col"></div>

          <div className="col-auto pr-2">
            <div className="mt-1 small text-gray">
              {startDate && (
                <>
                  {startDate}
                  {endDate && <> — {endDate}</>}
                </>
              )}
            </div>
          </div>

          <div className="col-auto">
            <div className="experiment-status-widget border d-flex mt-1">
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
                  <ResultsIndicator results={experiment.results} newUi={true} />
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
                    project: currentProject,
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
      </div>

      {experiment.status === "stopped" &&
        includeExperimentInPayload(experiment) && (
          <div className="alert alert-warning mb-3">
            <div className="d-flex align-items-center">
              <div>
                <FaClock /> <strong>Temporary Rollout Enabled</strong>
                <div className="my-1">
                  This experiment has been stopped, but visual changes are still
                  being applied to give you time to implement them in code.
                </div>
                When you no longer need this rollout, stop it to improve your
                site performance.{" "}
                <DocLink docSection="temporaryRollout">Learn more</DocLink>
              </div>
              <div className="ml-auto pl-2">
                <Button
                  color="primary"
                  onClick={async () => {
                    await apiCall(`/experiment/${experiment.id}`, {
                      method: "POST",
                      body: JSON.stringify({
                        excludeFromPayload: true,
                      }),
                    });
                    mutate();
                  }}
                >
                  Stop Temporary Rollout
                </Button>
              </div>
            </div>
          </div>
        )}

      <AddLinkedChangesBanner
        experiment={experiment}
        setFeatureModal={setFeatureModal}
        setVisualEditorModal={setVisualEditorModal}
        numLinkedChanges={numLinkedChanges}
      />

      <div className="mb-4 pt-3 appbox">
        <Collapsible
          trigger={
            <div className="h3 px-3 pb-2">
              <FaAngleRight className="chevron" /> Meta Information
            </div>
          }
          open={metaInfoOpen}
          onTriggerOpening={() => setMetaInfoOpen(true)}
          onTriggerClosing={() => setMetaInfoOpen(false)}
          transitionTime={150}
        >
          <div className="mx-4 mb-3 pt-3 border-top">
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
              label="description"
              header="Description"
              headerClassName="h4"
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
              headerClassName="h4"
              className="mb-3"
              containerClassName="mb-1"
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

          <div className="mx-4 mb-4">
            <div className="h3 mb-2">
              Targeting
              {editPhase && newPhase ? (
                <a
                  role="button"
                  className="ml-1"
                  onClick={(e) => {
                    e.preventDefault();
                    phase ? editPhase(lastPhaseIndex) : newPhase();
                  }}
                >
                  <GBEdit />
                </a>
              ) : null}
            </div>
            {phase ? (
              <div className="appbox px-3 py-2">
                {lastPhase?.coverage !== undefined ? (
                  <div className="my-2">
                    <span className="font-weight-bold">Traffic coverage:</span>{" "}
                    {Math.floor(lastPhase.coverage * 100)}%
                  </div>
                ) : null}
                {lastPhase?.condition && lastPhase.condition !== "{}" ? (
                  <div className="my-2">
                    <div className="font-weight-bold">Conditions:</div>
                    <ConditionDisplay condition={lastPhase.condition} />
                  </div>
                ) : (
                  <div className="my-2 text-muted">No targeting conditions</div>
                )}
                {hasNamespace ? (
                  <div className="my-2">
                    <span className="font-weight-bold">Namespace:</span>{" "}
                    {lastPhase.namespace.name} (
                    {percentFormatter.format(namespaceRange)})
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="">
                <p className="alert alert-info mb-1">
                  No targeting or traffic allocation set.
                  {newPhase && (
                    <a
                      role="button"
                      className="text-link ml-2"
                      onClick={newPhase}
                    >
                      Edit targeting
                    </a>
                  )}
                </p>
              </div>
            )}
          </div>

          <HeaderWithEdit
            edit={editVariations ?? undefined}
            className="h3 mt-1 mb-2"
            containerClassName="mx-4 mb-1"
          >
            Variations
          </HeaderWithEdit>
          <div className="mx-1 mb-3">
            <VariationsTable
              experiment={experiment}
              visualChangesets={visualChangesets}
              mutate={mutate}
              canEditExperiment={canEditExperiment}
              canEditVisualChangesets={hasVisualEditorPermission}
              setVisualEditorModal={setVisualEditorModal}
              setFeatureModal={setFeatureModal}
              newUi={true}
            />
          </div>

          <div className="mx-4 pb-3">
            <div className="h3 mb-2">
              <Tooltip
                body={
                  <span style={{ lineHeight: 1.5 }}>
                    Linked changes are feature flag or visual editor changes
                    associated with this experiment which are managed within the
                    GrowthBook app.
                  </span>
                }
              >
                Linked Changes{" "}
                <FaQuestionCircle style={{ fontSize: "0.8rem" }} />{" "}
                <small className="text-muted">({numLinkedChanges})</small>
              </Tooltip>
            </div>
            {numLinkedChanges === 0 && experiment.status !== "draft" ? (
              <>
                This experiment has no feature flag or visual editor changes
                which are managed within the GrowthBook app. Changes are likely
                implemented manually.
              </>
            ) : (
              <>
                {linkedFeatures.map(({ feature, rules }, i) => (
                  <LinkedFeatureFlag
                    feature={feature}
                    rules={rules}
                    experiment={experiment}
                    key={i}
                  />
                ))}
                <VisualChangesetTable
                  experiment={experiment}
                  visualChangesets={visualChangesets}
                  mutate={mutate}
                  canEditVisualChangesets={hasVisualEditorPermission}
                  setVisualEditorModal={setVisualEditorModal}
                  setFeatureModal={setFeatureModal}
                  newUi={true}
                />
              </>
            )}
          </div>
        </Collapsible>
      </div>

      <StartExperimentBanner
        experiment={experiment}
        connections={sdkConnectionsData?.connections || []}
        linkedFeatures={linkedFeatures}
        visualChangesets={visualChangesets}
        mutateExperiment={mutate}
        editPhase={editPhase}
        newPhase={newPhase}
      />

      {experiment.status === "running" &&
        !experiment.datasource &&
        !experiment.id.match(/^exp_sample/) && (
          <div className="alert-cool-1 mb-5 text-center px-3 py-4">
            <p className="h4">Use GrowthBook for Analysis</p>
            {datasources.length > 0 ? (
              <>
                <p>
                  Select a Data Source and metrics so GrowthBook can analyze the
                  experiment results.
                </p>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setReportSettingsOpen(true);
                  }}
                >
                  Select Data Source
                </button>
              </>
            ) : (
              <>
                <p>
                  Connect GrowthBook to your data and use our powerful metrics
                  and stats engine to automatically analyze your experiment
                  results.
                </p>
                <Link href="/datasources">
                  <a className="btn btn-primary">Connect to your Data</a>
                </Link>
              </>
            )}
          </div>
        )}

      <ControlledTabs
        newStyle={true}
        className="mt-3 mb-4"
        buttonsClassName="px-5"
        tabContentsClassName={clsx(
          "px-3 pt-3",
          resultsTab === "results" && (phases.length || 0) === 0
            ? "alert-cool-1 py-3 noborder"
            : "border"
        )}
        setActive={(tab: ResultsTab) => setResultsTab(tab ?? "results")}
        active={resultsTab}
      >
        <Tab id="results" display="Results" padding={false}>
          <div className="mb-2" style={{ overflowX: "initial" }}>
            {!experimentHasPhases ? (
              <div className="alert alert-info">
                You don&apos;t have any experiment phases yet.{" "}
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => newPhase && newPhase()}
                >
                  Add Experiment Phase
                </button>
              </div>
            ) : experiment.status !== "draft" ? (
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
              <StatusBanner
                mutateExperiment={mutate}
                editResult={editResult ?? undefined}
              />
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
                <RightRailSectionGroup title="Hashing Algorithm" type="custom">
                  <Tooltip
                    body={`V2 fixes some potential bias issues, but is only supported in newer SDK versions`}
                  >
                    <strong>
                      {experiment.hashVersion === 2
                        ? "V2 - Unbiased"
                        : experiment.hashVersion === 1
                        ? "V1 - Legacy"
                        : `V${experiment.hashVersion} - Unknown`}
                    </strong>{" "}
                    <FaQuestionCircle />
                  </Tooltip>
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
                      language={datasource?.properties?.queryLanguage ?? "none"}
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
                          Conversion {ignoreConversionEnd ? "Delay" : "Window"}
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
              open={editPhases ?? undefined}
              canOpen={!!editPhases}
            >
              <div className="appbox mb-0">
                {phases.length > 0 ? (
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

      {experiment.status !== "draft" && experimentHasPhases ? (
        <div className="mb-4 pt-3 appbox">
          <Collapsible
            trigger={
              <div className="row mx-2 pb-3 d-flex align-items-center">
                <div className="col h3 mb-0">
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
                      <GBAddCircle className="pr-1" />
                      Custom Report
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
            <ExperimentReportsList experiment={experiment} newUi={true} />
          </Collapsible>
        </div>
      ) : null}

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
