import React, { ReactElement, useCallback, useState } from "react";
import { FaArchive } from "react-icons/fa";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { getMetricLink, isFactMetricId } from "shared/experiments";
import { useRouter } from "next/router";
import SortedTags from "@/components/Tags/SortedTags";
import ProjectBadges from "@/components/ProjectBadges";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import { envAllowsCreatingMetrics } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useAuth } from "@/services/auth";
import AutoGenerateMetricsModal from "@/components/AutoGenerateMetricsModal";
import AutoGenerateMetricsButton from "@/components/AutoGenerateMetricsButton";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/components/Radix/Button";
import {
  MetricModalState,
  MetricModal,
} from "@/components/FactTables/NewMetricModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

export interface MetricTableItem {
  id: string;
  managedBy: "" | "api" | "config";
  name: string;
  type: string;
  tags: string[];
  projects: string[];
  owner: string;
  isRatio: boolean;
  datasource: string;
  dateUpdated: Date | null;
  dateCreated: Date | null;
  archived: boolean;
  canEdit: boolean;
  canDuplicate: boolean;
  onArchive?: (desiredState: boolean) => Promise<void>;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
}

export function useCombinedMetrics({
  setMetricModalProps,
  afterArchive,
}: {
  setMetricModalProps?: (props: MetricModalState) => void;
  afterArchive?: (id: string, archived: boolean) => void;
}): MetricTableItem[] {
  const {
    _metricsIncludingArchived: inlineMetrics,
    _factMetricsIncludingArchived: factMetrics,
    mutateDefinitions,
  } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const { apiCall } = useAuth();

  const combinedMetrics = [
    ...inlineMetrics.map((m) => {
      const canDuplicate = permissionsUtil.canCreateMetric(m);
      const canEdit = permissionsUtil.canUpdateMetric(m, {});
      const canDelete = permissionsUtil.canDeleteMetric(m);

      const item: MetricTableItem = {
        id: m.id,
        managedBy: m.managedBy || "",
        archived: m.status === "archived",
        datasource: m.datasource || "",
        dateUpdated: m.dateUpdated,
        dateCreated: m.dateCreated,
        name: m.name,
        owner: m.owner || "",
        projects: m.projects || [],
        tags: m.tags || [],
        type: m.type,
        isRatio: !!m.denominator,
        canDuplicate,
        canEdit,
        onArchive: canEdit
          ? async (desiredState) => {
              const newStatus = desiredState ? "archived" : "active";
              await apiCall(`/metric/${m.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  status: newStatus,
                }),
              });

              mutateDefinitions();

              if (afterArchive) {
                afterArchive(m.id, desiredState);
              }
            }
          : undefined,
        onDuplicate:
          canDuplicate && setMetricModalProps
            ? () =>
                setMetricModalProps({
                  mode: "duplicate",
                  currentMetric: {
                    ...m,
                    name: m.name + " (copy)",
                  },
                })
            : undefined,
        onEdit:
          canEdit && setMetricModalProps
            ? () =>
                setMetricModalProps({
                  mode: "edit",
                  currentMetric: m,
                })
            : undefined,
        onDelete: canDelete
          ? async () => {
              await apiCall(`/metric/${m.id}`, {
                method: "DELETE",
              });

              mutateDefinitions();
            }
          : undefined,
      };
      return item;
    }),
    ...factMetrics.map((m) => {
      const canDuplicate = permissionsUtil.canCreateFactMetric(m);
      const canEdit = permissionsUtil.canUpdateFactMetric(m, {});
      const canDelete = permissionsUtil.canDeleteFactMetric(m);

      const item: MetricTableItem = {
        id: m.id,
        managedBy: m.managedBy || "",
        archived: !!m.archived,
        datasource: m.datasource,
        dateUpdated: m.dateUpdated,
        dateCreated: m.dateCreated,
        name: m.name,
        owner: m.owner,
        projects: m.projects || [],
        tags: m.tags || [],
        isRatio: m.metricType === "ratio",
        type: m.metricType,
        canDuplicate,
        canEdit,
        onArchive: canEdit
          ? async (archivedState) => {
              await apiCall(`/fact-metrics/${m.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  archived: archivedState,
                }),
              });

              mutateDefinitions();

              if (afterArchive) {
                afterArchive(m.id, archivedState);
              }
            }
          : undefined,
        onDuplicate:
          canDuplicate && setMetricModalProps
            ? () =>
                setMetricModalProps({
                  mode: "duplicate",
                  currentFactMetric: {
                    ...m,
                    name: m.name + " (copy)",
                  },
                })
            : undefined,
        onEdit:
          canEdit && setMetricModalProps
            ? () =>
                setMetricModalProps({
                  mode: "edit",
                  currentFactMetric: m,
                })
            : undefined,
        onDelete: canDelete
          ? async () => {
              await apiCall(`/fact-metrics/${m.id}`, {
                method: "DELETE",
              });

              mutateDefinitions();
            }
          : undefined,
      };
      return item;
    }),
  ];

  return combinedMetrics;
}

