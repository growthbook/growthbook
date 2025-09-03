import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { useState } from "react";
import Link from "next/link";
import { date } from "shared/dates";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBAddCircle } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Switch from "@/components/Radix/Switch";
import RecommendedFactMetricsModal, {
  getRecommendedFactMetrics,
} from "@/components/FactTables/RecommendedFactMetricsModal";
import FactMetricModal from "./FactMetricModal";

export interface Props {
  factTable: FactTableInterface;
}

export function getMetricsForFactTable(
  factMetrics: FactMetricInterface[],
  factTable: string,
) {
  return factMetrics.filter(
    (m) =>
      m.numerator.factTableId === factTable ||
      (m.denominator && m.denominator.factTableId === factTable),
  );
}

export default function FactMetricList({ factTable }: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { apiCall } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const { _factMetricsIncludingArchived: factMetrics, mutateDefinitions } =
    useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const metrics = getMetricsForFactTable(factMetrics, factTable.id);
  const hasArchivedMetrics = factMetrics.some((m) => m.archived);

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
        <div className="alert alert-info mt-3">
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
        </div>
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
            <Switch
              value={showArchived}
              setValue={setShowArchived}
              id="show-archived"
              label="show archived"
            />
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
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                if (!canCreateMetrics) return;
                setNewOpen(true);
              }}
              disabled={!canCreateMetrics}
            >
              <GBAddCircle /> Add Metric
            </button>
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
