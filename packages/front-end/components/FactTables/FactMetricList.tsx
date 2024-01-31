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
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import { GBAddCircle } from "../Icons";
import SortedTags from "../Tags/SortedTags";
import MetricName from "../Metrics/MetricName";
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

  const permissions = usePermissions();

  const metrics = getMetricsForFactTable(factMetrics, factTable.id);

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: metrics || [],
    defaultSortField: "name",
    localStorageKey: "factmetrics",
    searchFields: ["name^3", "description"],
  });

  const canEdit = permissions.check("createMetrics", factTable.projects || "");

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
                    <Link href={`/fact-metrics/${metric.id}`}>
                      <a className="font-weight-bold" title="View Metric">
                        <MetricName id={metric.id} /> <FaExternalLinkAlt />
                      </a>
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
