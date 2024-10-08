import React, { ReactElement, useCallback, useState } from "react";
import { FaArchive, FaRegCopy } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useRouter } from "next/router";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { getMetricLink, isFactMetricId } from "shared/experiments";
import { FactMetricInterface } from "back-end/types/fact-table";
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
import MetricForm from "@/components/Metrics/MetricForm";
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
}

export function useCombinedMetrics({
  duplicateMetric,
  editMetric,
  duplicateFactMetric,
  editFactMetric,
  afterArchive,
}: {
  duplicateMetric?: (m: MetricInterface) => void;
  editMetric?: (m: MetricInterface) => void;
  duplicateFactMetric?: (m: FactMetricInterface) => void;
  editFactMetric?: (m: FactMetricInterface) => void;
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
          canDuplicate && duplicateMetric
            ? () => duplicateMetric(m)
            : undefined,
        onEdit: canEdit && editMetric ? () => editMetric(m) : undefined,
      };
      return item;
    }),
    ...factMetrics.map((m) => {
      const canDuplicate = permissionsUtil.canCreateFactMetric(m);
      const canEdit = permissionsUtil.canUpdateFactMetric(m, {});

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
          canDuplicate && duplicateFactMetric
            ? () => duplicateFactMetric(m)
            : undefined,
        onEdit: canEdit && editFactMetric ? () => editFactMetric(m) : undefined,
      };
      return item;
    }),
  ];

  return combinedMetrics;
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
    project,
    ready,
  } = useDefinitions();
  const router = useRouter();

  const { getUserDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();

  const tagsFilter = useTagsFilter("metrics");

  const [showArchived, setShowArchived] = useState(false);
  const [recentlyArchived, setRecentlyArchived] = useState<Set<string>>(
    new Set()
  );

  const combinedMetrics = useCombinedMetrics({
    duplicateMetric: (m) => {
      setModalData({
        current: {
          ...m,
          name: m.name + " (copy)",
        },
        edit: false,
        duplicate: true,
      });
    },
    editMetric: (m) => {
      setModalData({
        current: m,
        edit: true,
        duplicate: false,
      });
    },
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

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
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
      project: (item) => item.projects,
      datasource: (item) => [item.datasource, item.datasourceName],
    },
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
                size="md"
              />
              <Button
                onClick={() => {
                  setModalData({
                    current: {},
                    edit: false,
                    duplicate: false,
                  });
                }}
              >
                Add your first Metric
              </Button>
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
              <Button
                onClick={() => {
                  setModalData({
                    current: {},
                    edit: false,
                    duplicate: false,
                  });
                }}
              >
                Add Metric
              </Button>
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

            if (metric.onDuplicate && envAllowsCreatingMetrics()) {
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

            if (!metric.managedBy && metric.onArchive) {
              moreMenuLinks.push(
                <button
                  className="btn dropdown-item py-2"
                  onClick={async (e) => {
                    e.preventDefault();
                    await metric.onArchive?.(!metric.archived);
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
                    useFlex={true}
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
