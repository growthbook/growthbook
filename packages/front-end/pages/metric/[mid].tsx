import { useRouter } from "next/router";
import useApi from "../../hooks/useApi";
import DiscussionThread from "../../components/DiscussionThread";
import useSwitchOrg from "../../services/useSwitchOrg";
import { FC, useContext, useState, useEffect } from "react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LoadingOverlay from "../../components/LoadingOverlay";
import Link from "next/link";
import { FaAngleLeft, FaChevronRight } from "react-icons/fa";
import { UserContext } from "../../components/ProtectedPage";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import {
  formatConversionRate,
  defaultWinRiskThreshold,
  defaultLoseRiskThreshold,
  defaultMaxPercentChange,
  defaultMinPercentChange,
  defaultMinSampleSize,
} from "../../services/metrics";
import MetricForm from "../../components/Metrics/MetricForm";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import HistoryTable from "../../components/HistoryTable";
import DistributionGraph from "../../components/Metrics/DistributionGraph";
import DateGraph from "../../components/Metrics/DateGraph";
import { date } from "../../services/dates";
import RunQueriesButton, {
  getQueryStatus,
} from "../../components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../../components/Queries/ViewAsyncQueriesButton";
import RightRailSection from "../../components/Layout/RightRailSection";
import RightRailSectionGroup from "../../components/Layout/RightRailSectionGroup";
import InlineForm from "../../components/Forms/InlineForm";
import MarkdownEditor from "../../components/Forms/MarkdownEditor";
import EditableH1 from "../../components/Forms/EditableH1";
import { MetricInterface } from "back-end/types/metric";
import { useDefinitions } from "../../services/DefinitionsContext";
import Code from "../../components/Code";
import {
  getDefaultConversionWindowHours,
  hasFileConfig,
} from "../../services/env";
import { useForm } from "react-hook-form";
import { BsGear } from "react-icons/bs";
import PickSegmentModal from "../../components/Segments/PickSegmentModal";
import clsx from "clsx";

