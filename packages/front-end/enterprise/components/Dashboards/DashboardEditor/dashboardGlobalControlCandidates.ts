import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  dashboardBlockHasIds,
  getTemporaryDashboardBlockId,
  isDashboardGlobalControlSupportedBlock,
} from "shared/enterprise";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { getCommonColumns } from "@/enterprise/components/ProductAnalytics/util";

export type DashboardGlobalControlCandidateTarget = {
  blockId: string;
  blockTitle: string;
  column: string;
  datasource: string;
  datatype: string;
  valueIndex?: number;
  factTableId?: string;
  metricId?: string;
};

export type DashboardGlobalControlCandidate = {
  key: string;
  label: string;
  column: string;
  datasource: string;
  datatype: string;
  factTableId?: string;
  targets: DashboardGlobalControlCandidateTarget[];
};

function getCandidateKey({
  datasource,
  factTableId,
  column,
  datatype,
}: {
  datasource: string;
  factTableId?: string;
  column: string;
  datatype: string;
}): string {
  return [datasource, factTableId ?? "data_source", column, datatype].join(":");
}

export function getDashboardGlobalControlCandidates({
  blocks,
  getFactTableById,
  getFactMetricById,
  includeBigNumber = false,
}: {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  getFactTableById: (id: string) => FactTableInterface | null;
  getFactMetricById: (id: string) => FactMetricInterface | null;
  includeBigNumber?: boolean;
}): DashboardGlobalControlCandidate[] {
  const candidates = new Map<string, DashboardGlobalControlCandidate>();

  blocks.forEach((block, blockIndex) => {
    if (!isDashboardGlobalControlSupportedBlock(block)) {
      return;
    }

    const { config } = block;
    if (!includeBigNumber && config.chartType === "bigNumber") {
      return;
    }

    const blockId = dashboardBlockHasIds(block)
      ? block.id
      : getTemporaryDashboardBlockId(blockIndex);
    const blockTitle = block.title || "Untitled block";
    const commonColumns = getCommonColumns(
      config.dataset,
      getFactTableById,
      getFactMetricById,
    );

    commonColumns.forEach((columnOption) => {
      let factTableId: string | undefined;
      let metricId: string | undefined;
      if (config.dataset.type === "fact_table") {
        factTableId = config.dataset.factTableId;
      } else if (
        config.dataset.type === "metric" &&
        config.dataset.values.length === 1
      ) {
        const value = config.dataset.values[0];
        metricId = value.metricId;
        const factMetric = getFactMetricById(value.metricId);
        factTableId = factMetric?.numerator.factTableId;
      }

      const datatype =
        config.dataset.type === "data_source"
          ? (config.dataset.columnTypes[columnOption.column] ?? "string")
          : "string";
      const key = getCandidateKey({
        datasource: config.datasource,
        factTableId,
        column: columnOption.column,
        datatype,
      });
      const candidate = candidates.get(key) ?? {
        key,
        label: columnOption.name || columnOption.column,
        column: columnOption.column,
        datasource: config.datasource,
        datatype,
        factTableId,
        targets: [],
      };
      const targetExists = candidate.targets.some(
        (target) =>
          target.blockId === blockId && target.column === columnOption.column,
      );
      if (!targetExists) {
        candidate.targets.push({
          blockId,
          blockTitle,
          column: columnOption.column,
          datasource: config.datasource,
          datatype,
          ...(config.dataset.values.length === 1 ? { valueIndex: 0 } : {}),
          ...(factTableId ? { factTableId } : {}),
          ...(metricId ? { metricId } : {}),
        });
      }
      candidates.set(key, candidate);
    });
  });

  return [...candidates.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
