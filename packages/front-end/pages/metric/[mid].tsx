import { useRouter } from "next/router";
import React, {
  FC,
  useState,
  useEffect,
  Fragment,
  ReactNode,
  ReactElement,
} from "react";
import Link from "next/link";
import { FaQuestionCircle, FaTimes } from "react-icons/fa";
import { MetricInterface } from "shared/types/metric";
import { useForm } from "react-hook-form";
import { BsGear } from "react-icons/bs";
import { IdeaInterface } from "shared/types/idea";
import { date } from "shared/dates";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { Box, Flex } from "@radix-ui/themes";
import { isBinomialMetric } from "shared/experiments";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import DiscussionThread from "@/components/DiscussionThread";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingOverlay from "@/components/LoadingOverlay";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { getMetricFormatter } from "@/services/metrics";
import MetricForm, { usesValueColumn } from "@/components/Metrics/MetricForm";
import { TabsList, Tabs, TabsContent, TabsTrigger } from "@/ui/Tabs";
import HistoryTable from "@/components/HistoryTable";
import DateGraph from "@/components/Metrics/DateGraph";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import RightRailSection from "@/components/Layout/RightRailSection";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import PickSegmentModal from "@/components/Segments/PickSegmentModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/components/Button";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import ProjectBadges from "@/components/ProjectBadges";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import { GBCuped, GBEdit } from "@/components/Icons";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useCurrency } from "@/hooks/useCurrency";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricPriorRightRailSectionGroup from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import { MetricModal } from "@/components/FactTables/NewMetricModal";

