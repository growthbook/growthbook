import React, { useCallback, useState } from "react";
import { FaArchive, FaPlus, FaRegCopy } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useRouter } from "next/router";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { getMetricLink } from "shared/experiments";
import { Table } from "@radix-ui/themes";
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
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import { checkMetricProjectPermissions } from "@/services/metrics";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useAuth } from "@/services/auth";
import AutoGenerateMetricsModal from "@/components/AutoGenerateMetricsModal";
import AutoGenerateMetricsButton from "@/components/AutoGenerateMetricsButton";
import FactBadge from "@/components/FactTables/FactBadge";

interface MetricTableItem {
  id: string;
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
    metrics: inlineMetrics,
    factMetrics,
    project,
    ready,
  } = useDefinitions();
  const router = useRouter();

  const { getUserDisplay } = useUser();

  const permissions = usePermissions();
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

  const hasArchivedMetrics = filteredMetrics.find((m) => m.archived);

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
      </div>

      <Table.Root variant="surface" size="1">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Tags</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Projects</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Owner</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Data Source</Table.ColumnHeaderCell>
            {!hasFileConfig() && (
              <Table.ColumnHeaderCell>Last Updated</Table.ColumnHeaderCell>
            )}
            <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {items.map((metric) => (
            <Table.Row
              key={metric.id}
              onClick={(e) => {
                e.preventDefault();
                router.push(getMetricLink(metric.id));
              }}
              style={{ cursor: "pointer" }}
              className={metric.archived ? "text-muted" : ""}
            >
              <Table.Cell>
                <Link href={getMetricLink(metric.id)}>
                  <a
                    className={`${
                      metric.archived ? "text-muted" : "text-dark"
                    } font-weight-bold`}
                  >
                    {metric.name}
                  </a>
                </Link>
                <FactBadge metricId={metric.id} />
              </Table.Cell>
              <Table.Cell>{metric.type}</Table.Cell>

              <Table.Cell>
                <SortedTags
                  tags={metric.tags ? Object.values(metric.tags) : []}
                  shouldShowEllipsis={true}
                />
              </Table.Cell>
              <Table.Cell className="col-2">
                {metric && (metric.projects || []).length > 0 ? (
                  <ProjectBadges
                    projectIds={metric.projects}
                    className="badge-ellipsis short align-middle"
                  />
                ) : (
                  <ProjectBadges className="badge-ellipsis short align-middle" />
                )}
              </Table.Cell>
              <Table.Cell>{metric.owner}</Table.Cell>
              <Table.Cell className="d-none d-lg-table-cell">
                {metric.datasourceName}
                {metric.datasourceDescription && (
                  <div
                    className="text-gray font-weight-normal small text-ellipsis"
                    style={{ maxWidth: 350 }}
                  >
                    {metric.datasourceDescription}
                  </div>
                )}
              </Table.Cell>
              {!hasFileConfig() && (
                <Table.Cell
                  title={datetime(metric.dateUpdated || "")}
                  className="d-none d-md-table-cell"
                >
                  {ago(metric.dateUpdated || "")}
                </Table.Cell>
              )}
              <Table.Cell className="text-muted">
                {metric.archived && (
                  <Tooltip
                    body={"Archived"}
                    innerClassName="p-2"
                    tipMinWidth="auto"
                  >
                    <FaArchive />
                  </Tooltip>
                )}
              </Table.Cell>
              <Table.Cell
                style={{ cursor: "initial" }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <MoreMenu>
                  {!hasFileConfig() &&
                    metric.onDuplicate &&
                    editMetricsPermissions[metric.id] && (
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
                    )}
                  {!hasFileConfig() &&
                    metric.onArchive &&
                    editMetricsPermissions[metric.id] && (
                      <button
                        className="btn dropdown-item py-2"
                        onClick={async (e) => {
                          e.preventDefault();
                          metric.onArchive &&
                            (await metric.onArchive(!metric.archived));
                          mutateDefinitions({});
                        }}
                      >
                        <FaArchive />{" "}
                        {metric.archived ? "Unarchive" : "Archive"}
                      </button>
                    )}
                </MoreMenu>
              </Table.Cell>
            </Table.Row>
          ))}

          {!items.length && (isFiltered || tagsFilter.tags.length > 0) && (
            <Table.Row>
              <Table.Cell colSpan={!hasFileConfig() ? 5 : 4} align={"center"}>
                No matching metrics
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table.Root>
    </div>
  );
};

export default MetricsPage;
