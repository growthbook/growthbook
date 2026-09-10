import type { ExplorationConfig, JourneyDataset } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import { composeStepLabel, stepGroupsForColumn } from "shared/journeys";

export function selectedJourneySteps(dataset: JourneyDataset) {
  if (!dataset.anchorStepValues?.some((value) => value !== "")) return [];
  const steps = [
    { label: composeStepLabel(dataset.anchorStepValues ?? []), index: 0 },
    ...dataset.path.map((step, index) => ({
      label: step.value,
      index: index + 1,
    })),
  ];
  return dataset.direction === "backward" ? steps.reverse() : steps;
}

function stepFilters(dataset: JourneyDataset, values: string[]): RowFilter[] {
  return dataset.stepColumns.flatMap((column, index) => {
    const value = values[index];
    const groups = stepGroupsForColumn(dataset.stepGroups, column);
    const groupIndex = groups.findIndex((group) => group.pattern === value);
    if (groupIndex < 0) return [{ column, operator: "=", values: [value] }];

    let operator: RowFilter["operator"] = "matches_pattern";
    let filterValue = value;
    if (!/[?]/.test(value)) {
      if (/^[^*]+\*$/.test(value)) {
        operator = "starts_with";
        filterValue = value.slice(0, -1);
      } else if (/^\*[^*]+$/.test(value)) {
        operator = "ends_with";
        filterValue = value.slice(1);
      } else if (/^\*[^*]+\*$/.test(value)) {
        operator = "contains";
        filterValue = value.slice(1, -1);
      } else if (!value.includes("*")) {
        operator = "=";
      }
    }
    // Match the first applicable grouping rule, just like the journey SQL CASE.
    return [
      { column, operator, values: [filterValue] },
      ...groups.slice(0, groupIndex).map(
        (group): RowFilter => ({
          column,
          operator: "not_matches_pattern",
          values: [group.pattern],
        }),
      ),
    ];
  });
}

export function journeyToFunnel(config: ExplorationConfig): ExplorationConfig {
  if (config.type !== "journey")
    throw new Error("Expected a journey exploration");
  const dataset = config.dataset;
  if (
    !dataset.factTableId ||
    !dataset.unit ||
    !dataset.anchorStepValues ||
    !dataset.path.length
  ) {
    throw new Error("Select at least two journey steps to explore a funnel.");
  }
  const factTableId = dataset.factTableId;
  return {
    type: "funnel",
    chartType: "bar",
    datasource: config.datasource,
    dateRange: config.dateRange,
    dimensions: config.dimensions,
    dataset: {
      type: "funnel",
      unit: dataset.unit,
      steps: selectedJourneySteps(dataset).map(({ label, index }) => {
        const values =
          index === 0
            ? (dataset.anchorStepValues ?? [])
            : dataset.stepColumns.length === 1
              ? [label]
              : label.split(" / ");
        if (values.length !== dataset.stepColumns.length) {
          throw new Error(
            "This path contains an ambiguous multi-column step. Configure its funnel filters manually.",
          );
        }
        return {
          name: label,
          factTableId,
          optional: false,
          rowFilters: [...dataset.rowFilters, ...stepFilters(dataset, values)],
        };
      }),
    },
  };
}
