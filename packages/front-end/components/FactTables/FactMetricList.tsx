import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { useState } from "react";
import Link from "next/link";
import { date } from "shared/dates";
import { Switch } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import SortedTags from "@/components/Tags/SortedTags";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import RecommendedFactMetricsModal, {
  getRecommendedFactMetrics,
} from "@/components/FactTables/RecommendedFactMetricsModal";
import { useUser } from "@/services/UserContext";
import { AppFeatures } from "@/types/app-features";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import FactMetricModal from "./FactMetricModal";

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

  const { apiCall } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const { _factMetricsIncludingArchived: factMetrics, mutateDefinitions } =
    useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();

  const metrics =
    providedMetrics ||
    factMetrics.filter(
      (m) =>
        m.numerator.factTableId === factTable.id ||
        (m.denominator && m.denominator.factTableId === factTable.id),
    );
  const hasArchivedMetrics = factMetrics.some((m) => m.archived);

  const isMetricDimensionsFeatureEnabled =
    growthbook?.isOn("metric-dimensions");
  const hasMetricDimensionsFeature = hasCommercialFeature("metric-dimensions");
  const shouldShowDimensionAnalysisColumn =
    isMetricDimensionsFeatureEnabled &&
    factTable.columns.some((col) => col.isDimension && !col.deleted);

  const [editMetric, setEditMetric] = useState<
    FactMetricInterface | undefined
  >();
  const [duplicateMetric, setDuplicateMetric] = useState<
    FactMetricInterface | undefined
  >();

  const canEdit = (factMetric: FactMetricInterface) =>
    permissionsUtil.canUpdateFactMetric(factMetric, {}) &&
    !factMetric.managedBy;

  const canDelete = (factMetric: FactMetricInterface) =>
    permissionsUtil.canDeleteFactMetric(factMetric) && !factMetric.managedBy;

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: showArchived ? metrics : metrics.filter((m) => !m.archived) || [],
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
          <div className="col-auto text-muted">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived
          </div>
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
                {shouldShowDimensionAnalysisColumn && (
                  <th>
                    Enable Dimensions
                    {!hasMetricDimensionsFeature && (
                      <PaidFeatureBadge
                        commercialFeature="metric-dimensions"
                        premiumText="This is an Enterprise feature"
                        variant="outline"
                        ml="2"
                      />
                    )}
                  </th>
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
                  <td>{metric.metricType}</td>
                  {shouldShowDimensionAnalysisColumn && (
                    <td>
                      <Switch
                        checked={metric.enableMetricDimensions || false}
                        onCheckedChange={async (checked) => {
                          await apiCall(`/fact-metrics/${metric.id}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              enableMetricDimensions: checked,
                            }),
                          });
                          if (checked) {
                            track("dimensions-on-for-metric");
                          } else if (!checked) {
                            track("dimensions-off-for-metric");
                          }
                          mutateDefinitions();
                        }}
                        disabled={
                          !canEdit(metric) || !hasMetricDimensionsFeature
                        }
                      />
                    </td>
                  )}
                  <td>
                    <SortedTags tags={metric.tags} useFlex={true} />
                  </td>
                  <td>
                    {metric.dateUpdated ? date(metric.dateUpdated) : null}
                  </td>
                  <td>
                    <MoreMenu>
                      {canEdit(metric) && (
                        <button
                          className="btn dropdown-item"
                          onClick={() => setEditMetric(metric)}
                        >
                          Edit
                        </button>
                      )}
                      {canCreateMetrics && (
                        <button
                          className="btn dropdown-item"
                          onClick={() =>
                            setDuplicateMetric({
                              ...metric,
                              name: `${metric.name} (Copy)`,
                            })
                          }
                        >
                          Duplicate
                        </button>
                      )}
                      {canEdit(metric) && (
                        <button
                          className="btn dropdown-item"
                          onClick={async () => {
                            await apiCall(`/fact-metrics/${metric.id}`, {
                              method: "PUT",
                              body: JSON.stringify({
                                archived: !metric.archived,
                              }),
                            });
                            mutateDefinitions();
                          }}
                        >
                          {metric.archived ? "Unarchive" : "Archive"}
                        </button>
                      )}
                      {canDelete(metric) && (
                        <>
                          <hr className="m-1" />
                          <DeleteButton
                            displayName="Delete"
                            onClick={async () => {
                              setIsDeleting(true);
                              try {
                                await apiCall(`/fact-metrics/${metric.id}`, {
                                  method: "DELETE",
                                });
                                mutateDefinitions();
                              } finally {
                                setIsDeleting(false);
                              }
                            }}
                            useIcon={false}
                            className="dropdown-item text-danger"
                            text="Delete"
                            disabled={isDeleting}
                          />
                        </>
                      )}
                    </MoreMenu>
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
