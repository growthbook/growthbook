import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { useState } from "react";
import Link from "next/link";
import { FaAngleRight, FaExternalLinkAlt } from "react-icons/fa";
import { date } from "shared/dates";
import { useRouter } from "next/router";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBAddCircle } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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

  const router = useRouter();

  const { factMetrics } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const metrics = getMetricsForFactTable(factMetrics, factTable.id);

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: metrics || [],
    defaultSortField: "name",
    localStorageKey: "factmetrics",
    searchFields: ["name^3", "description"],
  });

  const canEdit = permissionsUtil.canCreateMetric(factTable);

  return (
    <>
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
              canEdit
                ? ""
                : `You don't have permission to add metrics to this fact table`
            }
          >
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                if (!canEdit) return;
                setNewOpen(true);
              }}
              disabled={!canEdit}
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
                <tr
                  key={metric.id}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/fact-metrics/${metric.id}`);
                  }}
                >
                  <td>
                    <Link
                      href={`/fact-metrics/${metric.id}`}
                      className="font-weight-bold"
                      title="View Metric"
                    >
                      <MetricName id={metric.id} /> <FaExternalLinkAlt />
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
                    <FaAngleRight />
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
