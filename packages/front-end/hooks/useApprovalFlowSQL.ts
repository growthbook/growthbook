import { useMemo } from "react";
import { FactMetricInterface, FactTableInterface } from "back-end/types/fact-table";
import { getFactMetricSQL } from "@/services/fact-metric-sql";
import { ApprovalEntityType } from "@/types/approval-flow";

// Deep merge helper for nested objects
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      if (
        target[key] &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        );
      } else {
        result[key] = source[key];
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export interface ApprovalFlowSQLData {
  currentSql: string | null;
  proposedSql: string | null;
  currentDenominatorSQL?: string;
  proposedDenominatorSQL?: string;
  currentExperimentSQL: string | null;
  proposedExperimentSQL: string | null;
  hasSql: boolean;
  sqlChanged: boolean;
}
export function useApprovalFlowSQL(
  entityType: ApprovalEntityType | undefined,
  currentState: Record<string, unknown>,
  proposedChanges: Record<string, unknown> | undefined,
  getFactTableById: (id: string) => FactTableInterface | null
): ApprovalFlowSQLData {

  return useMemo(() => {

    let currentSql: string | null = null;
    let proposedSql: string | null = null;
    let currentDenominatorSQL: string | undefined = undefined;
    let proposedDenominatorSQL: string | undefined = undefined;
    let currentExperimentSQL: string | null = null;
    let proposedExperimentSQL: string | null = null;
    let hasSql = false;
    let sqlChanged = false;

    if (!entityType || !proposedChanges) {
      return {
        currentSql,
        proposedSql,
        currentDenominatorSQL,
        proposedDenominatorSQL,
        currentExperimentSQL,
        proposedExperimentSQL,
        hasSql,
        sqlChanged,
      };
    }

    if (entityType === "fact-metric") {
      const currentFactMetric = currentState as Partial<FactMetricInterface>;
      const proposedFactMetric = deepMerge(
        currentFactMetric,
        proposedChanges
      ) as Partial<FactMetricInterface>;

      const currentSQLResult = getFactMetricSQL(
        currentFactMetric,
        getFactTableById
      );
      const proposedSQLResult = getFactMetricSQL(
        proposedFactMetric,
        getFactTableById
      );

      if (currentSQLResult) {
        currentSql = currentSQLResult.sql;
        currentDenominatorSQL = currentSQLResult.denominatorSQL;
        currentExperimentSQL = currentSQLResult.experimentSQL;
        hasSql = true;
      }

      if (proposedSQLResult) {
        proposedSql = proposedSQLResult.sql;
        proposedDenominatorSQL = proposedSQLResult.denominatorSQL;
        proposedExperimentSQL = proposedSQLResult.experimentSQL;
        hasSql = true;
      }

      sqlChanged =
        currentSql !== proposedSql ||
        currentDenominatorSQL !== proposedDenominatorSQL;
    }

    return {
      currentSql,
      proposedSql,
      currentDenominatorSQL,
      proposedDenominatorSQL,
      currentExperimentSQL,
      proposedExperimentSQL,
      hasSql,
      sqlChanged,
    };
  }, [entityType, currentState, proposedChanges, getFactTableById]);
}