const MetricsList = (): React.ReactElement => {
  const [modalData, setModalData] = useState<MetricModalState | null>(null);

  const [
    showAutoGenerateMetricsModal,
    setShowAutoGenerateMetricsModal,
  ] = useState(false);

  const {
    getDatasourceById,
    mutateDefinitions,
    getProjectById,
    project,
    ready,
  } = useDefinitions();
  const { getUserDisplay } = useUser();

  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();

  const tagsFilter = useTagsFilter("metrics");

  const [showArchived, setShowArchived] = useState(false);
  const [recentlyArchived, setRecentlyArchived] = useState<Set<string>>(
    new Set()
  );

  const combinedMetrics = useCombinedMetrics({
    setMetricModalProps: setModalData,
    afterArchive: (id, archived) => {
      if (archived) {
        setRecentlyArchived((set) => new Set([...set, id]));
      } else {
        setRecentlyArchived((set) => new Set([...set].filter((i) => i !== id)));
      }
    },
  });

  const metrics = useAddComputedFields(
    combinedMetrics,
    (m) => ({
      projectNames: m.projects.map((p) => getProjectById(p)?.name || p),
      datasourceName: m.datasource
        ? getDatasourceById(m.datasource)?.name || "Unknown"
        : "None",
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

  const {
    items,
    unpaginatedItems,
    searchInputProps,
    isFiltered,
    SortableTH,
    pagination,
  } = useSearch({
    items: filteredMetrics,
    defaultSortField: "name",
    localStorageKey: "metrics",
    searchFields: ["name^3", "datasourceName", "ownerName", "tags", "type"],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [item.type];
        if (item.archived) is.push("archived");
        if (item.managedBy) is.push("official");
        if (isFactMetricId(item.id)) is.push("fact");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.projects?.length) has.push("project", "projects");
        if (item.tags?.length) has.push("tag", "tags");
        if (item.datasource) has.push("datasource");
        return has;
      },
      created: (item) => (item.dateCreated ? new Date(item.dateCreated) : null),
      updated: (item) => (item.dateUpdated ? new Date(item.dateUpdated) : null),
      name: (item) => item.name,
      id: (item) => item.id,
      owner: (item) => [item.owner, item.ownerName],
      type: (item) => {
        if (item.isRatio) return "ratio";
        if (["binomial", "proportion"].includes(item.type))
          return ["binomial", "proportion"];
        if (["duration", "revenue"].includes(item.type))
          return ["mean", item.type];
        if (["mean", "count"].includes(item.type)) return ["mean", "count"];
        return item.type;
      },
      tag: (item) => item.tags,
      project: (item) => [...item.projectNames, ...item.projects],
      datasource: (item) => [item.datasource, item.datasourceName],
    },
    filterResults,
    pageSize: 20,
  });

  if (!ready) {
    return <LoadingOverlay />;
  }

  const closeModal = () => {
    setModalData(null);
  };

  const hasArchivedMetrics = filteredMetrics.some((m) => m.archived);

  return (
    <div className="container-fluid pagecontents p-0">
      {modalData ? (
        <MetricModal {...modalData} close={closeModal} source="blank-state" />
      ) : null}
      {showAutoGenerateMetricsModal && (
        <AutoGenerateMetricsModal
          source="metric-index-page"
          setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
          mutate={mutateDefinitions}
        />
      )}
      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto d-flex">
          <div>
            Define what constitutes success and failure for your business.
          </div>
          <DocLink docSection="metrics" className="align-self-center ml-2 pb-1">
            View Docs
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
              <Button onClick={() => setModalData({ mode: "new" })}>
                Add Metric
              </Button>
            </div>
          )}
      </div>
      <div className="mt-4">
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
          <TagsFilter filter={tagsFilter} items={unpaginatedItems} />
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

            if (metric.onDuplicate && envAllowsCreatingMetrics()) {
              moreMenuLinks.push(
                <button
                  className="btn dropdown-item py-2"
                  onClick={(e) => {
                    e.preventDefault();
                    metric.onDuplicate && metric.onDuplicate();
                  }}
                >
                  Duplicate
                </button>
              );
            }

            if (!metric.managedBy && !metric.archived && metric.onEdit) {
              moreMenuLinks.push(
                <button
                  className="btn dropdown-item py-2"
                  onClick={(e) => {
                    e.preventDefault();
                    metric.onEdit?.();
                  }}
                >
                  Edit
                </button>
              );
            }

            if (!metric.managedBy && metric.onArchive) {
              moreMenuLinks.push(
                <button
                  className="btn dropdown-item py-2"
                  onClick={async (e) => {
                    e.preventDefault();
                    await metric.onArchive?.(!metric.archived);
                  }}
                >
                  {metric.archived ? "Unarchive" : "Archive"}
                </button>
              );
            }

            if (!metric.managedBy && metric.onDelete) {
              moreMenuLinks.push(
                <DeleteButton
                  className="dropdown-item text-danger"
                  onClick={async () => {
                    await metric.onDelete?.();
                  }}
                  displayName="Metric"
                  useIcon={false}
                  text="Delete"
                  canDelete={true}
                  disabled={false}
                />
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
                    useFlex={true}
                  />
                </td>
                <td className="col-2">
                  {metric && (metric.projects || []).length > 0 ? (
                    <ProjectBadges
                      resourceType="metric"
                      projectIds={metric.projects}
                    />
                  ) : (
                    <ProjectBadges resourceType="metric" />
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
      {pagination}
    </div>
  );
};

export default MetricsList;
