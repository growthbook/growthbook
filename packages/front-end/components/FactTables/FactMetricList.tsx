import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import React, { useState } from "react";
import { date } from "shared/dates";
import { IconButton, Text } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import Link from "@/ui/Link";
import { tagLinkProps, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import SortedTags from "@/components/Tags/SortedTags";
import MetricName from "@/components/Metrics/MetricName";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import Switch from "@/ui/Switch";
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
import FactMetricModal from "./FactMetricModal";

function FactMetricRowMenu({
  metric,
  canEdit,
  canDelete,
  canDuplicate,
  onEdit,
  onDuplicate,
}: {
  metric: FactMetricInterface;
  canEdit: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

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
        {canEdit && (
          <DropdownMenuItem
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
          >
            Edit
          </DropdownMenuItem>
        )}
        {canDuplicate && (
          <DropdownMenuItem
            onClick={() => {
              onDuplicate();
              setOpen(false);
            }}
          >
            Duplicate
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

  const { _factMetricsIncludingArchived: factMetrics } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const metrics =
    providedMetrics ||
    factMetrics.filter(
      (m) =>
        m.numerator.factTableId === factTable.id ||
        (m.denominator && m.denominator.factTableId === factTable.id),
    );
  const hasArchivedMetrics = factMetrics.some((m) => m.archived);

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

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: (showArchived
        ? metrics
        : metrics.filter((m) => !m.archived) || []
      ).map((metric) => {
        // Calculate numAutoSlices for sorting
        const numAutoSlices = factTable.columns.filter(
          (col) =>
            col.isAutoSliceColumn &&
            !col.deleted &&
            metric.metricAutoSlices?.includes(col.column),
        ).length;
        return {
          ...metric,
          numAutoSlices,
        };
      }),
      defaultSortField: "name",
      localStorageKey: "factmetrics",
      searchFields: ["name^3", "description"],
      pageSize: 10,
    });

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
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowRecommendedMetricsModal(true);
            }}
          >
            View Recommendation{recommendedMetrics.length === 1 ? "" : "s"}
          </a>
        </Callout>
      )}

      <div className="row align-items-center">
        {metrics.length > 0 && (
          <div className="col-auto">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
        )}
        {hasArchivedMetrics && (
          <Switch
            value={showArchived}
            onChange={setShowArchived}
            id="show-archived"
            label="Show archived"
            ml="2"
          />
        )}
        <div className="col-auto ml-auto">
          <Tooltip
            body={
              canCreateMetrics
                ? ""
                : `You don't have permission to add metrics to this fact table`
            }
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
        </div>
      </div>
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
                                  body={
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
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        clear();
                      }}
                    >
                      Clear search field
                    </a>
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
