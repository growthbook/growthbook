import { useRouter } from "next/router";
import React, { FC, useState, useEffect, Fragment } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Link from "next/link";
import { FaAngleLeft, FaChevronRight } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useForm } from "react-hook-form";
import { BsGear } from "react-icons/bs";
import clsx from "clsx";
import { IdeaInterface } from "back-end/types/idea";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import DiscussionThread from "@/components/DiscussionThread";
import useSwitchOrg from "@/services/useSwitchOrg";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingOverlay from "@/components/LoadingOverlay";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import {
  formatConversionRate,
  defaultWinRiskThreshold,
  defaultLoseRiskThreshold,
  checkMetricProjectPermissions,
} from "@/services/metrics";
import MetricForm from "@/components/Metrics/MetricForm";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import StatusIndicator from "@/components/Experiment/StatusIndicator";
import HistoryTable from "@/components/HistoryTable";
import DateGraph from "@/components/Metrics/DateGraph";
import { date } from "@/services/dates";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import RightRailSection from "@/components/Layout/RightRailSection";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import InlineForm from "@/components/Forms/InlineForm";
import EditableH1 from "@/components/Forms/EditableH1";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import { getDefaultConversionWindowHours, hasFileConfig } from "@/services/env";
import PickSegmentModal from "@/components/Segments/PickSegmentModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/components/Button";
import usePermissions from "@/hooks/usePermissions";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import ProjectBadges from "@/components/ProjectBadges";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import { GBEdit } from "@/components/Icons";

