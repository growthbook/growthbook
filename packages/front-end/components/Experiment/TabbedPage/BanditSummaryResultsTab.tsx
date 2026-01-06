import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { LiaChartLineSolid } from "react-icons/lia";
import { TbChartAreaLineFilled } from "react-icons/tb";
import { BanditEvent } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getSRMValue } from "shared/health";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import BanditSummaryTable from "@/components/Experiment/BanditSummaryTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import BanditDateGraph from "@/components/Experiment/BanditDateGraph";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import BanditUpdateStatus from "@/components/Experiment/TabbedPage/BanditUpdateStatus";
import PhaseSelector from "@/components/Experiment/PhaseSelector";
import { GBCuped } from "@/components/Icons";
import Callout from "@/ui/Callout";
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

  const { latest: _latest } = useSnapshot();
  const latest = _latest ?? ssrSnapshot;
  const multipleExposures = latest?.multipleExposures;

  const phaseObj = experiment.phases[phase];

  const showVisualizations =
    (phaseObj?.banditEvents?.length ?? 0) > 0 && experiment.status !== "draft";

  const event: BanditEvent | undefined =
    phaseObj?.banditEvents?.[(phaseObj?.banditEvents?.length ?? 1) - 1];
  const users = experiment.variations.map(
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
        <div className="flex-1" />
        {!isPublic && (
          <div style={{ marginBottom: -5 }}>
            <PhaseSelector phase={phase} setPhase={setPhase} isBandit={true} />
          </div>
        )}
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
              srm={
                latest
                  ? (getSRMValue("multi-armed-bandit", latest) ?? Infinity)
                  : Infinity
              }
              users={users}
              showWhenHealthy={false}
              isBandit={true}
            />
            <MultipleExposureWarning
              totalUsers={totalUsers}
              multipleExposures={multipleExposures ?? 0}
            />
          </Flex>
        )}

        {showVisualizations && (
          <>
            <div className="d-flex mx-3 align-items-center">
              <div className="h4 mb-0">
                {metric
                  ? getRenderLabelColumn({
                      statsEngine: "bayesian",
                      hideDetails: isPublic,
                      className: "",
                    })({
                      label: metric.name,
                      metric,
                    })
                  : null}
              </div>
              <div className="flex-1" />
              {experiment.regressionAdjustmentEnabled && (
                <div
                  className="d-inline-block text-muted text-right mr-1 user-select-none mr-4"
                  style={{ maxWidth: 130, fontSize: "0.8em" }}
                >
                  <span className="font-weight-bold">
                    <GBCuped size={13} /> CUPED:
                  </span>{" "}
                  <span className="">Enabled</span>
                </div>
              )}
              {isCurrentPhase && (
                <div className="d-flex align-items-center">
                  <BanditUpdateStatus
                    experiment={experiment}
                    mutate={mutate}
                    isPublic={isPublic}
                  />
                </div>
              )}
            </div>
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
            <div className="d-flex mb-4 pb-2">
              <div>
                <label className="uppercase-title">Chart</label>
                <ButtonSelectField
                  value={chartMode}
                  setValue={(v) => setChartMode(v)}
                  options={[
                    {
                      label: "Cumulative Variation Means",
                      value: "values",
                    },
                    {
                      label: "Probability of Winning",
                      value: "probabilities",
                    },
                    {
                      label: "Variation Weights",
                      value: "weights",
                    },
                  ]}
                />
              </div>
              {chartMode !== "values" && (
                <div className="ml-4">
                  <label className="uppercase-title">Chart type</label>
                  <ButtonSelectField
                    value={chartType}
                    setValue={(v) => setChartType(v)}
                    options={[
                      {
                        label: <TbChartAreaLineFilled size={20} />,
                        value: "area",
                      },
                      {
                        label: <LiaChartLineSolid size={20} />,
                        value: "line",
                      },
                    ]}
                  />
                </div>
              )}
            </div>
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
