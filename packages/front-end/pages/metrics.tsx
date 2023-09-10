import React, { useCallback, useEffect, useState } from "react";
import { FaArchive, FaPlus, FaRegCopy } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useRouter } from "next/router";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isProjectListValidForProject } from "shared/util";
import SortedTags from "@/components/Tags/SortedTags";
import { GBAddCircle } from "@/components/Icons";
import ProjectBadges from "@/components/ProjectBadges";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import MetricForm from "@/components/Metrics/MetricForm";
import usePermissions from "@/hooks/usePermissions";
import Toggle from "@/components/Forms/Toggle";
import useApi from "@/hooks/useApi";
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import { checkMetricProjectPermissions } from "@/services/metrics";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useAuth } from "@/services/auth";
import AutoGenerateMetricsModal from "@/components/AutoGenerateMetricsModal";
import AutoGenerateMetricsButton from "@/components/AutoGenerateMetricsButton";

interface ExperimentUsage {
  draft: ExperimentInterfaceStringDates[];
  running: ExperimentInterfaceStringDates[];
  stopped: ExperimentInterfaceStringDates[];
  dateLastUsed: string | null;
  total: number;
}

const MetricsPage = (): React.ReactElement => {
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
    duplicate: boolean;
  } | null>(null);
  const [
    showAutoGenerateMetricsModal,
    setShowAutoGenerateMetricsModal,
  ] = useState(false);

  const { getDatasourceById, mutateDefinitions, project } = useDefinitions();
  const router = useRouter();

  const { data, error, mutate } = useApi<{ metrics: MetricInterface[] }>(
    `/metrics`
  );

  const { getUserDisplay } = useUser();

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const tagsFilter = useTagsFilter("metrics");

  const [showArchived, setShowArchived] = useState(false);
  const [recentlyArchived, setRecentlyArchived] = useState<Set<string>>(
    new Set()
  );
  const [showUsage, setShowUsage] = useState(false);
  const [experimentData, setExperimentData] = useState<Map<
    string,
    ExperimentUsage
  > | null>();

  useEffect(() => {
    if (showUsage) {
      (async () => {
        await apiCall("/experiments").then(
          (data: { experiments: ExperimentInterfaceStringDates[] }) => {
            const metricExperimentMap = new Map();

            data?.experiments?.forEach((experiment) => {
              let mostRecentDate = datetime(experiment.dateCreated);
              if (experiment.status === "running") {
                mostRecentDate = datetime(new Date());
              } else {
                const lastPhase =
                  experiment?.phases?.[experiment.phases.length - 1];
                if (
                  lastPhase &&
                  lastPhase?.dateStarted &&
                  mostRecentDate < lastPhase.dateStarted
                ) {
                  mostRecentDate = lastPhase.dateStarted;
                }
                if (
                  lastPhase &&
                  lastPhase?.dateEnded &&
                  mostRecentDate < lastPhase.dateEnded
                ) {
                  mostRecentDate = lastPhase.dateEnded;
                }
              }
              experiment?.metrics?.forEach((metric) => {
                if (metricExperimentMap.has(metric)) {
                  const existing = metricExperimentMap.get(metric);
                  if (!existing || !existing?.[experiment.status]) {
                    existing[experiment.status] = [];
                  }
                  existing[experiment.status].push(experiment);
                  existing.total++;
                  if (
                    !existing.dateLastUsed ||
                    existing.dateLastUsed < mostRecentDate
                  ) {
                    existing.dateLastUsed = mostRecentDate;
                  }
                  metricExperimentMap.set(metric, existing);
                } else {
                  const newRecord: ExperimentUsage = {
                    draft: [],
                    running: [],
                    stopped: [],
                    dateLastUsed: mostRecentDate,
                    total: 0,
                  };
                  newRecord[experiment.status].push(experiment);
                  newRecord.total++;
                  metricExperimentMap.set(metric, newRecord);
                }
              });
              experiment?.guardrails?.forEach((metric) => {
                if (metricExperimentMap.has(metric)) {
                  metricExperimentMap.get(metric).push(experiment);
                } else {
                  metricExperimentMap.set(metric, [experiment]);
                }
              });
            });
            setExperimentData(metricExperimentMap);
          }
        );
      })();
    }
  }, [apiCall, showUsage]);

  const metrics = useAddComputedFields(
    data?.metrics,
    (m) => ({
      datasourceName: m.datasource
        ? getDatasourceById(m.datasource)?.name || "Unknown"
        : "Manual",
      datasourceDescription: m.datasource
        ? getDatasourceById(m.datasource)?.description || undefined
        : undefined,
      ownerName: getUserDisplay(m.owner),
      numExperiments: experimentData?.get(m.id)?.total || 0,
      dateLastUsed: experimentData?.get(m.id)?.dateLastUsed || "-",
    }),
    [getDatasourceById, experimentData]
  );
  const filteredMetrics = project
    ? metrics.filter((m) => isProjectListValidForProject(m.projects, project))
    : metrics;

  // Searching
  const filterResults = useCallback(
    (items: typeof filteredMetrics) => {
      if (!showArchived) {
        items = items.filter((m) => {
          return m.status !== "archived" || recentlyArchived.has(m.id);
        });
      }
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [showArchived, recentlyArchived, tagsFilter.tags]
  );
  const editMetricsPermissions: { [id: string]: boolean } = {};
  filteredMetrics.forEach((m) => {
    editMetricsPermissions[m.id] = checkMetricProjectPermissions(
      m,
      permissions
    );
  });
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: filteredMetrics,
    defaultSortField: "name",
    localStorageKey: "metrics",
    searchFields: ["name^3", "datasourceName", "ownerName", "tags", "type"],
    filterResults,
  });

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const closeModal = () => {
    setModalData(null);
  };
  const onSuccess = () => {
    mutateDefinitions();
    mutate();
  };

  if (!filteredMetrics.length) {
    return (
      <div className="container p-4">
        {modalData && (
          <MetricForm
            {...modalData}
            onClose={closeModal}
            onSuccess={onSuccess}
            source="blank-state"
          />
        )}
        {showAutoGenerateMetricsModal && (
          <AutoGenerateMetricsModal
            source="metrics-index-page"
            setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
            mutate={mutate}
          />
        )}
        <div className="d-flex">
          <h1>Metrics</h1>
          <DocLink docSection="metrics" className="align-self-center ml-2 pb-1">
            View Documentation
          </DocLink>
        </div>
        <p>
          Metrics define success and failure for your business. Every business
          is unique, but below are some common metrics to draw inspiration from:
        </p>
        <ul>
          <li>
            <strong>Advertising/SEO</strong> - page views per user, time on
            site, bounce rate
          </li>
          <li>
            <strong>E-Commerce</strong> - add to cart, start checkout, complete
            checkout, revenue, refunds
          </li>
          <li>
            <strong>Subscription</strong> - start trial, start subscription,
            MRR, engagement, NPS, churn
          </li>
          <li>
            <strong>Marketplace</strong> - seller signups, buyer signups,
            transactions, revenue, engagement
          </li>
        </ul>
        {hasFileConfig() && (
          <div className="alert alert-info">
            It looks like you have a <code>config.yml</code> file. Metrics
            defined there will show up on this page.{" "}
            <DocLink docSection="config_yml">View Documentation</DocLink>
          </div>
        )}
        {permissions.check("createMetrics", project) && !hasFileConfig() && (
          <>
            <AutoGenerateMetricsButton
              setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
              size="lg"
            />
            <button
              className="btn btn-lg btn-success"
              onClick={(e) => {
                e.preventDefault();
                setModalData({
                  current: {},
                  edit: false,
                  duplicate: false,
                });
              }}
            >
              <FaPlus /> Add your first Metric
            </button>
          </>
        )}
      </div>
    );
  }

  const hasArchivedMetrics = filteredMetrics.find(
    (m) => m.status === "archived"
  );

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      {modalData && (
        <MetricForm
          {...modalData}
          onClose={closeModal}
          onSuccess={onSuccess}
          source="metrics-list"
        />
      )}
      {showAutoGenerateMetricsModal && (
        <AutoGenerateMetricsModal
          source="metric-index-page"
          setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
          mutate={mutate}
        />
      )}
      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto d-flex">
          <h1>
            Your Metrics{" "}
            <Tooltip
              className="small"
              body="Metrics define success and failure for your business. Create metrics
      here to use throughout the GrowthBook app."
            />
          </h1>
          <DocLink docSection="metrics" className="align-self-center ml-2 pb-1">
            View Documentation
          </DocLink>
        </div>
        <div style={{ flex: 1 }} />
        {permissions.check("createMetrics", project) && !hasFileConfig() && (
          <div className="col-auto">
            <AutoGenerateMetricsButton
              setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
            />
            <button
              className="btn btn-primary float-right"
              onClick={() =>
                setModalData({
                  current: {},
                  edit: false,
                  duplicate: false,
                })
              }
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Metric
            </button>
          </div>
        )}
      </div>
      <div className="row mb-2 align-items-center">
        <div className="col-lg-3 col-md-4 col-6">
          <Field placeholder="Search..." type="search" {...searchInputProps} />
        </div>
        {hasArchivedMetrics && (
          <div className="col-auto text-muted">
            <Toggle
              value={showArchived}
              setValue={setShowArchived}
              id="show-archived"
              label="show archived"
            />
            Show archived
          </div>
        )}
        <div className="col-auto">
          <TagsFilter filter={tagsFilter} items={items} />
        </div>
        <div className="col-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowUsage(!showUsage);
            }}
          >
            {showUsage ? "Hide usage" : "Show usage"}
          </a>
        </div>
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <SortableTH field="name" className="col-3">
              Name
            </SortableTH>
            <SortableTH field="type" className="col-1">
              Type
            </SortableTH>
            <th className="col-2">Tags</th>
            <th>Projects</th>
            <th className="col-1">Owner</th>
            <SortableTH
              field="datasourceName"
              className="d-none d-lg-table-cell col-auto"
            >
              Data Source
            </SortableTH>
            {!hasFileConfig() && (
              <SortableTH
                field="dateUpdated"
                className="d-none d-md-table-cell col-1"
              >
                Last Updated
              </SortableTH>
            )}
            {showUsage && (
              <>
                <SortableTH
                  field="numExperiments"
                  className="d-none d-md-table-cell col-1"
                >
                  Experiments
                </SortableTH>
                <SortableTH
                  field="dateLastUsed"
                  className="d-none d-md-table-cell col-1"
                >
                  Last used
                </SortableTH>
              </>
            )}
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((metric) => (
            <tr
              key={metric.id}
              onClick={(e) => {
                e.preventDefault();
                router.push(`/metric/${metric.id}`);
              }}
              style={{ cursor: "pointer" }}
              className={metric.status === "archived" ? "text-muted" : ""}
            >
              <td>
                <Link href={`/metric/${metric.id}`}>
                  <a
                    className={`${
                      metric.status === "archived" ? "text-muted" : "text-dark"
                    } font-weight-bold`}
                  >
                    {metric.name}
                  </a>
                </Link>
              </td>
              <td>{metric.type}</td>

              <td className="nowrap">
                <SortedTags
                  tags={metric.tags ? Object.values(metric.tags) : []}
                />
              </td>
              <td className="col-2">
                {metric && (metric.projects || []).length > 0 ? (
                  <ProjectBadges
                    projectIds={metric.projects}
                    className="badge-ellipsis short align-middle"
                  />
                ) : (
                  <ProjectBadges className="badge-ellipsis short align-middle" />
                )}
              </td>
              <td>{metric.owner}</td>
              <td className="d-none d-lg-table-cell">
                {metric.datasourceName}
                {metric.datasourceDescription && (
                  <div
                    className="text-gray font-weight-normal small text-ellipsis"
                    style={{ maxWidth: 350 }}
                  >
                    {metric.datasourceDescription}
                  </div>
                )}
              </td>
              {!hasFileConfig() && (
                <td
                  title={datetime(metric.dateUpdated || "")}
                  className="d-none d-md-table-cell"
                >
                  {ago(metric.dateUpdated || "")}
                </td>
              )}
              {showUsage && (
                <>
                  <td className="d-none d-md-table-cell">
                    <Tooltip
                      body={`${
                        experimentData?.get(metric.id)?.draft.length || 0
                      }
         drafts, 
        ${experimentData?.get(metric.id)?.running.length || 0} running, 
        ${experimentData?.get(metric.id)?.stopped.length || 0} stopped`}
                    >
                      {metric.numExperiments + ""}
                    </Tooltip>
                  </td>
                  <td
                    className="d-none d-md-table-cell"
                    title={
                      metric.dateLastUsed
                        ? datetime(metric.dateLastUsed)
                        : "never used"
                    }
                  >
                    {metric.dateLastUsed && metric.dateLastUsed !== "-"
                      ? ago(metric.dateLastUsed || "")
                      : "-"}
                  </td>
                </>
              )}
              <td className="text-muted">
                {metric.status === "archived" && (
                  <Tooltip
                    body={"Archived"}
                    innerClassName="p-2"
                    tipMinWidth="auto"
                  >
                    <FaArchive />
                  </Tooltip>
                )}
              </td>
              <td
                style={{ cursor: "initial" }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <MoreMenu>
                  {!hasFileConfig() && editMetricsPermissions[metric.id] && (
                    <button
                      className="btn dropdown-item py-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setModalData({
                          current: {
                            ...metric,
                            name: metric.name + " (copy)",
                          },
                          edit: false,
                          duplicate: true,
                        });
                      }}
                    >
                      <FaRegCopy /> Duplicate
                    </button>
                  )}
                  {!hasFileConfig() && editMetricsPermissions[metric.id] && (
                    <button
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
                        if (newStatus === "archived") {
                          setRecentlyArchived(
                            (set) => new Set([...set, metric.id])
                          );
                        } else {
                          setRecentlyArchived(
                            (set) =>
                              new Set([...set].filter((id) => id !== metric.id))
                          );
                        }
                        mutateDefinitions({});
                        mutate();
                      }}
                    >
                      <FaArchive />{" "}
                      {metric.status === "archived" ? "Unarchive" : "Archive"}
                    </button>
                  )}
                </MoreMenu>
              </td>
            </tr>
          ))}

          {!items.length && (isFiltered || tagsFilter.tags.length > 0) && (
            <tr>
              <td colSpan={!hasFileConfig() ? 5 : 4} align={"center"}>
                No matching metrics
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default MetricsPage;
