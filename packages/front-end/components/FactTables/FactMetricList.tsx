import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { useState } from "react";
import { date } from "shared/dates";
import Link from "next/link";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { FactSQL } from "@/pages/fact-metrics/[fmid]";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import { GBAddCircle } from "../Icons";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
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

  const { mutateDefinitions, factMetrics } = useDefinitions();

  const { apiCall } = useAuth();

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
          navigateOnCreate={false}
        />
      )}
      {editOpen && (
        <FactMetricModal
          close={() => setEditOpen("")}
          initialFactTable={factTable.id}
          existing={metrics.find((m) => m.id === editOpen)}
        />
      )}

      <div className="row align-items-center">
        {metrics.length > 0 && (
          <div className="col-lg-3 col-md-4 col-6 mr-auto">
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
          <table className="table appbox gbtable mt-2 mb-0">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="metricType">Type</SortableTH>
                <th>Value</th>
                <th>Denominator</th>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((metric) => (
                <tr key={metric.id}>
                  <td>
                    <Link href={`/fact-metrics/${metric.id}`}>
                      <a className="font-weight-bold" title="View Metric">
                        {metric.name} <FaExternalLinkAlt />
                      </a>
                    </Link>
                  </td>
                  <td>{metric.metricType}</td>
                  <td>
                    <FactSQL
                      fact={metric.numerator}
                      isProportion={metric.metricType === "proportion"}
                      showFrom={metric.numerator.factTableId !== factTable.id}
                    />
                  </td>
                  <td>
                    {metric.metricType === "ratio" && metric.denominator ? (
                      <FactSQL
                        fact={metric.denominator}
                        showFrom={
                          metric.denominator.factTableId !== factTable.id
                        }
                      />
                    ) : (
                      <em>All Experiment Users</em>
                    )}
                  </td>
                  <td>{date(metric.dateUpdated)}</td>
                  <td>
                    {canEdit && (
                      <MoreMenu>
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditOpen(metric.id);
                          }}
                        >
                          Edit
                        </button>
                        <DeleteButton
                          displayName="Fact"
                          className="dropdown-item"
                          useIcon={false}
                          text="Delete"
                          onClick={async () => {
                            await apiCall(`/fact-metrics/${metric.id}`, {
                              method: "DELETE",
                            });
                            mutateDefinitions();
                          }}
                        />
                      </MoreMenu>
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={8} align={"center"}>
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
