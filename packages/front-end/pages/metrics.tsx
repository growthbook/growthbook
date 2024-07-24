import React, { ReactElement, useCallback, useState } from "react";
import { FaArchive, FaPlus, FaRegCopy } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useRouter } from "next/router";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { getMetricLink } from "shared/experiments";
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
import Toggle from "@/components/Forms/Toggle";
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import { envAllowsCreatingMetrics } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { FaPencilAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import AutoGenerateMetricsModal from "@/components/AutoGenerateMetricsModal";
import AutoGenerateMetricsButton from "@/components/AutoGenerateMetricsButton";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
interface MetricTableItem {
  id: string;
  managedBy: "" | "api" | "config";
  name: string;
  type: string;
  tags: string[];
  projects: string[];
  owner: string;
  datasource: string;
  dateUpdated: Date | null;
  archived: boolean;
  onDuplicate?: () => void;
  onArchive?: (desiredState: boolean) => Promise<void>;
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

  const {
    getDatasourceById,
    mutateDefinitions,
    _metricsIncludingArchived: inlineMetrics,
    factMetrics,
    project,
    ready,
  } = useDefinitions();
  const router = useRouter();

  const { getUserDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const tagsFilter = useTagsFilter("metrics");

  const [showArchived, setShowArchived] = useState(false);
  const [recentlyArchived, setRecentlyArchived] = useState<Set<string>>(
    new Set()
  );

  const combinedMetrics = [
    ...inlineMetrics.map((m) => {
      const item: MetricTableItem = {
        id: m.id,
        managedBy: m.managedBy || "",
        archived: m.status === "archived",
        datasource: m.datasource || "",
        dateUpdated: m.dateUpdated,
        name: m.name,
        owner: m.owner || "",
        projects: m.projects || [],
        tags: m.tags || [],
        type: m.type,
        onArchive: async (desiredState) => {
          const newStatus = desiredState ? "archived" : "active";
          await apiCall(`/metric/${m.id}`, {
            method: "PUT",
            body: JSON.stringify({
              status: newStatus,
            }),
          });
          if (newStatus === "archived") {
            setRecentlyArchived((set) => new Set([...set, m.id]));
          } else {
            setRecentlyArchived(
              (set) => new Set([...set].filter((id) => id !== m.id))
            );
          }
        },
        onDuplicate: () => {
          setModalData({
            current: {
              ...m,
              name: m.name + " (copy)",
            },
            edit: false,
            duplicate: true,
          });
        },
      };
      return item;
    }),
    ...factMetrics.map((m) => {
      const item: MetricTableItem = {
        id: m.id,
        managedBy: m.managedBy || "",
        archived: false,
        datasource: m.datasource,
        dateUpdated: m.dateUpdated,
        name: m.name,
        owner: m.owner,
        projects: m.projects || [],
        tags: m.tags || [],
        type: m.metricType,
      };
      return item;
    }),
  ];

  const metrics = useAddComputedFields(
    combinedMetrics,
    (m) => ({
      datasourceName: m.datasource
        ? getDatasourceById(m.datasource)?.name || "Unknown"
        : "Manual",
      datasourceDescription: m.datasource
        ? getDatasourceById(m.datasource)?.description || undefined
        : undefined,
      ownerName: getUserDisplay(m.owner),
    }),
    [getDatasourceById]
  );
  const filteredMetrics = project
    ? metrics.filter((m) => isProjectListValidForProject(m.projects, project))
    : metrics;

  // Searching
  const filterResults = useCallback(
    (items: typeof filteredMetrics) => {
      if (!showArchived) {
        items = items.filter((m) => {
          return !m.archived || recentlyArchived.has(m.id);
        });
      }
      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [showArchived, recentlyArchived, tagsFilter.tags]
  );

  const editMetricsPermissions: {
    [id: string]: { canDuplicate: boolean; canUpdate: boolean };
  } = {};
  filteredMetrics.forEach((m) => {
    editMetricsPermissions[m.id] = {
      canDuplicate: permissionsUtil.canCreateMetric(m),
      canUpdate: permissionsUtil.canUpdateMetric(m, {}),
    };
  });
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: filteredMetrics,
    defaultSortField: "name",
    localStorageKey: "metrics",
    searchFields: ["name^3", "datasourceName", "ownerName", "tags", "type"],
    filterResults,
  });

  if (!ready) {
    return <LoadingOverlay />;
  }

  const closeModal = () => {
    setModalData(null);
  };
  const onSuccess = () => {
    mutateDefinitions();
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
            allowFactMetrics={!modalData.duplicate && !modalData.edit}
          />
        )}
        {showAutoGenerateMetricsModal && (
          <AutoGenerateMetricsModal
            source="metrics-index-page"
            setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
            mutate={mutateDefinitions}
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
        {permissionsUtil.canCreateMetric({ projects: [project] }) &&
          envAllowsCreatingMetrics() && (
            <>
              <AutoGenerateMetricsButton
                setShowAutoGenerateMetricsModal={
                  setShowAutoGenerateMetricsModal
                }
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

  const hasArchivedMetrics = filteredMetrics.some((m) => m.archived);

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      {modalData && (
        <MetricForm
          {...modalData}
          onClose={closeModal}
          onSuccess={onSuccess}
          source="metrics-list"
          allowFactMetrics={!modalData.duplicate && !modalData.edit}
        />
      )}
      {showAutoGenerateMetricsModal && (
        <AutoGenerateMetricsModal
          source="metric-index-page"
          setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
          mutate={mutateDefinitions}
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
        {permissionsUtil.canCreateMetric({ projects: [project] }) &&
          envAllowsCreatingMetrics() && (
            <div className="col-auto">
              <AutoGenerateMetricsButton
                setShowAutoGenerateMetricsModal={
                  setShowAutoGenerateMetricsModal
                }
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
      <div className="mt-3">
        <CustomMarkdown page={"metricList"} />
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
            <SortableTH
              field="dateUpdated"
              className="d-none d-md-table-cell col-1"
            >
              Last Updated
            </SortableTH>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((metric) => {
            const moreMenuLinks: ReactElement[] = [];

            if (
              metric.onDuplicate &&
              editMetricsPermissions[metric.id].canDuplicate &&
              envAllowsCreatingMetrics()
            ) {
              moreMenuLinks.push(
                <button
                  className="btn dropdown-item py-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    metric.onDuplicate && metric.onDuplicate();
                  }}
                >
                  <FaRegCopy /> Duplicate
                </button>
              );
            }

            if (
              !metric.managedBy &&
              metric.onArchive &&
              editMetricsPermissions[metric.id].canUpdate
            ) {
              moreMenuLinks.push(
                <button
                  className="btn dropdown-item py-2"
                  onClick={async (e) => {
                    e.preventDefault();
                    metric.onArchive &&
                      (await metric.onArchive(!metric.archived));
                    mutateDefinitions({});
                  }}
                >
                  <FaArchive /> {metric.archived ? "Unarchive" : "Archive"}
                </button>
              );
            }

            return (
              <tr
                key={metric.id}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(getMetricLink(metric.id));
                }}
                style={{ cursor: "pointer" }}
                className={metric.archived ? "text-muted" : ""}
              >
                <td>
                  <Link
                    href={getMetricLink(metric.id)}
                    className={`${
                      metric.archived ? "text-muted" : "text-dark"
                    } font-weight-bold`}
                  >
                    <MetricName id={metric.id} />
                  </Link>
                </td>
                <td>{metric.type}</td>

                <td className="col-4">
                  <SortedTags
                    tags={metric.tags ? Object.values(metric.tags) : []}
                    shouldShowEllipsis={true}
                  />
                </td>
                <td className="col-2">
                  {metric && (metric.projects || []).length > 0 ? (
                    <ProjectBadges
                      resourceType="metric"
                      projectIds={metric.projects}
                      className="badge-ellipsis short align-middle"
                    />
                  ) : (
                    <ProjectBadges
                      resourceType="metric"
                      className="badge-ellipsis short align-middle"
                    />
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
                <td
                  title={datetime(metric.dateUpdated || "")}
                  className="d-none d-md-table-cell"
                >
                  {metric.managedBy === "config"
                    ? ""
                    : date(metric.dateUpdated || "")}
                </td>
                <td className="text-muted">
                  {metric.archived && (
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
                    {moreMenuLinks.map((menuItem, i) => (
                      <div key={`${menuItem}-${i}`} className="d-inline">
                        {menuItem}
                      </div>
                    ))}
                  </MoreMenu>
                </td>
              </tr>
            );
          })}

          {!items.length && (isFiltered || tagsFilter.tags.length > 0) && (
            <tr>
              <td colSpan={9} align={"center"}>
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