const MetricPage: FC = () => {
  const router = useRouter();
  const { mid } = router.query;
  const permissionsUtil = usePermissionsUtil();
  const displayCurrency = useCurrency();
  const { apiCall } = useAuth();
  const {
    mutateDefinitions,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    metrics,
    segments,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { organization } = useUser();

  const [editModalOpen, setEditModalOpen] = useState<boolean | number>(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState<boolean>(false);
  const [editTags, setEditTags] = useState(false);
  const [editProjects, setEditProjects] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const storageKeyAvg = `metric_smoothBy_avg`; // to make metric-specific, include `${mid}`
  const storageKeySum = `metric_smoothBy_sum`;
  const [smoothByAvg, setSmoothByAvg] = useLocalStorage<"day" | "week">(
    storageKeyAvg,
    "day",
  );
  const [smoothBySum, setSmoothBySum] = useLocalStorage<"day" | "week">(
    storageKeySum,
    "day",
  );

  const [hoverDate, setHoverDate] = useState<number | null>(null);
  const onHoverCallback = (ret: { d: number | null }) => {
    setHoverDate(ret.d);
  };

  const { data, error, mutate } = useApi<{
    metric: MetricInterface;
  }>(`/metric/${mid}`);

  const {
    metricDefaults,
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    getTargetMDEForMetric,
  } = useOrganizationMetricDefaults();

  const form = useForm<{ name: string; description: string }>();

  useEffect(() => {
    if (data?.metric) {
      form.setValue("name", data.metric.name || "");
      form.setValue("description", data.metric.description || "");
    }
  }, [data]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const metric = data.metric;
  const canDuplicateMetric = permissionsUtil.canCreateMetric({
    // Don't pass in managedBy as we allow non-admins to duplicate official metrics - the duplicated metric will be non-official
    projects: metric.projects,
  });
  let canEditMetric = permissionsUtil.canUpdateMetric(metric, {});
  let canDeleteMetric = permissionsUtil.canDeleteMetric(metric);

  // Additional check if managed by api or config
  if (metric.managedBy && ["api", "config"].includes(metric.managedBy)) {
    canEditMetric = false;
    canDeleteMetric = false;
  }
  const datasource = metric.datasource
    ? getDatasourceById(metric.datasource)
    : null;
  const canRunMetricQuery =
    datasource && permissionsUtil.canRunMetricQueries(datasource);

  let analysis = data.metric.analysis || null;
  if (!analysis || !("average" in analysis)) {
    analysis = null;
  }

  const segment = getSegmentById(metric.segment || "");

  const supportsSQL = datasource?.properties?.queryLanguage === "sql";
  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  const { status } = getQueryStatus(metric.queries || [], metric.analysisError);
  const hasQueries = metric.queries?.length > 0;

  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;
  const denominator = metric.denominator
    ? metrics.find((m) => m.id === metric.denominator)
    : undefined;
  if (denominator && !isBinomialMetric(denominator)) {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>
        Not available for non-fact ratio metrics with{" "}
        <em>{denominator.type}</em> denominators.
      </>
    );
  }
  if (metric.aggregation) {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>Not available for metrics with custom aggregations.</>
    );
  }

  const variables = {
    metricName: metric.name,
    tags: metric.tags || [],
    metricType: metric.type,
    metricDatasource: datasource?.name || "",
  };

  const getMetricUsage = (metric: MetricInterface) => {
    return async (): Promise<ReactElement | null> => {
      try {
        const res = await apiCall<{
          status: number;
          ideas?: IdeaInterface[];
          experiments?: { name: string; id: string }[];
        }>(`/metric/${metric.id}/usage`, {
          method: "GET",
        });

        const experimentLinks: (string | ReactNode)[] = [];
        const ideaLinks: (string | ReactNode)[] = [];
        let subtitleText = "This metric is not referenced anywhere else.";
        if (res.ideas?.length || res.experiments?.length) {
          subtitleText = "This metric is referenced in ";
          const refs: (string | ReactNode)[] = [];
          if (res.experiments && res.experiments.length) {
            refs.push(
              res.experiments.length === 1
                ? "1 experiment"
                : res.experiments.length + " experiments",
            );
            res.experiments.forEach((e) => {
              experimentLinks.push(
                <Link href={`/experiment/${e.id}`}>{e.name}</Link>,
              );
            });
          }
          if (res.ideas && res.ideas.length) {
            refs.push(
              res.ideas.length === 1 ? "1 idea" : res.ideas.length + " ideas",
            );
            res.ideas.forEach((i) => {
              ideaLinks.push(<Link href={`/idea/${i.id}`}>{i.text}</Link>);
            });
          }
          subtitleText += refs.join(" and ");

          return (
            <div>
              <p>{subtitleText}</p>
              {(experimentLinks.length > 0 || ideaLinks.length > 0) && (
                <>
                  <div
                    className="row mx-1 mb-2 mt-1 py-2"
                    style={{ fontSize: "0.8rem" }}
                  >
                    {experimentLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        Experiments:{" "}
                        <ul className="mb-0 pl-3">
                          {experimentLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li>{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {ideaLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        Ideas:{" "}
                        <ul className="mb-0 pl-3">
                          {ideaLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li>{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                  <p className="mb-0">
                    Deleting this metric will remove these references.
                  </p>
                </>
              )}
              <p>This delete action cannot be undone. </p>
              <p>
                If you would rather keep existing references, but prevent this
                metric from being used in the future, you can archive this
                metric instead.
              </p>
            </div>
          );
        }
      } catch (e) {
        console.error(e);
        return (
          <div className="alert alert-danger">
            An error occurred getting the metric usage
          </div>
        );
      }
      return null;
    };
  };

  return (
    <div className="container-fluid pagecontents">
      {editModalOpen !== false && (
        <MetricForm
          current={metric}
          edit={true}
          source="metrics-detail"
          initialStep={editModalOpen !== true ? editModalOpen : 0}
          onClose={() => {
            setEditModalOpen(false);
          }}
          onSuccess={() => {
            mutate();
          }}
        />
      )}
      {duplicateModalOpen && (
        <MetricModal
          mode="duplicate"
          currentMetric={{
            ...metric,
            name: metric.name + " (copy)",
            // If managedBy is admin, only copy that over if the user has the ManageOfficialResources policy
            managedBy: "",
          }}
          close={() => setDuplicateModalOpen(false)}
          source="metrics-detail"
        />
      )}
      {editTags && (
        <EditTagsForm
          cancel={() => setEditTags(false)}
          mutate={mutate}
          tags={metric.tags || []}
          save={async (tags) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                tags,
              }),
            });
          }}
          source="mid"
        />
      )}
      {editProjects && (
        <EditProjectsForm
          label={
            <>
              Projects{" "}
              <Tooltip
                body={
                  "The dropdown below has been filtered to only include projects where you have permission to update Metrics"
                }
              />
            </>
          }
          cancel={() => setEditProjects(false)}
          entityName="Metric"
          mutate={mutate}
          value={metric.projects || []}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateMetric({ projects: [project] }, {})
          }
          save={async (projects) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
            mutateDefinitions({});
          }}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          resourceType="metric"
          cancel={() => setEditOwnerModal(false)}
          owner={metric.owner}
          save={async (owner) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
          }}
          mutate={mutate}
        />
      )}
      {segmentOpen && (
        <PickSegmentModal
          close={() => setSegmentOpen(false)}
          datasource={metric.datasource || ""}
          save={async (s) => {
            // Update the segment
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                segment: s || "",
              }),
            });
            // Run the analysis with the new segment
            await apiCall(`/metric/${metric.id}/analysis`, {
              method: "POST",
            });
            mutateDefinitions({});
            mutate();
          }}
          segment={metric.segment || ""}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: metric.name },
        ]}
      />

      {metric.status === "archived" && (
        <div className="alert alert-secondary mb-2">
          <strong>This metric is archived.</strong> Existing references will
          continue working, but you will be unable to add this metric to new
          experiments.
        </div>
      )}

      {metric.projects?.includes(
        getDemoDatasourceProjectIdForOrganization(organization.id),
      ) && (
        <div className="alert alert-info mb-3 d-flex align-items-center mt-3">
          <div className="flex-1">
            This metric is part of our sample dataset. You can safely delete
            this once you are done exploring.
          </div>
          <div style={{ width: 180 }} className="ml-2">
            <DeleteDemoDatasourceButton
              onDelete={() => router.push("/metrics")}
              source="metric"
            />
          </div>
        </div>
      )}

      <div className="row align-items-center mb-2">
        <h1 className="col-auto">
          <MetricName id={metric.id} />
        </h1>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <MoreMenu>
            {canEditMetric ? (
              <Button
                className="btn dropdown-item py-2"
                color=""
                onClick={() => setEditModalOpen(true)}
              >
                Edit metric
              </Button>
            ) : null}
            {canDuplicateMetric ? (
              <Button
                className="btn dropdown-item py-2"
                color=""
                onClick={() => setDuplicateModalOpen(true)}
              >
                Duplicate metric
              </Button>
            ) : null}
            {canDeleteMetric ? (
              <DeleteButton
                className="btn dropdown-item py-2"
                text="Delete"
                title="Delete this metric"
                getConfirmationContent={getMetricUsage(metric)}
                onClick={async () => {
                  await apiCall(`/metric/${metric.id}`, {
                    method: "DELETE",
                  });
                  mutateDefinitions({});
                  router.push("/metrics");
                }}
                useIcon={false}
                displayName={"Metric '" + metric.name + "'"}
              />
            ) : null}
            {canEditMetric ? (
              <Button
                className="btn dropdown-item py-2"
                color=""
                onClick={async () => {
                  const newStatus =
                    metric.status === "archived" ? "active" : "archived";
                  await apiCall(`/metric/${metric.id}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      status: newStatus,
                    }),
                  });
                  mutateDefinitions({});
                  mutate();
                }}
              >
                {metric.status === "archived" ? "Unarchive" : "Archive"}
              </Button>
            ) : null}
          </MoreMenu>
        </div>
      </div>
      <div className="row mb-3 align-items-center">
        <div className="col">
          Projects:{" "}
          {metric?.projects?.length ? (
            <ProjectBadges resourceType="metric" projectIds={metric.projects} />
          ) : (
            <ProjectBadges resourceType="metric" />
          )}
          {canEditMetric && (
            <a
              href="#"
              className="ml-2"
              onClick={(e) => {
                e.preventDefault();
                setEditProjects(true);
              }}
            >
              <GBEdit />
            </a>
          )}
        </div>
      </div>

      <div className="mt-3">
        <CustomMarkdown page={"metric"} variables={variables} />
      </div>

      <div className="row">
        <div className="col-12 col-md-8">
          <Tabs defaultValue="info" persistInURL={true}>
            <TabsList>
              <TabsTrigger value="info">Info</TabsTrigger>
              <TabsTrigger value="experiments">Experiments</TabsTrigger>
              <TabsTrigger value="discussion">Discussion</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <Box pt="4">
              <TabsContent value="info">
                <Box className="appbox px-4 py-3 mb-5">
                  <div className="row">
                    <div className="col-12">
                      <MarkdownInlineEdit
                        header="Description"
                        save={async (description) => {
                          await apiCall(`/metric/${metric.id}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              description,
                            }),
                          });
                          await mutate();
                          mutateDefinitions({});
                        }}
                        aiSuggestFunction={async () => {
                          const res = await apiCall<{
                            status: number;
                            data: {
                              description: string;
                            };
                          }>(
                            `/metrics/${metric.id}/gen-description`,
                            {
                              method: "GET",
                            },
                            (responseData) => {
                              if (responseData.status === 429) {
                                const retryAfter = parseInt(
                                  responseData.retryAfter,
                                );
                                const hours = Math.floor(retryAfter / 3600);
                                const minutes = Math.floor(
                                  (retryAfter % 3600) / 60,
                                );
                                throw new Error(
                                  `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`,
                                );
                              } else {
                                throw new Error("Error getting AI suggestion");
                              }
                            },
                          );
                          if (res?.status !== 200) {
                            throw new Error("Could not load AI suggestions");
                          }
                          return res.data.description;
                        }}
                        aiButtonText="Suggest Description"
                        aiSuggestionHeader="Suggested Description"
                        emptyHelperText="Add a description to keep your team informed about how to apply this metric."
                        value={metric.description}
                        canCreate={canEditMetric}
                        canEdit={canEditMetric}
                        label="Description"
                      />
                    </div>
                  </div>
                </Box>
                {!!datasource && (
                  <div className="appbox px-4 py-3 mb-5">
                    <div className="row mb-1 align-items-center">
                      <div className="col-auto">
                        <h3 className="d-inline-block mb-0">Data Preview</h3>
                      </div>
                      <div className="small col-auto">
                        {segments.length > 0 && (
                          <>
                            {segment?.name ? (
                              <>
                                Segment applied:{" "}
                                <span className="badge badge-primary mr-1">
                                  {segment?.name || "Everyone"}
                                </span>
                              </>
                            ) : (
                              <span className="mr-1">Apply a segment</span>
                            )}
                            {canEditMetric && canRunMetricQuery && (
                              <a
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSegmentOpen(true);
                                }}
                                href="#"
                              >
                                <BsGear />
                              </a>
                            )}
                          </>
                        )}
                      </div>
                      <div style={{ flex: 1 }} />
                      <div className="col-auto">
                        {canRunMetricQuery && (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              try {
                                await apiCall(`/metric/${metric.id}/analysis`, {
                                  method: "POST",
                                });
                                mutate();
                              } catch (e) {
                                console.error(e);
                              }
                            }}
                          >
                            <RunQueriesButton
                              icon="refresh"
                              cta={analysis ? "Refresh Data" : "Run Analysis"}
                              mutate={mutate}
                              model={metric}
                              cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                              color="outline-primary"
                            />
                          </form>
                        )}
                      </div>
                    </div>
                    <div className="row flex justify-content-between">
                      <div className="small text-muted col">
                        {denominator && (
                          <>
                            The data below only aggregates the numerator. The
                            denominator ({denominator.name}) is only used in
                            experiment analyses.
                          </>
                        )}
                      </div>
                      {analysis && (
                        <div className="small text-muted col-auto">
                          Last updated on {date(analysis?.createdAt)}
                        </div>
                      )}
                    </div>
                    {hasQueries && status === "failed" && (
                      <div className="alert alert-danger my-3">
                        Error running the analysis.{" "}
                        <ViewAsyncQueriesButton
                          queries={metric.queries.map((q) => q.query)}
                          error={metric.analysisError}
                          ctaComponent={(onClick) => (
                            <a
                              className="alert-link"
                              href="#"
                              onClick={onClick}
                            >
                              View Queries
                            </a>
                          )}
                        />{" "}
                        for more info
                      </div>
                    )}
                    {hasQueries && status === "running" && (
                      <div className="alert alert-info">
                        Your analysis is currently running.{" "}
                        {analysis && "The data below is from the previous run."}
                      </div>
                    )}
                    {analysis &&
                      status === "succeeded" &&
                      (metric.segment || analysis.segment) &&
                      metric.segment !== analysis.segment && (
                        <div className="alert alert-info">
                          The graphs below are using an old Segment. Update them
                          to see the latest numbers.
                        </div>
                      )}
                    {analysis && (
                      <div className="mb-4">
                        {metric.type !== "binomial" && (
                          <div className="d-flex flex-row align-items-end">
                            <div style={{ fontSize: "2.5em" }}>
                              {getMetricFormatter(metric.type)(
                                analysis.average,
                                {
                                  currency: displayCurrency,
                                },
                              )}
                            </div>
                            <div className="pb-2 ml-1">average</div>
                          </div>
                        )}
                      </div>
                    )}
                    {analysis?.dates && analysis.dates.length > 0 && (
                      <div className="mb-4">
                        <div className="row mt-3">
                          <div className="col-auto">
                            <h5 className="mb-1 mt-1">
                              {metric.type === "binomial"
                                ? "Conversions"
                                : "Metric Value"}{" "}
                              Over Time
                            </h5>
                          </div>
                        </div>

                        {metric.type !== "binomial" && (
                          <>
                            <div className="row mt-4 mb-1">
                              <div className="col">
                                <Tooltip
                                  body={
                                    <>
                                      <p>
                                        This figure shows the average metric
                                        value on a day divided by number of
                                        unique units (e.g. users) in the metric
                                        source on that day.
                                      </p>
                                      <p>
                                        The standard deviation shows the spread
                                        of the daily user metric values.
                                      </p>
                                      <p>
                                        When smoothing is turned on, we simply
                                        average values and standard deviations
                                        over the 7 trailing days (including the
                                        selected day).
                                      </p>
                                    </>
                                  }
                                >
                                  <strong className="ml-4 align-bottom">
                                    Daily Average <FaQuestionCircle />
                                  </strong>
                                </Tooltip>
                              </div>
                              <div className="col">
                                <div className="float-right mr-2">
                                  <Flex align="center" gap="1">
                                    <Switch
                                      value={smoothByAvg === "week"}
                                      onChange={() =>
                                        setSmoothByAvg(
                                          smoothByAvg === "week"
                                            ? "day"
                                            : "week",
                                        )
                                      }
                                      id="toggle-group-by-avg"
                                    />
                                    <label
                                      className="small my-0 mr-2 text-right align-middle"
                                      htmlFor="toggle-group-by-avg"
                                    >
                                      Smoothing
                                      <br />
                                      (7 day trailing)
                                    </label>
                                  </Flex>
                                </div>
                              </div>
                            </div>
                            <DateGraph
                              type={metric.type}
                              method="avg"
                              dates={analysis.dates}
                              smoothBy={smoothByAvg}
                              onHover={onHoverCallback}
                              hoverDate={hoverDate}
                            />
                          </>
                        )}

                        <div className="row mt-4 mb-1">
                          <div className="col">
                            <Tooltip
                              body={
                                <>
                                  {metric.type !== "binomial" ? (
                                    <>
                                      <p>
                                        This figure shows the daily sum of
                                        values in the metric source on that day.
                                      </p>
                                      <p>
                                        When smoothing is turned on, we simply
                                        average values over the 7 trailing days
                                        (including the selected day).
                                      </p>
                                    </>
                                  ) : (
                                    <>
                                      <p>
                                        This figure shows the total count of
                                        units (e.g. users) in the metric source
                                        on that day.
                                      </p>
                                      <p>
                                        When smoothing is turned on, we simply
                                        average counts over the 7 trailing days
                                        (including the selected day).
                                      </p>
                                    </>
                                  )}
                                </>
                              }
                            >
                              <strong className="ml-4 align-bottom">
                                Daily{" "}
                                {metric.type !== "binomial" ? "Sum" : "Count"}{" "}
                                <FaQuestionCircle />
                              </strong>
                            </Tooltip>
                          </div>
                          <div className="col">
                            <div className="float-right mr-2">
                              <Flex align="center" gap="1">
                                <Switch
                                  value={smoothBySum === "week"}
                                  onChange={() =>
                                    setSmoothBySum(
                                      smoothBySum === "week" ? "day" : "week",
                                    )
                                  }
                                  id="toggle-group-by-sum"
                                />
                                <label
                                  className="small my-0 mr-2 text-right align-middle"
                                  htmlFor="toggle-group-by-sum"
                                >
                                  Smoothing
                                  <br />
                                  (7 day trailing)
                                </label>
                              </Flex>
                            </div>
                          </div>
                        </div>
                        <DateGraph
                          type={metric.type}
                          method="sum"
                          dates={analysis.dates}
                          smoothBy={smoothBySum}
                          onHover={onHoverCallback}
                          hoverDate={hoverDate}
                        />
                      </div>
                    )}

                    {!analysis && (
                      <div>
                        <em>
                          No data for this metric yet.{" "}
                          {canRunMetricQuery
                            ? "Click the Run Analysis button above."
                            : null}
                        </em>
                      </div>
                    )}

                    {hasQueries && (
                      <div className="row my-3">
                        <div className="col-auto">
                          <ViewAsyncQueriesButton
                            queries={metric.queries.map((q) => q.query)}
                            color={status === "failed" ? "danger" : "info"}
                            error={metric.analysisError}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="experiments">
                <Box>
                  <MetricExperiments metric={metric} outerClassName="" />
                </Box>
              </TabsContent>
              <TabsContent value="discussion">
                <Box>
                  <h3>Comments</h3>
                  <DiscussionThread
                    type="metric"
                    id={data.metric.id}
                    projects={metric.projects || []}
                  />
                </Box>
              </TabsContent>
              <TabsContent value="history">
                <HistoryTable type="metric" id={metric.id} />
              </TabsContent>
            </Box>
          </Tabs>
        </div>
        <div className="col-12 col-md-4 mt-md-5">
          <div className="appbox p-3" style={{ marginTop: "7px" }}>
            <RightRailSection
              title="Owner"
              open={() => setEditOwnerModal(true)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup type="custom">
                {metric.owner}
              </RightRailSectionGroup>
            </RightRailSection>

            <hr />
            <RightRailSection
              title="Basic Info"
              open={() => setEditModalOpen(0)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup title="Type" type="commaList">
                {metric.type}
              </RightRailSectionGroup>
              {datasource && (
                <RightRailSectionGroup
                  title="Data Source"
                  type="commaList"
                  titleClassName="align-top"
                >
                  <div className="d-inline-block" style={{ maxWidth: 280 }}>
                    <div>
                      <Link href={`/datasources/${datasource?.id}`}>
                        {datasource.name}
                      </Link>
                    </div>
                    <div className="text-gray font-weight-normal small text-ellipsis">
                      {datasource?.description}
                    </div>
                  </div>
                </RightRailSectionGroup>
              )}
              {datasource?.type === "google_analytics" && (
                <RightRailSectionGroup title="GA Metric" type="commaList">
                  {metric.table}
                </RightRailSectionGroup>
              )}
            </RightRailSection>

            <hr />
            <RightRailSection
              title="Tags"
              open={() => setEditTags(true)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup type="tags">
                {metric.tags}
              </RightRailSectionGroup>
            </RightRailSection>

            <hr />
            <RightRailSection
              title="Projects"
              open={() => setEditProjects(true)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup>
                {metric?.projects?.length ? (
                  <ProjectBadges
                    resourceType="metric"
                    projectIds={metric.projects}
                  />
                ) : (
                  <ProjectBadges resourceType="metric" />
                )}
              </RightRailSectionGroup>
            </RightRailSection>

            {datasource?.properties?.hasSettings && (
              <>
                <hr />
                <RightRailSection
                  title="Query Settings"
                  open={() => setEditModalOpen(1)}
                  canOpen={canEditMetric}
                >
                  {supportsSQL &&
                  metric.queryFormat !== "builder" &&
                  metric.sql ? (
                    <>
                      {metric.userIdTypes && customizeUserIds && (
                        <RightRailSectionGroup
                          title="Identifier Types"
                          type="commaList"
                        >
                          {metric.userIdTypes}
                        </RightRailSectionGroup>
                      )}
                      {metric.templateVariables?.eventName && (
                        <RightRailSectionGroup title="Event Name" type="custom">
                          <span className="font-weight-bold">
                            {metric.templateVariables.eventName}
                          </span>
                        </RightRailSectionGroup>
                      )}
                      {metric.type != "binomial" &&
                        metric.templateVariables?.valueColumn &&
                        usesValueColumn(metric.sql) && (
                          <RightRailSectionGroup
                            title="Value Column"
                            type="custom"
                          >
                            <span className="font-weight-bold">
                              {metric.templateVariables.valueColumn}
                            </span>
                          </RightRailSectionGroup>
                        )}
                      <RightRailSectionGroup title="Metric SQL" type="custom">
                        <Code language="sql" code={metric.sql} />
                      </RightRailSectionGroup>
                      {metric.type !== "binomial" && metric.aggregation && (
                        <RightRailSectionGroup
                          title="User Value Aggregation"
                          type="custom"
                        >
                          <Code language="sql" code={metric.aggregation} />
                        </RightRailSectionGroup>
                      )}
                      <RightRailSectionGroup title="Denominator" type="custom">
                        <strong>
                          {metric.denominator ? (
                            <Link href={`/metric/${metric.denominator}`}>
                              {getMetricById(metric.denominator)?.name ||
                                "Unknown"}
                            </Link>
                          ) : (
                            "All Experiment Users"
                          )}
                        </strong>
                      </RightRailSectionGroup>
                    </>
                  ) : (
                    <>
                      <RightRailSectionGroup
                        title={supportsSQL ? "Table Name" : "Event Name"}
                        type="code"
                      >
                        {metric.table}
                      </RightRailSectionGroup>
                      {metric.conditions && metric.conditions.length > 0 && (
                        <RightRailSectionGroup title="Conditions" type="list">
                          {metric.conditions.map(
                            (c) => `${c.column} ${c.operator} "${c.value}"`,
                          )}
                        </RightRailSectionGroup>
                      )}
                      {metric.type !== "binomial" &&
                        metric.column &&
                        supportsSQL && (
                          <RightRailSectionGroup title="Column" type="code">
                            {metric.column}
                          </RightRailSectionGroup>
                        )}
                      {metric.type !== "binomial" &&
                        metric.column &&
                        !supportsSQL && (
                          <div className="mt-2">
                            <span className="text-muted">
                              Event Value Expression
                            </span>
                            <Code language="javascript" code={metric.column} />
                          </div>
                        )}
                      {metric.type !== "binomial" &&
                        metric.aggregation &&
                        !supportsSQL && (
                          <div className="mt-2">
                            <span className="text-muted">
                              User Value Aggregation:
                            </span>
                            <Code
                              language="javascript"
                              code={metric.aggregation}
                            />
                          </div>
                        )}
                      {customzeTimestamp && (
                        <RightRailSectionGroup
                          title="Timestamp Col"
                          type="code"
                        >
                          {metric.timestampColumn}
                        </RightRailSectionGroup>
                      )}
                      {metric.userIdTypes && customizeUserIds && (
                        <RightRailSectionGroup
                          title="Identifier Columns"
                          type="custom"
                        >
                          <ul>
                            {metric.userIdTypes?.map((type) => (
                              <li key={type}>
                                <strong>{type}</strong>:{" "}
                                {metric.userIdColumns?.[type] || type}
                              </li>
                            ))}
                          </ul>
                        </RightRailSectionGroup>
                      )}
                    </>
                  )}
                </RightRailSection>
              </>
            )}

            <hr />
            <RightRailSection
              title="Behavior"
              open={() => setEditModalOpen(2)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup type="custom" empty="" className="mt-3">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  {metric.inverse && (
                    <li className="mb-2">
                      <span className="text-gray">Goal:</span>{" "}
                      <span className="font-weight-bold">Inverse</span>
                    </li>
                  )}
                  {metric.cappingSettings.type &&
                    metric.cappingSettings.value && (
                      <>
                        <li className="mb-2">
                          <span className="uppercase-title lg">
                            {capitalizeFirstLetter(metric.cappingSettings.type)}
                            {" capping"}
                          </span>
                        </li>
                        <li>
                          <span className="font-weight-bold">
                            {metric.cappingSettings.value}
                          </span>{" "}
                          {metric.cappingSettings.type === "percentile" ? (
                            <span className="text-gray">{`(${
                              100 * metric.cappingSettings.value
                            } pctile${
                              metric.cappingSettings.ignoreZeros
                                ? ", ignoring zeros"
                                : ""
                            })`}</span>
                          ) : (
                            ""
                          )}{" "}
                        </li>
                      </>
                    )}
                  {metric.ignoreNulls && (
                    <li className="mb-2">
                      <span className="text-gray">Converted users only:</span>{" "}
                      <span className="font-weight-bold">Yes</span>
                    </li>
                  )}
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">Metric Window</span>
                  </li>
                  {metric.windowSettings.type === "conversion" ? (
                    <>
                      <li>
                        <span className="font-weight-bold">
                          Conversion Window
                        </span>
                      </li>
                      <li>
                        <span className="text-gray">
                          {`Require conversions to happen within `}
                        </span>
                        <strong>
                          {metric.windowSettings.windowValue}{" "}
                          {metric.windowSettings.windowUnit}
                        </strong>
                        <span className="text-gray">{` 
                        of first experiment exposure
                        ${
                          metric.windowSettings.delayValue
                            ? " plus the metric delay"
                            : ""
                        }`}</span>
                      </li>
                    </>
                  ) : metric.windowSettings.type === "lookback" ? (
                    <>
                      <li>
                        <span className="font-weight-bold">
                          Lookback Window
                        </span>
                      </li>
                      <li>
                        <span className="text-gray">{`Require metric data to be in latest `}</span>
                        <strong>
                          {metric.windowSettings.windowValue}{" "}
                          {metric.windowSettings.windowUnit}
                        </strong>
                        <span className="text-gray"> of the experiment</span>
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <span className="font-weight-bold">Disabled</span>
                      </li>
                      <li>
                        <span className="text-gray">{`Include all metric data after first experiment exposure
                      ${
                        metric.windowSettings.delayValue
                          ? " plus the metric delay"
                          : ""
                      }`}</span>
                      </li>
                    </>
                  )}
                  {metric.windowSettings.delayValue ? (
                    <>
                      <li className="mt-3 mb-1">
                        <span className="uppercase-title lg">Metric Delay</span>
                      </li>
                      <li className="mt-1">
                        <span className="font-weight-bold">
                          {`${metric.windowSettings.delayValue} ${metric.windowSettings.delayUnit}`}
                        </span>
                      </li>
                    </>
                  ) : null}
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">
                      Experiment Decision Framework
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Target MDE:</span>{" "}
                    <span className="font-weight-bold">
                      {getTargetMDEForMetric(metric) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">
                      Display Thresholds
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Minimum metric total:</span>{" "}
                    <span className="font-weight-bold">
                      {getMetricFormatter(metric.type)(
                        getMinSampleSizeForMetric(metric),
                        {
                          currency: displayCurrency,
                        },
                      )}
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Max percent change:</span>{" "}
                    <span className="font-weight-bold">
                      {getMaxPercentageChangeForMetric(metric) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Min percent change:</span>{" "}
                    <span className="font-weight-bold">
                      {getMinPercentageChangeForMetric(metric) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-2">
                    <span className="uppercase-title lg">Risk Thresholds</span>
                    <small className="d-block mb-1 text-muted">
                      Only applicable to Bayesian analyses
                    </small>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Acceptable risk &lt;</span>{" "}
                    <span className="font-weight-bold">
                      {(metric.winRisk || DEFAULT_WIN_RISK_THRESHOLD) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Unacceptable risk &gt;</span>{" "}
                    <span className="font-weight-bold">
                      {(metric.loseRisk || DEFAULT_LOSE_RISK_THRESHOLD) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <MetricPriorRightRailSectionGroup
                metric={metric}
                metricDefaults={metricDefaults}
              />

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-2">
                  <li className="mt-3 mb-2">
                    <span className="uppercase-title lg">
                      <GBCuped size={14} /> Regression Adjustment (CUPED)
                    </span>
                  </li>
                  {!regressionAdjustmentAvailableForMetric ? (
                    <li className="mb-2">
                      <div className="text-muted small">
                        <FaTimes className="text-danger" />{" "}
                        {regressionAdjustmentAvailableForMetricReason}
                      </div>
                    </li>
                  ) : metric?.regressionAdjustmentOverride ? (
                    <>
                      <li className="mb-2">
                        <span className="text-gray">
                          Apply regression adjustment:
                        </span>{" "}
                        <span className="font-weight-bold">
                          {metric?.regressionAdjustmentEnabled ? "On" : "Off"}
                        </span>
                      </li>
                      <li className="mb-2">
                        <span className="text-gray">
                          Lookback period (days):
                        </span>{" "}
                        <span className="font-weight-bold">
                          {metric?.regressionAdjustmentDays}
                        </span>
                      </li>
                    </>
                  ) : settings.regressionAdjustmentEnabled ? (
                    <>
                      <li className="mb-1">
                        <div className="mb-1">
                          <em className="text-gray">
                            Using organization defaults
                          </em>
                        </div>
                        <div className="ml-2 px-2 border-left">
                          <div className="mb-1 small">
                            <span className="text-gray">
                              Apply regression adjustment:
                            </span>{" "}
                            <span className="font-weight-bold">
                              {settings?.regressionAdjustmentEnabled
                                ? "On"
                                : "Off"}
                            </span>
                          </div>
                          <div className="mb-1 small">
                            <span className="text-gray">
                              Lookback period (days):
                            </span>{" "}
                            <span className="font-weight-bold">
                              {settings?.regressionAdjustmentDays}
                            </span>
                          </div>
                        </div>
                      </li>
                    </>
                  ) : (
                    <li className="mb-2">
                      <div className="mb-1">
                        <em className="text-gray">Disabled</em>
                      </div>
                    </li>
                  )}
                </ul>
              </RightRailSectionGroup>
            </RightRailSection>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetricPage;
