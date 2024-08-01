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
import FactMetricModal from "./FactMetricModal";

export interface Props {
  factTable: FactTableInterface;
}

export function getMetricsForFactTable(
  factMetrics: FactMetricInterface[],
  factTable: string
) {
  return factMetrics.filter(
    (m) =>
      m.numerator.factTableId === factTable ||
      (m.denominator && m.denominator.factTableId === factTable)
  );
}

export default function FactMetricList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const { apiCall } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const { factMetrics, mutateDefinitions } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const metrics = getMetricsForFactTable(factMetrics, factTable.id);

  const [editMetric, setEditMetric] = useState<
    FactMetricInterface | undefined
  >();

  const canEdit = (factMetric: FactMetricInterface) =>
    permissionsUtil.canUpdateFactMetric(factMetric, {}) &&
    !factMetric.managedBy;

  const canDelete = (factMetric: FactMetricInterface) =>
    permissionsUtil.canDeleteFactMetric(factMetric) && !factMetric.managedBy;

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: metrics || [],
    defaultSortField: "name",
    localStorageKey: "factmetrics",
    searchFields: ["name^3", "description"],
  });

  const canCreateMetrics = permissionsUtil.canCreateFactMetric({
    projects: factTable.projects,
  });

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
      {editOpen && (
        <FactMetricModal
          close={() => setEditOpen("")}
          initialFactTable={factTable.id}
          existing={metrics.find((m) => m.id === editOpen)}
          source="fact-table"
        />
      )}

      <div className="row align-items-center">
        {metrics.length > 0 && (
          <div className="col-auto mr-auto">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
        )}
        <div className="col-auto">
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
                    <SortedTags tags={metric.tags} />
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
        </>
      )}
    </>
  );
}
