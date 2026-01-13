import { FC, useMemo, useState } from "react";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  DifferenceType,
  StatsEngine,
  PValueCorrection,
} from "shared/types/stats";
import { Heading, Text } from "@radix-ui/themes";
import {
  SnapshotMetric,
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysis,
} from "shared/types/experiment-snapshot";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { FaCaretRight } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { isNullUndefinedOrEmpty } from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";
import EmptyState from "@/components/EmptyState";
import Code from "@/components/SyntaxHighlighting/Code";
import ResultsTable from "./ResultsTable";

interface SupplementalResultsSectionProps {
  row?: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  variationNames: string[];
  baselineRow?: number;
  // Props needed for ResultsTable
  experimentId: string;
  phase: number;
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  experimentStatus: ExperimentStatus;
  // Debug props
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
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

/**
 * Create a row with variations overridden by supplemental results
 */
function createSupplementalRow(
  baseRow: ExperimentTableRow,
  description: string,
  supplementalField: keyof SnapshotMetric,
): ExperimentTableRow {
  const newVariations = baseRow.variations.map((variation) => {
    const supplemental = variation[supplementalField] as
      | SnapshotMetric
      | undefined;
    if (!supplemental) {
      return variation;
    }
    // Merge supplemental results over the original variation
    return {
      ...variation,
      ...supplemental,
    };
  });

  return {
    ...baseRow,
    label: (
      <>
        {baseRow.metric.name}
        <Text
          size="2"
          style={{ color: "var(--gray-10)", display: "block", marginTop: 2 }}
        >
          {description}
        </Text>
      </>
    ),
    variations: newVariations,
  };
}

const SupplementalResultsSection: FC<SupplementalResultsSectionProps> = ({
  row,
  metric,
  statsEngine,
  differenceType,
  baselineRow = 0,
  experimentId,
  phase,
  variations,
  startDate,
  endDate,
  reportDate,
  isLatestPhase,
  pValueCorrection,
  sequentialTestingEnabled,
  experimentStatus,
  snapshot,
  analysis,
}) => {
  // All hooks must be called at the top level, before any early returns
  const tableVisibility = getTableVisibility(row, metric, statsEngine);

  // Debug state (must be declared before any early returns)
  const [openDebugSections, setOpenDebugSections] = useState<
    Record<string, boolean>
  >({});

  // Debug data extraction (must be declared before any early returns)
  const debugData = useMemo(() => {
    if (!row) return null;

    const supplementalData: Record<string, unknown[]> = {
      supplementalResultsCupedUnadjusted: [],
      supplementalResultsUncapped: [],
      supplementalResultsUnstratified: [],
      supplementalResultsFlatPrior: [],
    };

    row.variations.forEach((variation, index) => {
      if (variation.supplementalResultsCupedUnadjusted) {
        supplementalData.supplementalResultsCupedUnadjusted.push({
          variationIndex: index,
          ...variation.supplementalResultsCupedUnadjusted,
        });
      }
      if (variation.supplementalResultsUncapped) {
        supplementalData.supplementalResultsUncapped.push({
          variationIndex: index,
          ...variation.supplementalResultsUncapped,
        });
      }
      if (variation.supplementalResultsUnstratified) {
        supplementalData.supplementalResultsUnstratified.push({
          variationIndex: index,
          ...variation.supplementalResultsUnstratified,
        });
      }
      if (variation.supplementalResultsFlatPrior) {
        supplementalData.supplementalResultsFlatPrior.push({
          variationIndex: index,
          ...variation.supplementalResultsFlatPrior,
        });
      }
    });

    return {
      supplementalData,
      fullRowData: row,
      snapshotData: snapshot,
      analysisData: analysis,
    };
  }, [row, snapshot, analysis]);

  // Generate rows for CUPED comparison
  const cupedRows = useMemo(() => {
    if (!tableVisibility.showCupedTable || !row) return [];

    // Check if we have supplemental results (only check non-baseline variations)
    const hasUnadjusted = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsCupedUnadjusted,
    );
    const hasUnstratified = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsUnstratified,
    );

    // Only show comparison if we have supplemental data
    if (!hasUnadjusted && !hasUnstratified) return [];

    const rows: ExperimentTableRow[] = [];

    // Main row with CUPED On
    rows.push({
      ...row,
      label: (
        <>
          {metric.name}
          <Text
            size="2"
            style={{
              color: "var(--gray-10)",
              display: "block",
              marginTop: 2,
            }}
          >
            CUPED On
          </Text>
        </>
      ),
    });

    // Add CUPED Off row if supplementalResultsCupedUnadjusted exists
    if (hasUnadjusted) {
      rows.push(
        createSupplementalRow(
          row,
          "CUPED Off",
          "supplementalResultsCupedUnadjusted",
        ),
      );
    }

    // Add unstratified row if supplementalResultsUnstratified exists
    if (hasUnstratified) {
      rows.push(
        createSupplementalRow(
          row,
          "Without post-strat",
          "supplementalResultsUnstratified",
        ),
      );
    }

    return rows;
  }, [tableVisibility.showCupedTable, row, metric.name, baselineRow]);

  // Generate rows for Bayesian Prior comparison
  const priorRows = useMemo(() => {
    if (!tableVisibility.showBayesianPriorTable || !row) return [];

    // Check if we have flat prior results (only check non-baseline variations)
    const hasFlatPrior = row.variations.some(
      (v, i) =>
        i > baselineRow &&
        "supplementalResultsFlatPrior" in v &&
        v.supplementalResultsFlatPrior,
    );

    // Only show comparison if we have supplemental data
    if (!hasFlatPrior) return [];

    const rows: ExperimentTableRow[] = [];

    // Main row with Proper Prior
    rows.push({
      ...row,
      label: (
        <>
          {metric.name}
          <Text
            size="2"
            style={{ color: "var(--gray-10)", display: "block", marginTop: 2 }}
          >
            Proper Prior
          </Text>
        </>
      ),
    });

    // Add Flat Prior comparison row
    rows.push(
      createSupplementalRow(
        row,
        "Flat Prior (Improper)",
        "supplementalResultsFlatPrior",
      ),
    );

    return rows;
  }, [tableVisibility.showBayesianPriorTable, row, metric.name, baselineRow]);

  // Generate rows for Capping comparison
  const cappingRows = useMemo(() => {
    if (!tableVisibility.showCappingTable || !row) return [];

    // Check if we have uncapped results (only check non-baseline variations)
    const hasUncapped = row.variations.some(
      (v, i) => i > baselineRow && v.supplementalResultsUncapped,
    );

    // Only show comparison if we have supplemental data
    if (!hasUncapped) return [];

    const rows: ExperimentTableRow[] = [];

    // Main row with Capped
    rows.push({
      ...row,
      label: (
        <>
          {metric.name}
          <Text
            size="2"
            style={{ color: "var(--gray-10)", display: "block", marginTop: 2 }}
          >
            Capped
          </Text>
        </>
      ),
    });

    // Add Uncapped comparison row
    rows.push(
      createSupplementalRow(row, "Uncapped", "supplementalResultsUncapped"),
    );

    return rows;
  }, [tableVisibility.showCappingTable, row, metric.name, baselineRow]);

  // Check if any supplemental data is available
  const hasAnySupplementalData =
    cupedRows.length > 0 || priorRows.length > 0 || cappingRows.length > 0;

  // Helper function for toggling debug sections
  const toggleDebugSection = (section: string) => {
    setOpenDebugSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Early returns after all hooks have been called
  // If no tables should be shown and no row data, return null
  if (
    !tableVisibility.showCupedTable &&
    !tableVisibility.showBayesianPriorTable &&
    !tableVisibility.showCappingTable &&
    !row
  ) {
    return null;
  }

  // If row is not available, don't render
  if (!row) {
    return null;
  }

  return (
    <>
      {/* Show empty state if no supplemental data but we have tables that should be shown */}
      {!hasAnySupplementalData &&
        (tableVisibility.showCupedTable ||
          tableVisibility.showBayesianPriorTable ||
          tableVisibility.showCappingTable) && (
          <EmptyState
            title="No data available"
            description="When data becomes available, it will automatically populate this tab. This tab shows comparisons to help you understand the impact of variance reduction techniques like CUPED (regression adjustment using pre-experiment data) and post-stratification (balancing across user attributes), as well as the effect of metric capping and Bayesian priors on your results."
            leftButton={null}
            rightButton={null}
          />
        )}

      {tableVisibility.showCupedTable && cupedRows.length > 0 && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            CUPED Comparison
          </Heading>
          <ResultsTable
            experimentId={experimentId}
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={experimentStatus}
            variations={variations}
            baselineRow={baselineRow}
            rows={cupedRows}
            id={`${experimentId}_${metric.id}_cuped_comparison`}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
          />
        </div>
      )}

      {tableVisibility.showBayesianPriorTable && priorRows.length > 0 && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Prior Comparison
          </Heading>
          <ResultsTable
            experimentId={experimentId}
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={experimentStatus}
            variations={variations}
            baselineRow={baselineRow}
            rows={priorRows}
            id={`${experimentId}_${metric.id}_prior_comparison`}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
          />
        </div>
      )}

      {tableVisibility.showCappingTable && cappingRows.length > 0 && (
        <div className="mt-4">
          <Heading size="4" weight="medium" mb="3">
            Capping Comparison
          </Heading>
          <ResultsTable
            experimentId={experimentId}
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={experimentStatus}
            variations={variations}
            baselineRow={baselineRow}
            rows={cappingRows}
            id={`${experimentId}_${metric.id}_capping_comparison`}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={true}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
          />
        </div>
      )}

      {/* Debug Section */}
      {debugData && (
        <div
          className="mt-5 pt-4"
          style={{ borderTop: "1px solid var(--border-color-200)" }}
        >
          <Heading size="4" weight="medium" mb="2">
            Debug Data (Temporary)
          </Heading>
          <Text
            size="2"
            mb="4"
            style={{ color: "var(--gray-10)", display: "block" }}
          >
            Raw JSON data showing supplemental results (CUPED unadjusted,
            uncapped, unstratified, flat prior), full row data with all
            variations, experiment snapshot, and snapshot analysis.
          </Text>

          {/* Supplemental Results CUPED Unadjusted */}
          {debugData.supplementalData.supplementalResultsCupedUnadjusted
            .length > 0 && (
            <div className="mb-3">
              <Collapsible
                trigger={
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: "pointer" }}
                  >
                    <FaCaretRight
                      className="mr-2"
                      style={{
                        transform: openDebugSections["cupedUnadjusted"]
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                    <Text size="3" weight="medium">
                      Supplemental: CUPED Unadjusted
                    </Text>
                  </div>
                }
                onOpening={() => toggleDebugSection("cupedUnadjusted")}
                onClosing={() => toggleDebugSection("cupedUnadjusted")}
              >
                <div className="mt-2">
                  <Code
                    code={JSON.stringify(
                      debugData.supplementalData
                        .supplementalResultsCupedUnadjusted,
                      null,
                      2,
                    )}
                    language="json"
                    showLineNumbers={false}
                  />
                </div>
              </Collapsible>
            </div>
          )}

          {/* Supplemental Results Uncapped */}
          {debugData.supplementalData.supplementalResultsUncapped.length >
            0 && (
            <div className="mb-3">
              <Collapsible
                trigger={
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: "pointer" }}
                  >
                    <FaCaretRight
                      className="mr-2"
                      style={{
                        transform: openDebugSections["uncapped"]
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                    <Text size="3" weight="medium">
                      Supplemental: Uncapped
                    </Text>
                  </div>
                }
                onOpening={() => toggleDebugSection("uncapped")}
                onClosing={() => toggleDebugSection("uncapped")}
              >
                <div className="mt-2">
                  <Code
                    code={JSON.stringify(
                      debugData.supplementalData.supplementalResultsUncapped,
                      null,
                      2,
                    )}
                    language="json"
                    showLineNumbers={false}
                  />
                </div>
              </Collapsible>
            </div>
          )}

          {/* Supplemental Results Unstratified */}
          {debugData.supplementalData.supplementalResultsUnstratified.length >
            0 && (
            <div className="mb-3">
              <Collapsible
                trigger={
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: "pointer" }}
                  >
                    <FaCaretRight
                      className="mr-2"
                      style={{
                        transform: openDebugSections["unstratified"]
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                    <Text size="3" weight="medium">
                      Supplemental: Unstratified
                    </Text>
                  </div>
                }
                onOpening={() => toggleDebugSection("unstratified")}
                onClosing={() => toggleDebugSection("unstratified")}
              >
                <div className="mt-2">
                  <Code
                    code={JSON.stringify(
                      debugData.supplementalData
                        .supplementalResultsUnstratified,
                      null,
                      2,
                    )}
                    language="json"
                    showLineNumbers={false}
                  />
                </div>
              </Collapsible>
            </div>
          )}

          {/* Supplemental Results Flat Prior */}
          {debugData.supplementalData.supplementalResultsFlatPrior.length >
            0 && (
            <div className="mb-3">
              <Collapsible
                trigger={
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: "pointer" }}
                  >
                    <FaCaretRight
                      className="mr-2"
                      style={{
                        transform: openDebugSections["flatPrior"]
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                    <Text size="3" weight="medium">
                      Supplemental: Flat Prior
                    </Text>
                  </div>
                }
                onOpening={() => toggleDebugSection("flatPrior")}
                onClosing={() => toggleDebugSection("flatPrior")}
              >
                <div className="mt-2">
                  <Code
                    code={JSON.stringify(
                      debugData.supplementalData.supplementalResultsFlatPrior,
                      null,
                      2,
                    )}
                    language="json"
                    showLineNumbers={false}
                  />
                </div>
              </Collapsible>
            </div>
          )}

          {/* Full Row Data */}
          <div className="mb-3">
            <Collapsible
              trigger={
                <div
                  className="d-flex align-items-center"
                  style={{ cursor: "pointer" }}
                >
                  <FaCaretRight
                    className="mr-2"
                    style={{
                      transform: openDebugSections["fullRow"]
                        ? "rotate(90deg)"
                        : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  />
                  <Text size="3" weight="medium">
                    Full Row Data (All Variations)
                  </Text>
                </div>
              }
              onOpening={() => toggleDebugSection("fullRow")}
              onClosing={() => toggleDebugSection("fullRow")}
            >
              <div className="mt-2">
                <Code
                  code={JSON.stringify(debugData.fullRowData, null, 2)}
                  language="json"
                  showLineNumbers={false}
                  maxHeight="500px"
                />
              </div>
            </Collapsible>
          </div>

          {/* Snapshot Data */}
          {debugData.snapshotData && (
            <div className="mb-3">
              <Collapsible
                trigger={
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: "pointer" }}
                  >
                    <FaCaretRight
                      className="mr-2"
                      style={{
                        transform: openDebugSections["snapshot"]
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                    <Text size="3" weight="medium">
                      Experiment Snapshot
                    </Text>
                  </div>
                }
                onOpening={() => toggleDebugSection("snapshot")}
                onClosing={() => toggleDebugSection("snapshot")}
              >
                <div className="mt-2">
                  <Code
                    code={JSON.stringify(debugData.snapshotData, null, 2)}
                    language="json"
                    showLineNumbers={false}
                    maxHeight="500px"
                  />
                </div>
              </Collapsible>
            </div>
          )}

          {/* Analysis Data */}
          {debugData.analysisData && (
            <div className="mb-3">
              <Collapsible
                trigger={
                  <div
                    className="d-flex align-items-center"
                    style={{ cursor: "pointer" }}
                  >
                    <FaCaretRight
                      className="mr-2"
                      style={{
                        transform: openDebugSections["analysis"]
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.2s",
                      }}
                    />
                    <Text size="3" weight="medium">
                      Snapshot Analysis
                    </Text>
                  </div>
                }
                onOpening={() => toggleDebugSection("analysis")}
                onClosing={() => toggleDebugSection("analysis")}
              >
                <div className="mt-2">
                  <Code
                    code={JSON.stringify(debugData.analysisData, null, 2)}
                    language="json"
                    showLineNumbers={false}
                    maxHeight="500px"
                  />
                </div>
              </Collapsible>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default SupplementalResultsSection;