const MetricPage: FC = () => {
  const router = useRouter();
  const { mid } = router.query;
  const permissions = usePermissions();
  const { apiCall } = useAuth();
  const {
    mutateDefinitions,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    segments,
  } = useDefinitions();
  const settings = useOrgSettings();
  const [editModalOpen, setEditModalOpen] = useState<boolean | number>(false);
  const [editing, setEditing] = useState(false);
  const [editTags, setEditTags] = useState(false);
  const [editProjects, setEditProjects] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const storageKey = `metric_groupby`; // to make metric-specific, include `${mid}`
  const [groupby, setGroupby] = useLocalStorage<"day" | "week">(
    storageKey,
    "day"
  );

  const { data, error, mutate } = useApi<{
    metric: MetricInterface;
    experiments: Partial<ExperimentInterfaceStringDates>[];
  }>(`/metric/${mid}`);

  useSwitchOrg(data?.metric?.organization);

  const {
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
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
  const canEditMetric =
    checkMetricProjectPermissions(metric, permissions) && !hasFileConfig();
  const canEditProjects =
    permissions.check("createMetrics", "") && !hasFileConfig();
  const datasource = metric.datasource
    ? getDatasourceById(metric.datasource)
    : null;
  const experiments = data.experiments;

  let analysis = data.metric.analysis;
  if (!analysis || !("average" in analysis)) {
    analysis = null;
  }

  const segment = getSegmentById(metric.segment);

  const supportsSQL = datasource?.properties?.queryLanguage === "sql";
  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  const status = getQueryStatus(metric.queries || [], metric.analysisError);
  const hasQueries = metric.queries?.length > 0;

  const getMetricUsage = (metric: MetricInterface) => {
    return async () => {
      try {
        const res = await apiCall<{
          status: number;
          ideas?: IdeaInterface[];
          experiments?: { name: string; id: string }[];
        }>(`/metric/${metric.id}/usage`, {
          method: "GET",
        });

        const experimentLinks = [];
        const ideaLinks = [];
        let subtitleText = "This metric is not referenced anywhere else.";
        if (res.ideas?.length > 0 || res.experiments?.length > 0) {
          subtitleText = "This metric is referenced in ";
          const refs = [];
          if (res.experiments.length) {
            refs.push(
              res.experiments.length === 1
                ? "1 experiment"
                : res.experiments.length + " experiments"
            );
            res.experiments.forEach((e) => {
              experimentLinks.push(
                <Link href={`/experiment/${e.id}`}>
                  <a className="">{e.name}</a>
                </Link>
              );
            });
          }
          if (res.ideas.length) {
            refs.push(
              res.ideas.length === 1 ? "1 idea" : res.ideas.length + " ideas"
            );
            res.ideas.forEach((i) => {
              ideaLinks.push(
                <Link href={`/idea/${i.id}`}>
                  <a>{i.text}</a>
                </Link>
              );
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
                                <li className="">{l}</li>
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
                                <li className="">{l}</li>
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
            mutateDefinitions();
            mutate();
          }}
        />
      )}
      {editTags && (
        <EditTagsForm
          cancel={() => setEditTags(false)}
          mutate={mutate}
          tags={metric.tags}
          save={async (tags) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                tags,
              }),
            });
          }}
        />
      )}
      {editProjects && (
        <EditProjectsForm
          cancel={() => setEditProjects(false)}
          mutate={mutate}
          projects={metric.projects}
          save={async (projects) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={metric.owner}
          save={async (owner) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
            mutate();
          }}
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
      <div className="mb-2">
        <Link href="/metrics">
          <a>
            <FaAngleLeft /> All Metrics
          </a>
        </Link>
      </div>

      {metric.status === "archived" && (
        <div className="alert alert-secondary mb-2">
          <strong>This metric is archived.</strong> Existing references will
          continue working, but you will be unable to add this metric to new
          experiments.
        </div>
      )}

      <div className="row align-items-center mb-2">
        <h1 className="col-auto">{metric.name}</h1>
        <div style={{ flex: 1 }} />
        {canEditMetric && (
          <div className="col-auto">
            <MoreMenu>
              <DeleteButton
                className="dropdown-item"
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
              <Button
                className="dropdown-item"
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
            </MoreMenu>
          </div>
        )}
      </div>
      <div className="row mb-3 align-items-center">
        <div className="col">
          Projects:{" "}
          {metric?.projects?.length > 0 ? (
            <ProjectBadges
              projectIds={metric.projects}
              className="badge-ellipsis align-middle"
            />
          ) : (
            <ProjectBadges className="badge-ellipsis align-middle" />
          )}
          {canEditProjects && (
            <a
              href="#"
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

      <div className="row">
        <div className="col-12 col-md-8">
          <Tabs newStyle={true}>
            <Tab display="Info" anchor="info" lazy={true}>
              <div className="row">
                <div className="col-12">
                  <InlineForm
                    editing={editing}
                    setEdit={setEditing}
                    canEdit={canEditMetric}
                    onSave={form.handleSubmit(async (value) => {
                      await apiCall(`/metric/${metric.id}`, {
                        method: "PUT",
                        body: JSON.stringify(value),
                      });
                      await mutate();
                      mutateDefinitions({});
                      setEditing(false);
                    })}
                    onStartEdit={() => {
                      form.setValue("name", metric.name || "");
                      form.setValue("description", metric.description || "");
                    }}
                  >
                    {({ cancel, save }) => (
                      <div className="mb-4">
                        <div className="row mb-3">
                          <div className="col">
                            <EditableH1
                              value={form.watch("name")}
                              onChange={(e) =>
                                form.setValue("name", e.target.value)
                              }
                              editing={canEditMetric && editing}
                              save={save}
                              cancel={cancel}
                            />
                          </div>
                          {canEditMetric && !editing && (
                            <div className="col-auto">
                              <button
                                className="btn btn-outline-primary"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEditing(true);
                                }}
                              >
                                Edit
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </InlineForm>
                  <MarkdownInlineEdit
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
                    value={metric.description}
                    canCreate={canEditMetric}
                    canEdit={canEditMetric}
                    label="Description"
                  />
                  <hr />
                  {!!datasource && (
                    <div>
                      <div className="row mb-1 align-items-center">
                        <div className="col-auto">
                          <h3 className="d-inline-block mb-0">Data Preview</h3>
                        </div>
                        <div style={{ flex: 1 }} />
                        <div className="col-auto">
                          {permissions.check("runQueries", "") && (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                try {
                                  await apiCall(
                                    `/metric/${metric.id}/analysis`,
                                    {
                                      method: "POST",
                                    }
                                  );
                                  mutate();
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                            >
                              <RunQueriesButton
                                icon="refresh"
                                cta={analysis ? "Refresh Data" : "Run Analysis"}
                                initialStatus={getQueryStatus(
                                  metric.queries || [],
                                  metric.analysisError
                                )}
                                statusEndpoint={`/metric/${metric.id}/analysis/status`}
                                cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                                color="outline-primary"
                                onReady={() => {
                                  mutate();
                                }}
                              />
                            </form>
                          )}
                        </div>
                      </div>
                      <div className="row justify-content-between">
                        <div className="col-auto">
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
                                <span className="mr-1">No segment applied</span>
                              )}
                              {canEditMetric &&
                                permissions.check("runQueries", "") && (
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
                        {analysis && (
                          <div className="col-auto text-muted">
                            <small>
                              Last updated on {date(analysis?.createdAt)}
                            </small>
                          </div>
                        )}
                      </div>
                      {hasQueries && status === "failed" && (
                        <div className="alert alert-danger my-3">
                          Error running the analysis. View Queries for more info
                        </div>
                      )}
                      {hasQueries && status === "running" && (
                        <div className="alert alert-info">
                          Your analysis is currently running.{" "}
                          {analysis &&
                            "The data below is from the previous run."}
                        </div>
                      )}
                      {analysis &&
                        status === "succeeded" &&
                        (metric.segment || analysis.segment) &&
                        metric.segment !== analysis.segment && (
                          <div className="alert alert-info">
                            The graphs below are using an old Segment. Update
                            them to see the latest numbers.
                          </div>
                        )}
                      {analysis && (
                        <div className="mb-4">
                          {metric.type !== "binomial" && (
                            <div className="d-flex flex-row align-items-end">
                              <div style={{ fontSize: "2.5em" }}>
                                {formatConversionRate(
                                  metric.type,
                                  analysis.average
                                )}
                              </div>
                              <div className="pb-2 ml-1">average</div>
                            </div>
                          )}
                        </div>
                      )}
                      {analysis?.dates && analysis.dates.length > 0 && (
                        <div className="mb-4">
                          <div className="row mb-3">
                            <div className="col-auto">
                              <h5 className="mb-1 mt-1">
                                {metric.type === "binomial"
                                  ? "Conversions"
                                  : "Metric Value"}{" "}
                                Over Time
                              </h5>
                            </div>
                            <div className="col-auto">
                              <a
                                className={clsx("badge badge-pill mr-2", {
                                  "badge-light": groupby === "week",
                                  "badge-primary": groupby === "day",
                                })}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setGroupby("day");
                                }}
                              >
                                day
                              </a>
                              <a
                                className={clsx("badge badge-pill", {
                                  "badge-light": groupby === "day",
                                  "badge-primary": groupby === "week",
                                })}
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setGroupby("week");
                                }}
                              >
                                week
                              </a>
                            </div>
                          </div>

                          <DateGraph
                            type={metric.type}
                            dates={analysis.dates}
                            groupby={groupby}
                          />
                        </div>
                      )}

                      {!analysis && (
                        <div>
                          <em>
                            No data for this metric yet. Click the Run Analysis
                            button above.
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
                </div>
              </div>
            </Tab>
            <Tab display="Experiments" anchor="experiments">
              <h3>Experiments</h3>
              <p>The most recent 10 experiments using this metric.</p>
              <div className="list-group">
                {experiments.map((e) => (
                  <Link href={`/experiment/${e.id}`} key={e.id}>
                    <a className="list-group-item list-group-item-action">
                      <div className="d-flex">
                        <strong className="mr-3">{e.name}</strong>
                        <div style={{ flex: 1 }} />
                        <StatusIndicator archived={false} status={e.status} />
                        <FaChevronRight
                          className="ml-3"
                          style={{ fontSize: "1.5em" }}
                        />
                      </div>
                    </a>
                  </Link>
                ))}
              </div>
            </Tab>
            <Tab display="Discussion" anchor="discussion" lazy={true}>
              <h3>Comments</h3>
              <DiscussionThread type="metric" id={data.metric.id} />
            </Tab>
            <Tab display="History" anchor="history" lazy={true}>
              <HistoryTable type="metric" id={metric.id} />
            </Tab>
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
              canOpen={canEditProjects}
            >
              <RightRailSectionGroup>
                {metric?.projects?.length > 0 ? (
                  <ProjectBadges
                    projectIds={metric.projects}
                    className="badge-ellipsis align-middle"
                  />
                ) : (
                  <ProjectBadges className="badge-ellipsis align-middle" />
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
                      {metric.conditions?.length > 0 && (
                        <RightRailSectionGroup title="Conditions" type="list">
                          {metric.conditions.map(
                            (c) => `${c.column} ${c.operator} "${c.value}"`
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
              <RightRailSectionGroup type="commaList" empty="">
                {[
                  metric.inverse ? "inverse" : null,
                  metric.cap > 0 ? `cap: ${metric.cap}` : null,
                  metric.ignoreNulls ? "converted users only" : null,
                ]}
              </RightRailSectionGroup>

              {datasource?.properties?.metricCaps && (
                <RightRailSectionGroup
                  type="commaList"
                  title="Conversion Window"
                >
                  <span>
                    {metric.conversionDelayHours
                      ? metric.conversionDelayHours + " to "
                      : ""}
                    {(metric.conversionDelayHours || 0) +
                      (metric.conversionWindowHours ||
                        getDefaultConversionWindowHours())}{" "}
                    hours
                  </span>
                </RightRailSectionGroup>
              )}

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled">
                  {settings.statsEngine !== "frequentist" && (
                    <>
                      <li className="mb-2">
                        <span className="uppercase-title">Thresholds</span>
                      </li>
                      <li className="mb-2">
                        <span className="text-gray">Acceptable risk &lt;</span>{" "}
                        <span className="font-weight-bold">
                          {metric?.winRisk * 100 ||
                            defaultWinRiskThreshold * 100}
                          %
                        </span>
                      </li>
                      <li className="mb-2">
                        <span className="text-gray">
                          Unacceptable risk &gt;
                        </span>{" "}
                        <span className="font-weight-bold">
                          {metric?.loseRisk * 100 ||
                            defaultLoseRiskThreshold * 100}
                          %
                        </span>
                      </li>
                    </>
                  )}
                  <li className="mb-2">
                    <span className="text-gray">Minimum sample size:</span>{" "}
                    <span className="font-weight-bold">
                      {getMinSampleSizeForMetric(metric)}
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Max percent change:</span>{" "}
                    <span className="font-weight-bold">
                      {getMaxPercentageChangeForMetric(metric) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Min percent change :</span>{" "}
                    <span className="font-weight-bold">
                      {getMinPercentageChangeForMetric(metric) * 100}%
                    </span>
                  </li>
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
