import { useState, useMemo, useCallback } from "react";
import { MetricInterface } from "shared/types/metric";
import {
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import { migrateMetrics, MigrationResult } from "shared/src/metric-migration";

export interface MigrationState {
  result: MigrationResult;
  factMetricsByTable: Map<string, FactMetricInterface[]>;
  legacyMetricById: Map<string, MetricInterface>;
  enabledFactTableIds: Set<string>;
  disabledMetricIds: Set<string>;
  selectAllState: boolean | "indeterminate";
  selectedCount: number;
  totalCount: number;
  factTableNames: Map<string, string>;
  sectionCheckState: (factTableId: string) => boolean | "indeterminate";
  toggleSelectAll: () => void;
  toggleFactTable: (id: string) => void;
  toggleMetric: (factMetricId: string) => void;
  renameFactTable: (id: string, name: string) => void;
  getSelectedMigration: () => {
    factTables: FactTableInterface[];
    factMetrics: FactMetricInterface[];
    legacyMetricIds: string[];
  };
}

export function useMigrationState(metrics: MetricInterface[]): MigrationState {
  const result = useMemo(
    () => migrateMetrics(metrics, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics.map((m) => m.id).join(",")],
  );

  const factMetricsByTable = useMemo(() => {
    const map = new Map<string, FactMetricInterface[]>();
    for (const fm of result.factMetrics) {
      const tableId = fm.numerator.factTableId;
      const existing = map.get(tableId) || [];
      existing.push(fm);
      map.set(tableId, existing);
    }
    return map;
  }, [result]);

  const legacyMetricById = useMemo(() => {
    const map = new Map<string, MetricInterface>();
    for (const m of metrics) {
      map.set(m.id, m);
    }
    return map;
  }, [metrics]);

  const [enabledFactTableIds, setEnabledFactTableIds] = useState<Set<string>>(
    () => new Set(result.factTables.map((ft) => ft.id)),
  );

  const [disabledMetricIds, setDisabledMetricIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [factTableNames, setFactTableNames] = useState<Map<string, string>>(
    () => new Map(result.factTables.map((ft) => [ft.id, ft.name])),
  );

  const totalCount = result.factMetrics.length;

  const selectedCount = useMemo(() => {
    return result.factMetrics.filter((fm) => {
      const tableId = fm.numerator.factTableId;
      return enabledFactTableIds.has(tableId) && !disabledMetricIds.has(fm.id);
    }).length;
  }, [result.factMetrics, enabledFactTableIds, disabledMetricIds]);

  const selectAllState = useMemo((): boolean | "indeterminate" => {
    const allTableIds = result.factTables.map((ft) => ft.id);
    if (allTableIds.length === 0) return false;

    const allEnabled = allTableIds.every((id) => enabledFactTableIds.has(id));
    const noneEnabled = allTableIds.every((id) => !enabledFactTableIds.has(id));

    if (allEnabled && disabledMetricIds.size === 0) return true;
    if (noneEnabled) return false;
    return "indeterminate";
  }, [result.factTables, enabledFactTableIds, disabledMetricIds]);

  const sectionCheckState = useCallback(
    (factTableId: string): boolean | "indeterminate" => {
      if (!enabledFactTableIds.has(factTableId)) return false;

      const metricsInTable = factMetricsByTable.get(factTableId) || [];
      if (metricsInTable.length === 0) return true;

      const disabledCount = metricsInTable.filter((fm) =>
        disabledMetricIds.has(fm.id),
      ).length;

      if (disabledCount === 0) return true;
      if (disabledCount === metricsInTable.length) return false;
      return "indeterminate";
    },
    [enabledFactTableIds, factMetricsByTable, disabledMetricIds],
  );

  const toggleSelectAll = useCallback(() => {
    if (selectAllState === true) {
      setEnabledFactTableIds(new Set());
    } else {
      setEnabledFactTableIds(new Set(result.factTables.map((ft) => ft.id)));
      setDisabledMetricIds(new Set());
    }
  }, [selectAllState, result.factTables]);

  const toggleFactTable = useCallback(
    (id: string) => {
      setEnabledFactTableIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      // Reset disabled metrics for this table
      const metricsInTable = factMetricsByTable.get(id) || [];
      setDisabledMetricIds((prev) => {
        const next = new Set(prev);
        for (const fm of metricsInTable) {
          next.delete(fm.id);
        }
        return next;
      });
    },
    [factMetricsByTable],
  );

  const toggleMetric = useCallback((factMetricId: string) => {
    setDisabledMetricIds((prev) => {
      const next = new Set(prev);
      if (next.has(factMetricId)) {
        next.delete(factMetricId);
      } else {
        next.add(factMetricId);
      }
      return next;
    });
  }, []);

  const renameFactTable = useCallback((id: string, name: string) => {
    setFactTableNames((prev) => {
      const next = new Map(prev);
      next.set(id, name);
      return next;
    });
  }, []);

  const getSelectedMigration = useCallback(() => {
    const selectedFactMetrics = result.factMetrics.filter((fm) => {
      const tableId = fm.numerator.factTableId;
      return enabledFactTableIds.has(tableId) && !disabledMetricIds.has(fm.id);
    });

    // Only include fact tables that have at least one selected metric
    const usedTableIds = new Set(
      selectedFactMetrics.map((fm) => fm.numerator.factTableId),
    );
    const selectedFactTables = result.factTables
      .filter((ft) => usedTableIds.has(ft.id))
      .map((ft) => {
        const customName = factTableNames.get(ft.id);
        return customName ? { ...ft, name: customName } : ft;
      });

    // Extract legacy metric IDs from fact metric IDs (format: fact__{legacyId})
    const legacyMetricIds = selectedFactMetrics.map((fm) =>
      fm.id.replace(/^fact__/, ""),
    );

    return {
      factTables: selectedFactTables,
      factMetrics: selectedFactMetrics,
      legacyMetricIds,
    };
  }, [result, enabledFactTableIds, disabledMetricIds, factTableNames]);

  return {
    result,
    factMetricsByTable,
    legacyMetricById,
    enabledFactTableIds,
    disabledMetricIds,
    selectAllState,
    selectedCount,
    totalCount,
    factTableNames,
    sectionCheckState,
    toggleSelectAll,
    toggleFactTable,
    toggleMetric,
    renameFactTable,
    getSelectedMigration,
  };
}
