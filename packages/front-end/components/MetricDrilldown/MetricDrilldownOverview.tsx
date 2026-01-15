import ResultsTable from "@/components/Experiment/ResultsTable";

function MetricDrilldownOverview({
  experimentId,
  reportDate,
  isLatestPhase,
  phase,
  startDate,
  endDate,
  experimentStatus,
  variations,
  localBaselineRow,
  setLocalBaselineRow,
  localVariationFilter,
  setLocalVariationFilter,
  rows,
  id,
  resultGroup,
  tableRowAxis,
  labelHeader,
  renderLabelColumn,
  statsEngine,
  pValueCorrection,
  differenceType,
  setDifferenceType,
  sequentialTestingEnabled,
  isTabActive,
  noStickyHeader,
  noTooltip,
  isBandit,
  isHoldout,
  skipLabelRow,
}: any) {
  return (
    <>
      <ResultsTable
        experimentId={experimentId}
        dateCreated={reportDate}
        isLatestPhase={isLatestPhase}
        phase={phase}
        startDate={startDate}
        endDate={endDate}
        status={experimentStatus}
        variations={variations}
        baselineRow={localBaselineRow}
        setBaselineRow={setLocalBaselineRow}
        variationFilter={localVariationFilter}
        setVariationFilter={setLocalVariationFilter}
        rows={[row]}
        id={`${experimentId}_${metric.id}_modal`}
        resultGroup={
          goalMetrics.includes(metric.id)
            ? "goal"
            : secondaryMetrics.includes(metric.id)
              ? "secondary"
              : "guardrail"
        }
        tableRowAxis="metric"
        labelHeader=""
        renderLabelColumn={({ label }) => label}
        statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
        pValueCorrection={pValueCorrection}
        differenceType={localDifferenceType}
        setDifferenceType={setLocalDifferenceType}
        sequentialTestingEnabled={sequentialTestingEnabled}
        isTabActive={activeTab === "overview"}
        noStickyHeader={true}
        noTooltip={false}
        isBandit={false}
        isHoldout={false}
        skipLabelRow
      />
      <ExperimentMetricTimeSeriesGraphWrapper
        experimentId={experimentId}
        phase={phase}
        experimentStatus={experimentStatus}
        metric={metric}
        differenceType={localDifferenceType}
        variationNames={variationNames}
        showVariations={localShowVariations}
        statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
        pValueAdjustmentEnabled={pValueAdjustmentEnabled}
        firstDateToRender={firstDateToRender}
        sliceId={sliceId}
      />
    </>
  );
}

export default MetricDrilldownOverview;
