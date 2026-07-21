import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { date } from "shared/dates";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import Link from "@/ui/Link";
import {
  filterSearchTerm,
  tagLinkProps,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/ui/Tooltip";
import SortedTags from "@/components/Tags/SortedTags";
import MetricName from "@/components/Metrics/MetricName";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import FactMetricSearchFilters from "@/components/Search/FactMetricSearchFilters";
import RecommendedFactMetricsModal, {
  getRecommendedFactMetrics,
} from "@/components/FactTables/RecommendedFactMetricsModal";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import {
  isMergeAggregationMetric,
  REST_API_ONLY_EDIT_MESSAGE,
} from "@/services/factMetrics";
import FactMetricModal from "./FactMetricModal";

function FactMetricRowMenu({
  metric,
  canEdit,
  canDelete,
  canDuplicate,
  onEdit,
  onDuplicate,
  editDisabledReason,
}: {
  metric: FactMetricInterface;
  canEdit: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  editDisabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const canEditMenu =
    canEdit && !metric.archived && !editDisabledReason && !!onEdit;
  const canShowDisabledEdit =
    canEdit && !metric.archived && !!editDisabledReason;
  // Duplicate uses the same FactMetricModal as Edit, so anything that locks
  // editing to the REST API also has to lock Duplicate — otherwise a user
  // could open a half-broken modal pre-filled with values the picker can no
  // longer represent.
  const canDuplicateMenu = canDuplicate && !editDisabledReason;
  const canShowDisabledDuplicate = canDuplicate && !!editDisabledReason;

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
              onEdit();
              setOpen(false);
            }}
            disabled={canShowDisabledEdit}
          >
            <Tooltip content={editDisabledReason} enabled={canShowDisabledEdit}>
              <span>Edit</span>
            </Tooltip>
          </DropdownMenuItem>
        )}
        {(canDuplicateMenu || canShowDisabledDuplicate) && (
          <DropdownMenuItem
            onClick={() => {
              onDuplicate();
              setOpen(false);
            }}
            disabled={canShowDisabledDuplicate}
          >
            <Tooltip
              content={editDisabledReason}
              enabled={canShowDisabledDuplicate}
            >
              <span>Duplicate</span>
            </Tooltip>
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem
            onClick={async () => {
              await apiCall(`/fact-metrics/${metric.id}`, {
                method: "PUT",
                body: JSON.stringify({ archived: !metric.archived }),
              });
              mutateDefinitions();
              setOpen(false);
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
                  await apiCall(`/fact-metrics/${metric.id}`, {
                    method: "DELETE",
                  });
                  mutateDefinitions();
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

export interface Props {
  factTable: FactTableInterface;
  metrics?: FactMetricInterface[];
}

export default function FactMetricList({
  factTable,
  metrics: providedMetrics,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { _factMetricsIncludingArchived: factMetrics, getProjectById } =
    useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, getOwnerDisplay } = useUser();

  const metrics = useMemo(
    () =>
      providedMetrics ||
      factMetrics.filter(
        (m) =>
          m.numerator.factTableId === factTable.id ||
          (m.denominator && m.denominator.factTableId === factTable.id),
      ),
    [providedMetrics, factMetrics, factTable.id],
  );

  const shouldShowSliceAnalysisColumn =
    hasCommercialFeature("metric-slices") &&
    factTable.columns.some((col) => col.isAutoSliceColumn && !col.deleted);

  const [editMetric, setEditMetric] = useState<
    FactMetricInterface | undefined
  >();
  const [duplicateMetric, setDuplicateMetric] = useState<
    FactMetricInterface | undefined
  >();

  const canEdit = (factMetric: FactMetricInterface) => {
    let canEdit = permissionsUtil.canUpdateFactMetric(factMetric, {});
    if (
      factMetric.managedBy &&
      ["api", "config"].includes(factMetric.managedBy)
    ) {
      canEdit = false;
    }
    return canEdit;
  };
  const canDelete = (factMetric: FactMetricInterface) => {
    let canDelete = permissionsUtil.canDeleteFactMetric(factMetric);
    if (
      factMetric.managedBy &&
      ["api", "config"].includes(factMetric.managedBy)
    ) {
      canDelete = false;
    }
    return canDelete;
  };

  const searchItems = useAddComputedFields(
    metrics,
    (metric) => ({
      // Calculate numAutoSlices for sorting
      numAutoSlices: factTable.columns.filter(
        (col) =>
          col.isAutoSliceColumn &&
          !col.deleted &&
          metric.metricAutoSlices?.includes(col.column),
      ).length,
      ownerName: getOwnerDisplay(metric.owner),
      projectNames: metric.projects.map((p) => getProjectById(p)?.name || p),
    }),
    [factTable.columns, getOwnerDisplay, getProjectById],
  );

  const filterResults = useCallback(
    (items: typeof searchItems) => {
      if (!showArchived) {
        items = items.filter((m) => !m.archived);
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
    SortableTH,
    clear,
    pagination,
  } = useSearch({
    items: searchItems,
    defaultSortField: "name",
    localStorageKey: "factmetrics",
    searchFields: ["name^3", "description"],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.managedBy) is.push("official");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.projects?.length) has.push("project", "projects");
        if (item.tags?.length) has.push("tag", "tags");
        return has;
      },
      created: (item) => (item.dateCreated ? new Date(item.dateCreated) : null),
      updated: (item) => (item.dateUpdated ? new Date(item.dateUpdated) : null),
      name: (item) => item.name,
      description: (item) => item.description,
      id: (item) => item.id,
      owner: (item) => [item.owner, item.ownerName],
      type: (item) => item.metricType,
      tag: (item) => item.tags,
      project: (item) => [...item.projectNames, ...item.projects],
    },
    filterResults,
    pageSize: 10,
  });

  // Include archived metrics in the list whenever an `is:archived` filter is
  // present, since they are otherwise hidden before filtering. Match with
  // filterSearchTerm so operator/case variants (`is:~arch`, `is:Archived`)
  // reveal archived items the same way they filter them.
  useEffect(() => {
    const isArchivedFilter = syntaxFilters.some(
      (filter) =>
        filter.field === "is" &&
        !filter.negated &&
        filter.values.some((v) =>
          filterSearchTerm("archived", filter.operator, v),
        ),
    );
    setShowArchived(isArchivedFilter);
  }, [syntaxFilters]);

  const canCreateMetrics = permissionsUtil.canCreateFactMetric({
    projects: factTable.projects,
  });

  const recommendedMetrics = getRecommendedFactMetrics(factTable, metrics);
  const [showRecommendedMetricsModal, setShowRecommendedMetricsModal] =
    useState(false);

  return (
    <>
      {editMetric && (
        <FactMetricModal
          close={() => setEditMetric(undefined)}
          existing={editMetric}
          source="fact-metric"
        />
      )}
      {newOpen && (
        <FactMetricModal
          close={() => setNewOpen(false)}
          initialFactTable={factTable.id}
          source="fact-table"
        />
      )}
      {duplicateMetric && (
        <FactMetricModal
          close={() => setDuplicateMetric(undefined)}
          existing={duplicateMetric}
          duplicate
          source="fact-table-duplicate"
        />
      )}
      {showRecommendedMetricsModal && (
        <RecommendedFactMetricsModal
          factTable={factTable}
          metrics={recommendedMetrics}
          close={() => setShowRecommendedMetricsModal(false)}
        />
      )}

      {recommendedMetrics.length > 0 && canCreateMetrics && (
        <Callout status="info" mt="2" mb="4">
          There {recommendedMetrics.length === 1 ? "is" : "are"}{" "}
          <strong>{recommendedMetrics.length}</strong> metric
          {recommendedMetrics.length === 1 ? "" : "s"} we recommend creating for
          this fact table.{" "}
          <Link onClick={() => setShowRecommendedMetricsModal(true)}>
            View Recommendation{recommendedMetrics.length === 1 ? "" : "s"}
          </Link>
        </Callout>
      )}

      <Flex align="center" gap="3" wrap="wrap">
        {metrics.length > 0 && (
          <>
            <Box width={{ initial: "100%", sm: "auto" }}>
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <FactMetricSearchFilters
              factMetrics={metrics}
              searchInputProps={searchInputProps}
              setSearchValue={setSearchValue}
              syntaxFilters={syntaxFilters}
            />
          </>
        )}
        <Box ml="auto">
          <Tooltip
            content={`You don't have permission to add metrics to this fact table`}
            enabled={!canCreateMetrics}
          >
            <Button
              onClick={() => {
                if (!canCreateMetrics) return;
                setNewOpen(true);
              }}
              disabled={!canCreateMetrics}
            >
              Add Metric
            </Button>
          </Tooltip>
        </Box>
      </Flex>
      {metrics.length > 0 && (
        <>
          <table className="table appbox gbtable mt-2 mb-0 table-hover">
            <thead>
              <tr className="cursor-pointer">
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="metricType">Type</SortableTH>
                {shouldShowSliceAnalysisColumn && (
                  <SortableTH field="numAutoSlices" style={{}}>
                    Auto Slices
                    <PaidFeatureBadge
                      commercialFeature="metric-slices"
                      premiumText="This is an Enterprise feature"
                      variant="outline"
                      ml="2"
                    />
                  </SortableTH>
                )}
                <SortableTH field="tags">Tags</SortableTH>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((metric) => (
                <tr key={metric.id}>
                  <td>
                    <Link
                      href={`/fact-metrics/${metric.id}`}
                      className="font-weight-bold"
                      title="View Metric"
                    >
                      <MetricName id={metric.id} />
                    </Link>
                  </td>
                  <td>
                    <FactMetricTypeDisplayName type={metric.metricType} />
                  </td>
                  {shouldShowSliceAnalysisColumn && (
                    <td>
                      <div
                        className="d-flex flex-wrap"
                        style={{ gap: "0.25rem" }}
                      >
                        {metric.metricAutoSlices?.filter((slice) => {
                          const column = factTable.columns?.find(
                            (c) => c.column === slice,
                          );
                          return column && !column.deleted;
                        }).length ? (
                          metric.metricAutoSlices?.map((slice, i) => {
                            const column = factTable.columns?.find(
                              (col) => col.column === slice,
                            );
                            if (!column || column.deleted) return null;

                            const levels =
                              column?.datatype === "boolean"
                                ? ["true", "false"]
                                : column?.autoSlices;
                            const hasNoLevels =
                              !levels?.length && column?.datatype !== "boolean";

                            return (
                              <span
                                key={slice}
                                style={{ whiteSpace: "nowrap" }}
                              >
                                <Tooltip
                                  content={
                                    hasNoLevels
                                      ? "No slice levels configured"
                                      : levels?.join(", ") || "No levels"
                                  }
                                >
                                  <Text
                                    weight="medium"
                                    size="1"
                                    color={hasNoLevels ? "red" : undefined}
                                  >
                                    {column?.name || slice}
                                  </Text>
                                </Tooltip>
                                {i < metric.metricAutoSlices!.length - 1 &&
                                  ", "}
                              </span>
                            );
                          })
                        ) : (
                          <Text
                            as="span"
                            style={{
                              color: "var(--color-text-low)",
                              fontStyle: "italic",
                            }}
                            size="1"
                          >
                            No auto slices
                          </Text>
                        )}
                      </div>
                    </td>
                  )}
                  <td>
                    <SortedTags
                      tags={metric.tags}
                      useFlex={true}
                      {...tagLinkProps("metrics")}
                    />
                  </td>
                  <td>
                    {metric.dateUpdated ? date(metric.dateUpdated) : null}
                  </td>
                  <td>
                    <FactMetricRowMenu
                      metric={metric}
                      canEdit={canEdit(metric)}
                      canDelete={canDelete(metric)}
                      canDuplicate={canCreateMetrics}
                      onEdit={() => setEditMetric(metric)}
                      editDisabledReason={
                        isMergeAggregationMetric(metric)
                          ? REST_API_ONLY_EDIT_MESSAGE
                          : undefined
                      }
                      onDuplicate={() =>
                        setDuplicateMetric({
                          ...metric,
                          name: `${metric.name} (Copy)`,
                          managedBy:
                            metric.managedBy === "admin" &&
                            permissionsUtil.canCreateOfficialResources(metric)
                              ? "admin"
                              : "",
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={5} align={"center"}>
                    No matching metrics.{" "}
                    <Link onClick={() => clear()}>Clear search field</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {pagination}
        </>
      )}
    </>
  );
}
