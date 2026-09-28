import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import React, { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { LiaChartLineSolid } from "react-icons/lia";
import { TbChartAreaLineFilled } from "react-icons/tb";
import { BanditEvent } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getBanditSRMValue } from "shared/health";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import BanditSummaryTable from "@/components/Experiment/BanditSummaryTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import BanditDateGraph from "@/components/Experiment/BanditDateGraph";
import BanditUpdateStatus from "@/components/Experiment/TabbedPage/BanditUpdateStatus";
import { GBCuped } from "@/components/Icons";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import SegmentedControl from "@/ui/SegmentedControl";
import MultipleExposureWarning from "@/components/Experiment/MultipleExposureWarning";
import SRMWarning from "@/components/Experiment/SRMWarning";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate?: () => void;
  isTabActive?: boolean;
  ssrSnapshot?: ExperimentSnapshotInterface;
  ssrPolyfills?: SSRPolyfills;
  isPublic?: boolean;
}

export default function BanditSummaryResultsTab({
  experiment,
  mutate,
  isTabActive,
  ssrSnapshot,
  ssrPolyfills,
  isPublic,
}: Props) {
  const { getExperimentMetricById } = useDefinitions();

  const [chartMode, setChartMode] = useLocalStorage<
    "values" | "probabilities" | "weights"
  >(
    `banditSummaryResultsChartMode__${isPublic ? "public__" : ""}${
      experiment.id
    }`,
    "values",
  );
  const [chartType, setChartType] = useLocalStorage<"area" | "line">(
    `banditSummaryResultsChartType__${isPublic ? "public__" : ""}${
      experiment.id
    }`,
    "area",
  );
  const numPhases = experiment.phases.length;
  const [phase, setPhase] = useState<number>(experiment.phases.length - 1);
  const isCurrentPhase = phase === experiment.phases.length - 1;

  useEffect(() => {
    setPhase(numPhases - 1);
  }, [numPhases, setPhase]);

  const mid = experiment?.goalMetrics?.[0];
  const metric =
    ssrPolyfills?.getExperimentMetricById?.(mid) ||
    getExperimentMetricById(mid ?? "");

  const { latestSummary: _latest } = useSnapshot();
  const latest = _latest ?? ssrSnapshot;
  const multipleExposures = latest?.multipleExposures;

  const phaseObj = experiment.phases[phase];

  const showVisualizations =
    (phaseObj?.banditEvents?.length ?? 0) > 0 && experiment.status !== "draft";

  const event: BanditEvent | undefined =
    phaseObj?.banditEvents?.[(phaseObj?.banditEvents?.length ?? 1) - 1];
  const users = getLatestPhaseVariations(experiment).map(
    (_, i) => event?.banditResult?.singleVariationResults?.[i]?.users ?? 0,
  );
  const totalUsers = users.reduce((acc, cur) => acc + cur, 0);

  if (!metric) {
    return (
      <Callout status="warning" mx="3" mb="2">
        No metric was set for this Bandit.
      </Callout>
    );
  }

  return (
    <>
      <div className="d-flex mt-2 mb-3 align-items-end">
        <h3 className="mb-0">Bandit Leaderboard</h3>
      </div>
      <div className="box pt-3">
        {experiment.status === "draft" && (
          <Callout status="info" mx="3" mb="4">
            Your experiment is still in a <strong>draft</strong> state. You must
            start the experiment first before seeing results.
          </Callout>
        )}

        {isCurrentPhase &&
        experiment.status === "running" &&
        experiment.banditStage === "explore" ? (
          <Callout status="info" mx="3" mb="2">
            This Bandit is still in its <strong>Exploratory</strong> stage.
            Please wait a little while longer before variation weights update.
          </Callout>
        ) : null}
        {isCurrentPhase &&
        experiment.status === "running" &&
        !phaseObj?.banditEvents?.length ? (
          <Callout status="info" mx="3" mb="4">
            No data yet.
          </Callout>
        ) : null}
        {!isCurrentPhase && !phaseObj?.banditEvents?.length ? (
          <Callout status="info" mx="3" mb="4">
            No data available for this phase.
          </Callout>
        ) : null}

        {!isPublic && (
          <Flex direction="column" gap="2" mx="3">
            <SRMWarning
              srm={latest ? (getBanditSRMValue(latest) ?? Infinity) : Infinity}
              users={users}
              showWhenHealthy={false}
              isBandit={true}
            />
            <MultipleExposureWarning
              totalUsers={totalUsers}
              multipleExposures={multipleExposures ?? 0}
              experiment={experiment}
            />
          </Flex>
        )}

        {showVisualizations && (
          <>
            {/* Level with the metric rows of the experiment results table. */}
            <Flex align="center" gap="4" px="1">
              <Box flexGrow="1" minWidth="0">
                {metric
                  ? getRenderLabelColumn({})({
                      label: metric.name,
                      metric,
                    })
                  : null}
              </Box>
              {experiment.regressionAdjustmentEnabled && (
                <Flex align="center" gap="1">
                  <GBCuped size={13} />
                  <Text size="sm" color="text-low">
                    <Text weight="semibold">CUPED:</Text> Enabled
                  </Text>
                </Flex>
              )}
              {isCurrentPhase && (
                <BanditUpdateStatus
                  experiment={experiment}
                  mutate={mutate}
                  isPublic={isPublic}
                />
              )}
            </Flex>
            <BanditSummaryTable
              experiment={experiment}
              metric={metric}
              phase={phase}
              isTabActive={!!isTabActive}
              ssrPolyfills={ssrPolyfills}
            />
          </>
        )}
      </div>

      {showVisualizations && (
        <>
          <h3 className="mt-4 mb-3">Variation Performance over Time</h3>
          <div className="box px-3 py-2">
            <Flex gap="5" mb="4" wrap="wrap" align="start">
              <Flex direction="column" gap="1">
                <Text size="sm" weight="medium" color="text-mid">
                  Chart
                </Text>
                <SegmentedControl
                  wrap
                  aria-label="Chart"
                  value={chartMode}
                  setValue={setChartMode}
                  options={[
                    { value: "values", label: "Cumulative variation means" },
                    { value: "probabilities", label: "Probability of winning" },
                    { value: "weights", label: "Variation weights" },
                  ]}
                />
              </Flex>
              {chartMode !== "values" && (
                <Flex direction="column" gap="1">
                  <Text size="sm" weight="medium" color="text-mid">
                    Chart type
                  </Text>
                  <SegmentedControl
                    aria-label="Chart type"
                    value={chartType}
                    setValue={setChartType}
                    options={[
                      {
                        value: "area",
                        ariaLabel: "Area",
                        label: <TbChartAreaLineFilled size={18} />,
                      },
                      {
                        value: "line",
                        ariaLabel: "Line",
                        label: <LiaChartLineSolid size={18} />,
                      },
                    ]}
                  />
                </Flex>
              )}
            </Flex>
            <BanditDateGraph
              experiment={experiment}
              metric={metric}
              phase={phase}
              label={
                chartMode === "values"
                  ? undefined
                  : chartMode === "probabilities"
                    ? "Probability of Winning"
                    : "Variation Weight"
              }
              mode={chartMode}
              type={chartMode === "values" ? "line" : chartType}
              ssrPolyfills={ssrPolyfills}
              isPublic={isPublic}
            />
          </div>
        </>
      )}
    </>
  );
}
