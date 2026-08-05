import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { getMetricLink, isFactMetricId } from "shared/experiments";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaArchive } from "react-icons/fa";
import { startCase } from "lodash";
import SortedTags from "@/components/Tags/SortedTags";
import {
  tagFilterOnClick,
  tagLinkProps,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { DocLink } from "@/components/DocLink";
import { useUser } from "@/services/UserContext";
import { envAllowsCreatingMetrics } from "@/services/env";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import AutoGenerateMetricsModal from "@/components/AutoGenerateMetricsModal";
import AutoGenerateMetricsButton from "@/components/AutoGenerateMetricsButton";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import Tooltip from "@/ui/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/ui/Button";
import {
  MetricModal,
  MetricModalState,
} from "@/components/FactTables/NewMetricModal";
import MetricSearchFilters from "@/components/Search/MetricSearchFilters";
import PremiumCallout from "@/ui/PremiumCallout";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import LinkButton from "@/ui/LinkButton";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  isMergeAggregationMetric,
  REST_API_ONLY_EDIT_MESSAGE,
} from "@/services/factMetrics";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

function MetricRowMenu({ metric }: { metric: MetricTableItem }) {
  const [open, setOpen] = useState(false);

  const canDuplicate =
    !!metric.onDuplicate && envAllowsCreatingMetrics() && metric.canDuplicate;
  const canEditMenu =
    metric.canEdit &&
    !metric.archived &&
    !metric.editDisabledReason &&
    !!metric.onEdit;
  const canShowDisabledEdit =
    metric.canEdit && !metric.archived && !!metric.editDisabledReason;
  const canArchive = metric.canEdit && !!metric.onArchive;
  const canDelete = metric.canDelete && !!metric.onDelete;

  if (
    !canDuplicate &&
    !canEditMenu &&
    !canShowDisabledEdit &&
    !canArchive &&
    !canDelete
  ) {
    return null;
  }

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
        >
          <BsThreeDotsVertical size={16} />
        </IconButton>
      }
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
    >
      <DropdownMenuGroup>
        {(canEditMenu || canShowDisabledEdit) && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              metric.onEdit?.();
            }}
            disabled={!!metric.editDisabledReason}
          >
            <Tooltip
              content={metric.editDisabledReason}
              enabled={!!metric.editDisabledReason}
            >
              <span>Edit</span>
            </Tooltip>
          </DropdownMenuItem>
        )}
        {canDuplicate && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              metric.onDuplicate?.();
            }}
            disabled={!!metric.editDisabledReason}
          >
            <Tooltip
              content={metric.editDisabledReason}
              enabled={!!metric.editDisabledReason}
            >
              <span>Duplicate</span>
            </Tooltip>
          </DropdownMenuItem>
        )}
        {canArchive && (
          <DropdownMenuItem
            onClick={async () => {
              setOpen(false);
              await metric.onArchive?.(!metric.archived);
            }}
          >
            {metric.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              color="red"
              confirmation={{
                confirmationTitle: "Delete Metric",
                cta: "Delete",
                submit: async () => {
                  await metric.onDelete?.();
                },
                closeDropdown: () => setOpen(false),
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenu>
  );
}

export interface MetricTableItem {
  id: string;
  managedBy: "" | "api" | "config" | "admin";
  name: string;
  description?: string;
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
  canDelete: boolean;
  editDisabledReason?: string;
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
      const canDuplicate = permissionsUtil.canCreateMetric({
        // Don't pass in managedBy as we allow non-admins to duplicate official metrics - the duplicated metric will be non-official
        projects: m.projects,
      });
      let canEdit = permissionsUtil.canUpdateMetric(m, {});
      let canDelete = permissionsUtil.canDeleteMetric(m);

      // Additional check if managed by api or config
      if (m.managedBy && ["api", "config"].includes(m.managedBy)) {
        canEdit = false;
        canDelete = false;
      }

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
        canDelete,
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
                    // If managedBy is admin, only copy that over if the user has the ManageOfficialResources policy
                    managedBy:
                      m.managedBy === "admin" &&
                      permissionsUtil.canCreateOfficialResources(m)
                        ? "admin"
                        : "",
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
      const canDuplicate = permissionsUtil.canCreateFactMetric({
        projects: m.projects,
      });
      let canEdit = permissionsUtil.canUpdateFactMetric(m, {});
      let canDelete = permissionsUtil.canDeleteFactMetric(m);

      if (m.managedBy && ["admin", "api"].includes(m.managedBy)) {
        canEdit = false;
        canDelete = false;
      }

      const item: MetricTableItem = {
        id: m.id,
        managedBy: m.managedBy || "",
        archived: !!m.archived,
        datasource: m.datasource,
        dateUpdated: m.dateUpdated,
        dateCreated: m.dateCreated,
        name: m.name,
        description: m.description,
        owner: m.owner,
        projects: m.projects || [],
        tags: m.tags || [],
        isRatio: m.metricType === "ratio",
        type: m.metricType,
        canDuplicate,
        canEdit,
        canDelete,
        editDisabledReason: isMergeAggregationMetric(m)
          ? REST_API_ONLY_EDIT_MESSAGE
          : undefined,
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

  const [showAutoGenerateMetricsModal, setShowAutoGenerateMetricsModal] =
    useState(false);

  const {
    getDatasourceById,
    mutateDefinitions,
    getProjectById,
    metricGroups,
    project,
    factTables,
    metrics: legacyMetrics,
    ready,
  } = useDefinitions();
  const { getOwnerDisplay } = useUser();
  const { demoDataSourceId } = useDemoDataSourceProject();

  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const { disableLegacyMetricCreation } = settings;

  const [showArchived, setShowArchived] = useState(false);
  const combinedMetrics = useCombinedMetrics({
    setMetricModalProps: setModalData,
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
      ownerName: getOwnerDisplay(m.owner),
    }),
    [getDatasourceById, getOwnerDisplay],
  );
  const filteredMetrics = project
    ? metrics.filter((m) => isProjectListValidForProject(m.projects, project))
    : metrics;

  const hasLegacyMetrics = legacyMetrics.some(
    (f) =>
      isProjectListValidForProject(f.projects, project) &&
      f.datasource !== demoDataSourceId,
  ); // Don't factor in demo datasource metrics

  const hasFactTables = factTables.some((f) =>
    isProjectListValidForProject(f.projects, project),
  );

  // Show the create fact table button if there are no legacy metrics and no fact tables
  // If disableLegacyMetricCreation is true, show the create fact table button if there are no fact tables
  const showCreateFactTableButton = disableLegacyMetricCreation
    ? !hasFactTables
    : !hasLegacyMetrics && !hasFactTables;

  //searching:
  const filterResults = useCallback(
    (items: typeof filteredMetrics) => {
      if (!showArchived) {
        items = items.filter((m) => {
          return !m.archived;
        });
      }
      return items;
    },
    [showArchived],
  );
  const {
    items,
    searchInputProps,
    isFiltered,
    syntaxFilters,
    setSearchValue,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: filteredMetrics,
    defaultSortField: "name",
    localStorageKey: "metrics",
    searchFields: ["name^3", "description"],
    updateSearchQueryOnChange: true,
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
      description: (item) => item.description,
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
  // watch to see if we should include archived features or not:
  useEffect(() => {
    const isArchivedFilter = syntaxFilters.some(
      (filter) =>
        filter.field === "is" &&
        !filter.negated &&
        filter.values.includes("archived"),
    );
    setShowArchived(isArchivedFilter);
  }, [syntaxFilters]);

  if (!ready) {
    return <LoadingOverlay />;
  }

  const closeModal = () => {
    setModalData(null);
  };

  return (
    <Box>
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
      <Flex
        className="filters md-form"
        mb="3"
        align="center"
        gap="3"
        wrap="wrap"
      >
        <Flex align="center" gap="2">
          <div>
            Define what constitutes success and failure for your business.
          </div>
          <DocLink
            useRadix={false}
            docSection="metrics"
            className="align-self-center pb-1"
          >
            View Docs
          </DocLink>
        </Flex>
        <Box style={{ flex: 1 }} />
        {envAllowsCreatingMetrics() && !showCreateFactTableButton ? (
          <Flex gap="2">
            <AutoGenerateMetricsButton
              setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
            />
            <Tooltip
              content="You don't have permission to add metrics in this project."
              enabled={
                !permissionsUtil.canCreateMetric({ projects: [project] })
              }
            >
              <Button
                disabled={
                  !permissionsUtil.canCreateMetric({ projects: [project] })
                }
                onClick={() => setModalData({ mode: "new" })}
              >
                Add Metric
              </Button>
            </Tooltip>
          </Flex>
        ) : permissionsUtil.canCreateFactTable({ projects: [project] }) ? (
          <Box>
            <LinkButton href="/fact-tables">Create Fact Table</LinkButton>
          </Box>
        ) : null}
      </Flex>
      <Box mt="4">
        <CustomMarkdown page={"metricList"} />
      </Box>
      <Flex justify="between" mb="3" gap="3" align="center">
        <Box className="relative" width="40%">
          <Field
            size="legacy"
            placeholder="Search..."
            type="search"
            {...searchInputProps}
          />
        </Box>
        <MetricSearchFilters
          combinedMetrics={combinedMetrics}
          searchInputProps={searchInputProps}
          setSearchValue={setSearchValue}
          syntaxFilters={syntaxFilters}
        />
      </Flex>
      {metrics.length > 4 && !metricGroups.length ? (
        <PremiumCallout
          commercialFeature="metric-groups"
          dismissible={true}
          id="metrics-list-metric-group-promo"
          docSection="metricGroups"
          mb="2"
        >
          <strong>Metric Groups</strong> help you organize and manage your
          metrics at scale.
        </PremiumCallout>
      ) : null}
      <Table variant="list" stickyHeader roundedCorners className="appbox">
        <TableHeader>
          <TableRow>
            <TableColumnHeader
              style={{
                paddingInline: "var(--space-2)",
              }}
            >
              <span className="sr-only">Official</span>
            </TableColumnHeader>
            <SortableTableColumnHeader field="name">
              Metric Name
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="type">
              Type
            </SortableTableColumnHeader>
            <TableColumnHeader>Projects</TableColumnHeader>
            <TableColumnHeader>Tags</TableColumnHeader>
            <SortableTableColumnHeader
              field="dateUpdated"
              className="d-none d-md-table-cell"
            >
              Last Updated
            </SortableTableColumnHeader>
            <TableColumnHeader />
            <TableColumnHeader
              style={{
                paddingInline: "var(--space-2)",
              }}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((metric) => {
            return (
              <TableRow
                key={metric.id}
                onClick={(e) => {
                  // If clicking on a link or button, default to browser behavior
                  if (
                    e.target instanceof HTMLElement &&
                    e.target.closest("a, button")
                  ) {
                    return;
                  }

                  // If cmd/ctrl/shift+click, open in new tab
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
                    window.open(getMetricLink(metric.id), "_blank");
                    return;
                  }

                  // Otherwise, navigate to the metric
                  e.preventDefault();
                  router.push(getMetricLink(metric.id));
                }}
                style={{
                  cursor: "pointer",
                  color: metric.archived ? "var(--gray-11)" : undefined,
                }}
              >
                <TableCell
                  style={{
                    maxWidth: 36,
                    textAlign: "center",
                    verticalAlign: "middle",
                    whiteSpace: "nowrap",
                    paddingInline: "var(--space-4)",
                    paddingBlock: "var(--space-2)",
                    boxSizing: "border-box",
                    lineHeight: 1,
                  }}
                >
                  <Box
                    style={{
                      display: "inline-flex",
                      justifyContent: "center",
                      maxWidth: "100%",
                      marginRight: -3,
                    }}
                  >
                    <OfficialBadge
                      type="metric"
                      managedBy={metric.managedBy || ""}
                    />
                  </Box>
                </TableCell>
                <TableCell>
                  <Link
                    href={getMetricLink(metric.id)}
                    style={{
                      color: metric.archived
                        ? "var(--gray-11)"
                        : "var(--gray-12)",
                    }}
                  >
                    {metric.name}
                  </Link>
                </TableCell>
                <TableCell>{startCase(metric.type)}</TableCell>
                <TableCell>
                  {metric.projectNames.length === 0
                    ? null
                    : metric.projectNames.join(", ")}
                </TableCell>
                <TableCell>
                  <SortedTags
                    tags={metric.tags ? Object.values(metric.tags) : []}
                    shouldShowEllipsis={true}
                    useFlex={true}
                    {...tagLinkProps("metrics")}
                    onTagClick={tagFilterOnClick(
                      searchInputProps.value,
                      setSearchValue,
                    )}
                  />
                </TableCell>
                <TableCell
                  title={datetime(metric.dateUpdated || "")}
                  className="d-none d-md-table-cell"
                >
                  {metric.managedBy === "config"
                    ? ""
                    : date(metric.dateUpdated || "")}
                </TableCell>
                <TableCell style={{ color: "var(--gray-11)" }}>
                  {metric.archived && (
                    <Tooltip content="Archived">
                      <FaArchive />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell
                  style={{
                    width: "1%",
                    cursor: "initial",
                    textAlign: "right",
                    verticalAlign: "middle",
                    whiteSpace: "nowrap",
                    paddingInline: "var(--space-2)",
                    boxSizing: "border-box",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <MetricRowMenu metric={metric} />
                </TableCell>
              </TableRow>
            );
          })}

          {!items.length && isFiltered && (
            <TableRow>
              <TableCell colSpan={8} style={{ textAlign: "center" }}>
                No matching metrics
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pagination}
    </Box>
  );
};

export default MetricsList;
