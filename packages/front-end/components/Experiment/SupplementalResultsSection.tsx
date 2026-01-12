import { FC } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { Heading } from "@radix-ui/themes";
import { isNullUndefinedOrEmpty } from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";
import CupedComparisonTable from "./CupedComparisonTable";
import BayesianPriorComparisonTable from "./BayesianPriorComparisonTable";
import CappingComparisonTable from "./CappingComparisonTable";

interface SupplementalResultsSectionProps {
  row?: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  variationNames: string[];
  baselineRow?: number;
}

interface TableVisibility {
  showCupedTable: boolean;
  showBayesianPriorTable: boolean;
  showCappingTable: boolean;
}

function getTableVisibility(
  row: ExperimentTableRow | undefined,
  metric: ExperimentMetricInterface,
  statsEngine: StatsEngine,
): TableVisibility {
  if (!row) {
    return {
      showCupedTable: false,
      showBayesianPriorTable: false,
      showCappingTable: false,
    };
  }

  return {
    showCupedTable: !!row.metricSnapshotSettings?.regressionAdjustmentEnabled,
    showBayesianPriorTable:
      statsEngine === "bayesian" && !!row.metricSnapshotSettings?.properPrior,
    showCappingTable: !isNullUndefinedOrEmpty(metric.cappingSettings?.type),
  };
}

const SupplementalResultsSection: FC<SupplementalResultsSectionProps> = ({
  row,
  metric,
  statsEngine,
  differenceType,
  variationNames,
  baselineRow = 0,
}) => {
  const tableVisibility = getTableVisibility(row, metric, statsEngine);

  // If no tables should be shown, don't render anything
  if (
    !tableVisibility.showCupedTable &&
    !tableVisibility.showBayesianPriorTable &&
    !tableVisibility.showCappingTable
  ) {
    return null;
  }

  // If row is not available, don't render
  if (!row) {
    return null;
  }

  return (
    <>
      {tableVisibility.showCupedTable && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            CUPED Comparison
          </Heading>
          <CupedComparisonTable
            row={row}
            metric={metric}
            variationNames={variationNames}
            differenceType={differenceType}
            statsEngine={statsEngine}
            baselineRow={baselineRow}
          />
        </div>
      )}

      {tableVisibility.showBayesianPriorTable && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Prior Comparison
          </Heading>
          <BayesianPriorComparisonTable
            row={row}
            metric={metric}
            variationNames={variationNames}
            differenceType={differenceType}
            baselineRow={baselineRow}
          />
        </div>
      )}

      {tableVisibility.showCappingTable && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Capping Comparison
          </Heading>
          <CappingComparisonTable
            row={row}
            metric={metric}
            variationNames={variationNames}
            differenceType={differenceType}
            statsEngine={statsEngine}
            baselineRow={baselineRow}
          />
        </div>
      )}
    </>
  );
};

export default SupplementalResultsSection;
