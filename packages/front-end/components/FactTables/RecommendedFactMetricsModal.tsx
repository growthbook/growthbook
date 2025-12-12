import {
  ColumnInterface,
  CreateFactMetricProps,
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { canInlineFilterColumn } from "shared/experiments";
import { useState } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { getDefaultFactMetricProps } from "@/services/metrics";
import { GBInfo } from "@/components/Icons";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";

type RecommendedMetric = Pick<
  CreateFactMetricProps,
  "description" | "metricType" | "numerator"
> & {
  column: string;
  value: string;
};

export function getRecommendedFactMetrics(
  factTable: FactTableInterface,
  metrics: FactMetricInterface[],
): RecommendedMetric[] {
  const recommendedMetrics: RecommendedMetric[] = [];

  function addMetric(
    type: "proportion" | "mean",
    column?: ColumnInterface,
    value?: string,
  ) {
    let description =
      type === "proportion"
        ? "Proportion of experiment users with at least one row in this table"
        : "Average number of rows per experiment user";

    if (column && value) {
      description += ` matching (${column.name} = ${value})`;
    }

    recommendedMetrics.push({
      numerator: {
        factTableId: factTable.id,
        column: type === "proportion" ? "$$distinctUsers" : "$$count",
        filters: [],
        inlineFilters: column
          ? {
              [column.column]: [value || ""],
            }
          : {},
      },
      metricType: type,
      description: description,
      column: column?.column || "",
      value: value || "",
    });
  }

  const columnsWithTopValues = factTable.columns.filter(
    (column) =>
      column.alwaysInlineFilter &&
      canInlineFilterColumn(factTable, column.column) &&
      column.datatype === "string" &&
      column.topValues?.length,
  );

  const filterMap: Record<string, string> = {};
  factTable.filters.forEach((filter) => {
    filterMap[filter.id] = filter.value;
  });

  // If there's no top-level proportion metric yet
  if (
    !metrics.some(
      (m) =>
        m.metricType === "proportion" &&
        !m.numerator.filters?.length &&
        !Object.values(m.numerator.inlineFilters || {}).filter(Boolean).length,
    )
  ) {
    addMetric("proportion");
  }

  // If there's no top-level count metric yet
  if (
    !metrics.some(
      (m) =>
        m.metricType === "mean" &&
        m.numerator.column === "$$count" &&
        !m.numerator.filters?.length &&
        !Object.values(m.numerator.inlineFilters || {}).filter(Boolean).length,
    )
  ) {
    addMetric("mean");
  }

  if (columnsWithTopValues.length === 1) {
    const column = columnsWithTopValues[0];
    column.topValues?.forEach((value) => {
      // Skip if there's already a metric filtering on this value
      if (
        metrics.some(
          (m) =>
            m.numerator.inlineFilters?.[column.column]?.includes(value) ||
            m.numerator.filters?.some(
              (f) =>
                filterMap[f]?.includes(column.column) &&
                filterMap[f]?.includes(value),
            ),
        )
      ) {
        return;
      }

      addMetric("proportion", column, value);
      addMetric("mean", column, value);
    });
  }

  return recommendedMetrics;
}

export default function RecommendedFactMetricsModal({
  factTable,
  metrics,
  close,
}: {
  factTable: FactTableInterface;
  metrics: RecommendedMetric[];
  close: () => void;
}) {
  const { apiCall } = useAuth();

  const { metricDefaults } = useOrganizationMetricDefaults();

  const settings = useOrgSettings();

  const { datasources, project, mutateDefinitions } = useDefinitions();

  const [checked, setChecked] = useState(new Set<number>());
  const [progress, setProgress] = useState(0);
  const [namePrefix, setNamePrefix] = useState(factTable.name + ":");

  function checkAll() {
    setChecked(new Set(metrics.map((_, i) => i)));
  }

  const columns = [...new Set(metrics.map((m) => m.column).filter(Boolean))];

  function getName(metric: RecommendedMetric) {
    let prefix = namePrefix ? namePrefix.trim() + " " : "";

    if (metric.value) {
      prefix += metric.value.trim() + " - ";
    }

    if (metric.metricType === "mean") {
      return `${prefix}Count per User`;
    }
    if (metric.metricType === "proportion") {
      return `${prefix}Proportion of Users`;
    }

    return `${namePrefix}${metric.metricType}`;
  }

  return (
    <Modal
      open
      header="Review Recommended Metrics"
      cta={`Create ${checked.size} Selected Metric${
        checked.size === 1 ? "" : "s"
      }`}
      ctaEnabled={checked.size > 0}
      disabledMessage="Select at least one metric to create"
      trackingEventModalType="recommended-metrics"
      size="lg"
      close={close}
      submit={async () => {
        let failures = 0;
        setProgress(0);
        let numProcessed = 0;
        for (const i of checked) {
          const body: CreateFactMetricProps = getDefaultFactMetricProps({
            datasources,
            metricDefaults,
            project,
            settings,
            existing: {
              ...metrics[i],
              datasource: factTable.datasource,
              projects: factTable.projects,
              name: getName(metrics[i]),
            },
          });

          try {
            await apiCall("/fact-metrics", {
              method: "POST",
              body: JSON.stringify(body),
            });
            await new Promise((r) => setTimeout(r, 750));
          } catch (e) {
            failures++;
          }
          numProcessed++;
          setProgress(numProcessed / checked.size);
        }
        // Hide progress bar at end
        setProgress(0);

        await mutateDefinitions();

        if (failures) {
          setChecked(new Set());
          throw new Error(`${failures} of the metrics failed to create`);
        }
      }}
    >
      <p>
        Review the metrics below and decide which ones you want to create now.
      </p>
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              checkAll();
            }}
            className={
              checked.size === metrics.length ? "disabled text-muted" : ""
            }
          >
            Select All
          </a>
        </div>
        <div className="col-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setChecked(new Set());
            }}
            className={checked.size === 0 ? "disabled text-muted" : ""}
          >
            Unselect All
          </a>
        </div>

        <div className="col-auto ml-auto">
          <div className="form-inline">
            <Field
              label="Name Prefix"
              labelClassName="mr-2"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
            />
          </div>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 30 }} />
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            <th>Type</th>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric, i) => (
            <tr key={i}>
              <td>
                <input
                  type="checkbox"
                  checked={checked.has(i)}
                  onChange={(e) => {
                    const newChecked = new Set(checked);
                    if (e.target.checked) {
                      newChecked.add(i);
                    } else {
                      newChecked.delete(i);
                    }
                    setChecked(newChecked);
                  }}
                />
              </td>
              {columns.map((column) => (
                <td key={column}>
                  {metric.column === column && metric.value ? (
                    metric.value
                  ) : (
                    <em className="text-muted">any</em>
                  )}
                </td>
              ))}
              <td>
                <Tooltip body={metric.description}>
                  <FactMetricTypeDisplayName type={metric.metricType} />
                  &nbsp;
                  <GBInfo />
                </Tooltip>
              </td>
              <td>{getName(metric)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {progress > 0 ? (
        <div
          className="progress"
          style={{ position: "sticky", bottom: "-1rem", height: 10 }}
        >
          <div
            className="progress-bar"
            role="progressbar"
            style={{ width: `${100 * parseFloat(progress.toFixed(3))}%` }}
          />
        </div>
      ) : null}
    </Modal>
  );
}
