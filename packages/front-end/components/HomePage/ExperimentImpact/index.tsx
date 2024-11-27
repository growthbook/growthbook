import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { MdInfoOutline } from "react-icons/md";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { datetime, getValidDate } from "shared/dates";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import MetricSelector from "@/components/Experiment/MetricSelector";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Radix/Tabs";
import DatePicker from "@/components/DatePicker";
import { jamesSteinAdjustment } from "./JamesSteinAdjustment";
import ExperimentImpactTab from "./ExperimentImpactTab";
import ImpactMetrics from "./ImpactMetrics";

export function NoExperimentsForImpactBanner() {
  return (
    <div className={`mt-2 alert alert-warning`}>
      <span style={{ fontSize: "1.2em" }}>
        0 experiments for which we could compute scaled impact match your
        filters.
      </span>
    </div>
  );
}

export function formatImpact(
  impact: number,
  formatter: (
    value: number,
    options?: Intl.NumberFormatOptions | undefined
  ) => string,
  formatterOptions: Intl.NumberFormatOptions
) {
  return (
    <>
      <span className="expectedArrows">
        {impact > 0 ? <FaArrowUp /> : impact < 0 ? <FaArrowDown /> : null}
      </span>{" "}
      <span className="expected font-weight-bold">
        {formatter(impact, { ...formatterOptions, signDisplay: "never" })}
      </span>
    </>
  );
}

export type ExperimentImpactType = "winner" | "loser" | "other";
type ExperimentWithImpact = {
  experiment: ExperimentInterfaceStringDates;
  variationImpact: {
    scaledImpact: number;
    scaledImpactAdjusted?: number;
    se: number;
    selected: boolean;
  }[];
  type: ExperimentImpactType;
  keyVariationId?: number;
  error?: string;
};

export type ExperimentImpactTab = ExperimentImpactType | "summary";

export type ExperimentImpactData = {
  totalAdjustedImpact: number;
  totalAdjustedImpactVariance: number;
  experiments: ExperimentWithImpact[];
};

type ExperimentImpactSummary = {
  winners: ExperimentImpactData;
  losers: ExperimentImpactData;
  others: ExperimentImpactData;
};