const MetricPage: FC = () => {
  const router = useRouter();
  const { mid } = router.query;
  const { permissions } = useContext(UserContext);
  const { apiCall } = useAuth();
  const {
    mutateDefinitions,
    getDatasourceById,
    getSegmentById,
    segments,
  } = useDefinitions();
  const [editModalOpen, setEditModalOpen] = useState<boolean | number>(false);

  const [editing, setEditing] = useState(false);
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
  const canEdit = permissions.createMetrics && !hasFileConfig();
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

  const status = getQueryStatus(metric.queries || []);

  return (
    <div className="container-fluid mt-3 pagecontents">
      {editModalOpen !== false && (
        <MetricForm
          current={metric}
          edit={true}
          source="metrics-detail"
          initialStep={editModalOpen !== true ? editModalOpen : 0}
          onClose={(success) => {
            setEditModalOpen(false);
            if (success) {
              mutateDefinitions({});
              mutate();
            }
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

      <div className="row align-items-center mb-2">
        <h1 className="col-auto">{metric.name}</h1>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <div className="col-auto">
            <DeleteButton
              className="ml-2"
              onClick={async () => {
                await apiCall(`/metric/${metric.id}`, {
                  method: "DELETE",
                });
                mutateDefinitions({});
                router.push("/metrics");
              }}
              displayName={"Metric '" + metric.name + "'"}
            />
          </div>
        )}
      </div>

      <Tabs>
        <Tab display="Info" anchor="info" lazy={true}>
          <div className="row">
            <div className="col-md-9">
              <InlineForm
                editing={canEdit && editing}
                setEdit={setEditing}
                onSave={form.handleSubmit(async (value) => {
                  await apiCall(`/metric/${metric.id}`, {
                    method: "PUT",
                    body: JSON.stringify(value),
                  });
                  await mutate();
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
                          editing={editing}
                          save={save}
                          cancel={cancel}
                        />
                      </div>
                      {canEdit && !editing && (
                        <div className="col-auto">
                          <button
                            className="btn btn-outline-secondary"
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
                    <MarkdownEditor
                      editing={editing}
                      cancel={cancel}
                      save={save}
                      defaultValue={metric.description}
                      form={form}
                      name="description"
                      placeholder={
                        <>
                          No description yet.{" "}
                          {canEdit && (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setEditing(true);
                              }}
                            >
                              Add one.
                            </a>
                          )}
                        </>
                      }
                    />
                  </div>
                )}
              </InlineForm>
              <hr />
              {!!datasource && (
                <div>
                  <h3>Data Preview</h3>
                  {analysis && status === "failed" && (
                    <div className="alert alert-danger my-3">
                      Error running the analysis. View Queries for more info
                    </div>
                  )}
                  {analysis && status === "running" && (
                    <div className="alert alert-info">
                      Your analysis is currently running. The data below is from
                      the previous run.
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
                  <div className="row mb-3 align-items-center">
                    {segments.length > 0 && (
                      <div className="col-auto">
                        {segment?.name ? (
                          <>
                            Segment applied:{" "}
                            <span className="badge badge-secondary mr-1">
                              {segment?.name || "Everyone"}
                            </span>
                          </>
                        ) : (
                          <span className="mr-1">No segment applied</span>
                        )}
                        <a
                          onClick={(e) => {
                            e.preventDefault();
                            setSegmentOpen(true);
                          }}
                          href="#"
                        >
                          <BsGear />
                        </a>
                      </div>
                    )}
                    {analysis && (
                      <div className="col-auto text-muted">
                        Last updated on {date(analysis?.createdAt)}
                      </div>
                    )}
                    <div className="col-auto">
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
                          initialStatus={getQueryStatus(metric.queries || [])}
                          statusEndpoint={`/metric/${metric.id}/analysis/status`}
                          cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                          onReady={() => {
                            mutate();
                          }}
                        />
                      </form>
                    </div>
                  </div>
                  {analysis && (
                    <div className="mb-4">
                      <div className="d-flex flex-row align-items-end">
                        <div style={{ fontSize: "2.5em" }}>
                          {formatConversionRate(metric.type, analysis.average)}
                        </div>
                        <div className="pb-2 ml-1">average</div>
                      </div>
                    </div>
                  )}
                  {analysis?.dates && analysis.dates.length > 0 && (
                    <div className="mb-4">
                      <div className="row mb-3">
                        <div className="col-auto">
                          <h5>Metric Over Time</h5>
                        </div>
                        {analysis.dates?.[0]?.u > 0 && (
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
                        )}
                      </div>

                      <DateGraph
                        type={metric.type}
                        dates={analysis.dates}
                        groupby={groupby}
                      />
                    </div>
                  )}
                  {analysis?.percentiles && analysis.percentiles.length > 0 && (
                    <div className="mb-4">
                      <h5 className="mb-3">Percentile Breakdown</h5>
                      <DistributionGraph
                        type={metric.type}
                        percentiles={analysis.percentiles}
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

                  {analysis && (
                    <div className="row my-3">
                      <div className="col-auto">
                        <ViewAsyncQueriesButton
                          queries={
                            metric.queries?.length > 0
                              ? metric.queries.map((q) => q.query)
                              : []
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="col-md-3">
              <RightRailSection
                title="Basic Info"
                open={() => setEditModalOpen(0)}
                canOpen={canEdit}
              >
                <RightRailSectionGroup title="Type" type="badge">
                  {metric.type}
                </RightRailSectionGroup>
                {datasource && (
                  <RightRailSectionGroup title="Data Source" type="badge">
                    {datasource.name}
                  </RightRailSectionGroup>
                )}
                {datasource?.type === "google_analytics" && (
                  <RightRailSectionGroup title="GA Metric" type="badge">
                    {metric.table}
                  </RightRailSectionGroup>
                )}
              </RightRailSection>

              {datasource?.properties?.hasSettings && (
                <>
                  <hr />
                  <RightRailSection
                    title="Query Settings"
                    open={() => setEditModalOpen(1)}
                    canOpen={canEdit}
                  >
                    {supportsSQL && metric.sql ? (
                      <Code language="sql" code={metric.sql} />
                    ) : (
                      <>
                        <RightRailSectionGroup
                          title={supportsSQL ? "Table" : "Event"}
                          type="code"
                        >
                          {metric.table}
                        </RightRailSectionGroup>
                        {metric.type !== "binomial" && metric.column && (
                          <RightRailSectionGroup
                            title={supportsSQL ? "Column" : "Property"}
                            type="code"
                          >
                            {metric.column}
                          </RightRailSectionGroup>
                        )}
                        {metric.userIdType !== "anonymous" && customizeUserIds && (
                          <RightRailSectionGroup
                            title="User Id Col"
                            type="code"
                          >
                            {metric.userIdColumn}
                          </RightRailSectionGroup>
                        )}
                        {metric.userIdType !== "user" && customizeUserIds && (
                          <RightRailSectionGroup
                            title="Anon Id Col"
                            type="code"
                          >
                            {metric.anonymousIdColumn}
                          </RightRailSectionGroup>
                        )}
                        {customzeTimestamp && (
                          <RightRailSectionGroup
                            title="Timestamp Col"
                            type="code"
                          >
                            {metric.timestampColumn}
                          </RightRailSectionGroup>
                        )}
                        {metric.conditions?.length > 0 && (
                          <RightRailSectionGroup title="Conditions" type="list">
                            {metric.conditions.map(
                              (c) => `${c.column} ${c.operator} "${c.value}"`
                            )}
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
                canOpen={canEdit}
              >
                <RightRailSectionGroup type="badge" empty="">
                  {[
                    metric.inverse ? "inverse" : null,
                    metric.cap > 0 ? `cap: ${metric.cap}` : null,
                    metric.ignoreNulls ? "converted users only" : null,
                    metric.earlyStart ? "start of session" : null,
                  ]}
                </RightRailSectionGroup>

                {datasource?.properties?.metricCaps && (
                  <RightRailSectionGroup type="code" title="Conversion Window">
                    {metric.conversionWindowHours ||
                      getDefaultConversionWindowHours()}{" "}
                    hours
                  </RightRailSectionGroup>
                )}

                <RightRailSectionGroup type="custom" empty="">
                  <small>
                    <strong>Thresholds:</strong>
                    <br />
                    <i>Acceptable risk</i> &lt;{" "}
                    {metric?.winRisk * 100 || defaultWinRiskThreshold * 100}
                    %
                    <br />
                    <i>Unacceptable risk</i> &gt;{" "}
                    {metric?.loseRisk * 100 || defaultLoseRiskThreshold * 100}%
                    <br />
                    <i>Minimum sample size</i> :{" "}
                    {metric?.minSampleSize ?? defaultMinSampleSize}
                    <br />
                    <i>Max percent change</i> :{" "}
                    {metric?.maxPercentChange * 100 ||
                      defaultMaxPercentChange * 100}
                    %
                    <br />
                    <i>Min percent change</i> :{" "}
                    {metric?.minPercentChange * 100 ||
                      defaultMinPercentChange * 100}
                    %
                  </small>
                </RightRailSectionGroup>
              </RightRailSection>
              <hr />
              <RightRailSection
                title="Tags"
                open={() => setEditModalOpen(0)}
                canOpen={canEdit}
              >
                <RightRailSectionGroup type="badge">
                  {metric.tags}
                </RightRailSectionGroup>
              </RightRailSection>
            </div>
          </div>
        </Tab>
        <Tab display="Experiments" anchor="experiments">
          <h3>Experiments</h3>
          <p>The most recent 10 experiments using this metric.</p>
          <div className="list-group">
            {experiments.map((e) => (
              <Link
                href="/experiment/[eid]"
                as={`/experiment/${e.id}`}
                key={e.id}
              >
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
  );
};

export default MetricPage;