function scaleImpactAndSetMissingExperiments({
  experiments,
  snapshots,
  metric,
  selectedProjects,
  startDate,
  endDate,
  adjusted,
}: {
  experiments: ExperimentInterfaceStringDates[];
  snapshots: ExperimentSnapshotInterface[] | undefined;
  metric: string;
  selectedProjects: string[];
  startDate: string;
  endDate: string | undefined;
  adjusted: boolean;
}): {
  summaryObj: ExperimentImpactSummary | null;
  nExpsUsedForAdjustment: number;
  experimentsWithNoImpact: string[];
} {
  // experiments that fit the filter
  const exps = experiments
    .filter((e) => {
      if (!e.phases.length) return false;
      const experimentEndDate = getValidDate(
        e.phases[e.phases.length - 1]?.dateEnded
      );
      const filterStartDate = getValidDate(startDate);
      const filterEndDate = getValidDate(endDate ?? new Date());

      const endedAfterStart = experimentEndDate > filterStartDate;
      const endedBeforeEnd = experimentEndDate < filterEndDate;
      const isRunningAndEndInFuture =
        e.status === "running" &&
        (!endDate || getValidDate(endDate) > new Date());

      const fitsDateFilter =
        (endedAfterStart && endedBeforeEnd) || isRunningAndEndInFuture;
      const hasMetric = getAllMetricIdsFromExperiment(e, false).includes(
        metric
      );
      const inSelectedProject =
        selectedProjects.includes(e.project ?? "") || !selectedProjects.length;

      return hasMetric && fitsDateFilter && inSelectedProject;
    })
    .sort(
      (a, b) =>
        getValidDate(
          b.phases[b.phases.length - 1].dateEnded ?? new Date()
        ).getTime() -
        getValidDate(
          a.phases[a.phases.length - 1].dateEnded ?? new Date()
        ).getTime()
    );

  let nExpsUsedForAdjustment = 0;
  const experimentsWithNoImpact: string[] = [];
  const experimentImpacts = new Map<string, ExperimentWithImpact>();
  let summaryObj: ExperimentImpactSummary | null = null;
  if (snapshots && exps) {
    // use largest experiment for population sampling variance
    const maxUnits = 0;
    let overallSE: number | null = null;
    const allScaledImpacts: number[] = [];
    exps.forEach((e) => {
      const s = snapshots.find((s) => s.experiment === e.id);

      const summary =
        e.results === "won" && !!e.winner && e.status === "stopped"
          ? "winner"
          : e.results === "lost" && e.status === "stopped"
          ? "loser"
          : "other";

      const ei: ExperimentWithImpact = {
        experiment: e,
        type: summary,
        variationImpact: [],
      };

      if (s) {
        const defaultAnalysis = getSnapshotAnalysis(s);
        const defaultSettings = defaultAnalysis?.settings;
        const scaledAnalysis = defaultSettings
          ? getSnapshotAnalysis(s, {
              ...defaultSettings,
              differenceType: "scaled",
            })
          : null;

        if (scaledAnalysis && scaledAnalysis.results.length) {
          // count experiments used for James-Stein adjustment
          nExpsUsedForAdjustment += 1;

          // no dim so always get first value
          const res = scaledAnalysis.results[0];
          res.variations.forEach((v, i) => {
            if (i !== 0) {
              const se = v?.metrics[metric]?.uplift?.stddev ?? 0;
              const impact = v?.metrics[metric]?.expected ?? 0;
              ei.variationImpact.push({
                scaledImpact: impact,
                selected: e.winner === i,
                se: se,
              });

              allScaledImpacts.push(impact);

              const totalUnits = v.users + res.variations[0].users;
              if (totalUnits > maxUnits && se > 0) {
                overallSE = se;
              }
            }
          });
        } else {
          if (defaultAnalysis && defaultAnalysis.status === "success") {
            ei.error =
              "No snapshot with scaled impact available. Click calculate button above.";
            experimentsWithNoImpact.push(e.id);
          } else {
            ei.error =
              "No results available. Check experiment results for errors.";
          }
        }
      } else {
        ei.error =
          "No results available. Run experiment update on experiment page.";
      }
      experimentImpacts.set(e.id, ei);
    });

    const adjustment = jamesSteinAdjustment(allScaledImpacts, overallSE ?? 0);

    const applyAdjustment = adjusted && nExpsUsedForAdjustment >= 5;
    summaryObj = {
      winners: {
        totalAdjustedImpact: 0,
        totalAdjustedImpactVariance: 0,
        experiments: [],
      },
      losers: {
        totalAdjustedImpact: 0,
        totalAdjustedImpactVariance: 0,
        experiments: [],
      },
      others: {
        totalAdjustedImpact: 0,
        totalAdjustedImpactVariance: 0,
        experiments: [],
      },
    };
    for (const e of experimentImpacts.values()) {
      let experimentImpact: number | null = null;
      let experimentAdjustedImpact: number | null = null;
      let experimentAdjustedImpactStdDev: number | null = null;

      e.variationImpact.forEach((v, vi) => {
        const adjustedImpact =
          adjustment.mean +
          (1 - adjustment.adjustment) * (v.scaledImpact - adjustment.mean);
        v.scaledImpactAdjusted = applyAdjustment
          ? adjustedImpact
          : v.scaledImpact;

        if (e.type === "winner" && v.selected) {
          e.keyVariationId = vi + 1;
          experimentImpact = v.scaledImpact;
          experimentAdjustedImpact = v.scaledImpactAdjusted;
          experimentAdjustedImpactStdDev = v.se;
        } else if (e.type === "loser") {
          // only include biggest loser for "savings"
          if (v.scaledImpact < (experimentImpact ?? Infinity)) {
            e.keyVariationId = vi + 1;
            experimentImpact = v.scaledImpact;
            experimentAdjustedImpact = v.scaledImpactAdjusted;
            experimentAdjustedImpactStdDev = v.se;
          }
        }
      });

      if (e.type === "winner") {
        summaryObj.winners.totalAdjustedImpact += experimentAdjustedImpact ?? 0;
        summaryObj.winners.totalAdjustedImpactVariance += Math.pow(
          experimentAdjustedImpactStdDev ?? 0,
          2
        );
        summaryObj.winners.experiments.push(e);
      } else if (e.type === "loser") {
        // invert sign of lost impact
        summaryObj.losers.totalAdjustedImpact -= experimentAdjustedImpact ?? 0;
        summaryObj.losers.totalAdjustedImpactVariance += Math.pow(
          experimentAdjustedImpactStdDev ?? 0,
          2
        );
        summaryObj.losers.experiments.push(e);
      } else {
        summaryObj.others.experiments.push(e);
      }
    }
  }
  return {
    summaryObj,
    nExpsUsedForAdjustment,
    experimentsWithNoImpact,
  };
}

export default function ExperimentImpact() {
  const [activeTab, setActiveTab] = useState("weekly");

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
      <TabsList>
        <TabsTrigger value="weekly">Weekly</TabsTrigger>
        <TabsTrigger value="monthly">Monthly</TabsTrigger>
        <TabsTrigger value="yearly">Yearly</TabsTrigger>
      </TabsList>
      <TabsContent value="weekly">
        <ImpactMetrics period="weekly" />
      </TabsContent>
      <TabsContent value="monthly">
        <ImpactMetrics period="monthly" />
      </TabsContent>
      <TabsContent value="yearly">
        <ImpactMetrics period="yearly" />
      </TabsContent>
    </Tabs>
  );
}
