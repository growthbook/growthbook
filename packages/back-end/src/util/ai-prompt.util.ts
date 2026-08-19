import { ExperimentInterface } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  ExperimentMetricInterface,
  getLatestPhaseVariations,
  isFactMetric,
} from "shared/experiments";
import { getSnapshotAnalysis } from "shared/util";

export const MAX_HYPOTHESIS_CHARS = 600;
export const MAX_DESCRIPTION_CHARS = 1500;
export const MAX_ANALYSIS_CHARS = 2000;
export const MAX_VARIATION_DESCRIPTION_CHARS = 300;
export const MAX_QUERY_FILTER_CHARS = 300;
// A snapshot can hold results for hundreds of metrics; past this many the
// prompt costs more than the extra metrics are worth to the analysis. Size
// scales with metrics x variations: at this cap a 2-variation experiment is
// ~40k tokens and an 8-variation one ~140k, so the worst case still fits the
// smallest default model's window (Haiku 4.5 at 200k), but not by much.
export const MAX_METRICS_FOR_AI = 400;

// Each role is guaranteed a share of the cap so a long list of goal metrics
// can never push every guardrail out of the summary. Unclaimed budget is
// handed back out in this same order, so a role is only capped when the
// others actually need their share.
export const METRIC_ROLE_RESERVATIONS: Record<AIMetricRole, number> = {
  goal: 240,
  guardrail: 120,
  secondary: 40,
};

export function truncateForAI(s: string | undefined, maxChars: number): string {
  if (!s) return "";
  return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
}

export function roundForAI(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function toISODate(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  const date = new Date(d);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

function roundPairForAI(pair: [number, number]): [number, number] {
  return [roundForAI(pair[0]), roundForAI(pair[1])];
}

export type AIMetricVariationResult = {
  variation: string;
  users: number;
  value?: number;
  cr?: number;
  lift?: number;
  ci?: [number, number];
  chanceToWin?: number;
  pValue?: number;
};

export type AIMetricRole = "goal" | "guardrail" | "secondary";

export type AIMetricResult = {
  metric: string;
  role: AIMetricRole;
  metricType: string;
  betterDirection: "higher" | "lower";
  variations: AIMetricVariationResult[];
};

export type AIPhaseSummary = {
  name: string;
  reason: string;
  startDate?: string;
  endDate?: string;
};

export type AIHealthSummary = {
  power?: number;
  isLowPowered?: boolean;
  additionalDaysNeeded?: number;
  covariateImbalance?: boolean;
  trafficError?: string;
};

export type AIExperimentSummary = {
  experiment: {
    id: string;
    name: string;
    status: string;
    hypothesis: string;
    description: string;
    priorAnalysis: string;
    variations: { name: string; description: string; weight?: number }[];
    startDate?: string;
    endDate?: string;
    coverage?: number;
    priorPhases?: AIPhaseSummary[];
  };
  results?: {
    statsEngine: string;
    differenceType: string;
    pValueThreshold?: number;
    pValueCorrection?: string;
    sequentialTesting?: boolean;
    regressionAdjusted?: boolean;
    srmPValue: number;
    srmThreshold: number;
    multipleExposures: number;
    metrics: AIMetricResult[];
    droppedMetrics?: Partial<Record<AIMetricRole, number>>;
    health?: AIHealthSummary;
    segment?: string;
    queryFilter?: string;
    unknownVariations?: string[];
  };
};

function allocateMetricBudget(
  counts: Record<AIMetricRole, number>,
): Record<AIMetricRole, number> {
  const order: AIMetricRole[] = ["goal", "guardrail", "secondary"];
  const allocated: Record<AIMetricRole, number> = {
    goal: 0,
    guardrail: 0,
    secondary: 0,
  };

  let remaining = MAX_METRICS_FOR_AI;
  for (const role of order) {
    allocated[role] = Math.min(counts[role], METRIC_ROLE_RESERVATIONS[role]);
    remaining -= allocated[role];
  }
  for (const role of order) {
    const extra = Math.min(counts[role] - allocated[role], remaining);
    allocated[role] += extra;
    remaining -= extra;
  }

  return allocated;
}

function summarizeMetricResults({
  analysis,
  metricMap,
  variationNames,
  goalMetricIds,
  secondaryMetricIds,
  guardrailMetricIds,
}: {
  analysis: ExperimentSnapshotAnalysis;
  metricMap: Map<string, ExperimentMetricInterface>;
  variationNames: string[];
  goalMetricIds: string[];
  secondaryMetricIds: string[];
  guardrailMetricIds: string[];
}): {
  metrics: AIMetricResult[];
  droppedMetrics: Partial<Record<AIMetricRole, number>>;
} | null {
  const overall = analysis.results?.[0];
  if (!overall) return null;

  const roleOrder: [AIMetricRole, string[]][] = [
    ["goal", goalMetricIds],
    ["guardrail", guardrailMetricIds],
    ["secondary", secondaryMetricIds],
  ];

  const byRole: Record<AIMetricRole, AIMetricResult[]> = {
    goal: [],
    guardrail: [],
    secondary: [],
  };
  const seen = new Set<string>();

  for (const [role, metricIds] of roleOrder) {
    for (const metricId of metricIds) {
      if (seen.has(metricId)) continue;
      seen.add(metricId);

      const metric = metricMap.get(metricId);
      if (!metric) continue;

      const variations: AIMetricVariationResult[] = [];
      overall.variations.forEach((variation, i) => {
        const m = variation.metrics?.[metricId];
        if (!m) return;
        const row: AIMetricVariationResult = {
          variation: variationNames[i] || `Variation ${i}`,
          users: m.users ?? variation.users,
        };
        if (typeof m.value === "number") row.value = roundForAI(m.value);
        if (typeof m.cr === "number") row.cr = roundForAI(m.cr);
        if (typeof m.expected === "number") row.lift = roundForAI(m.expected);
        const ci = m.ciAdjusted ?? m.ci;
        if (ci) row.ci = roundPairForAI(ci);
        if (typeof m.chanceToWin === "number") {
          row.chanceToWin = roundForAI(m.chanceToWin);
        }
        const pValue = m.pValueAdjusted ?? m.pValue;
        if (typeof pValue === "number") row.pValue = roundForAI(pValue);
        variations.push(row);
      });

      if (!variations.length) continue;

      byRole[role].push({
        metric: metric.name || metricId,
        role,
        metricType: isFactMetric(metric) ? metric.metricType : metric.type,
        betterDirection: metric.inverse ? "lower" : "higher",
        variations,
      });
    }
  }

  const budget = allocateMetricBudget({
    goal: byRole.goal.length,
    guardrail: byRole.guardrail.length,
    secondary: byRole.secondary.length,
  });

  const metrics: AIMetricResult[] = [];
  const droppedMetrics: Partial<Record<AIMetricRole, number>> = {};
  for (const [role] of roleOrder) {
    metrics.push(...byRole[role].slice(0, budget[role]));
    const dropped = byRole[role].length - budget[role];
    if (dropped > 0) droppedMetrics[role] = dropped;
  }

  return { metrics, droppedMetrics };
}

// health.traffic is a per-day, per-dimension time series and health.power
// carries a row per metric and variation; only the top-level verdicts are
// worth prompt space.
function summarizeHealth(
  snapshot: ExperimentSnapshotInterface,
): AIHealthSummary | undefined {
  const { power, covariateImbalance, traffic } = snapshot.health || {};

  const health: AIHealthSummary = {};
  if (power) {
    health.isLowPowered = power.isLowPowered;
    if (power.type === "success") {
      health.power = roundForAI(power.power);
      health.additionalDaysNeeded = power.additionalDaysNeeded;
    }
  }
  if (covariateImbalance) {
    health.covariateImbalance = covariateImbalance.isImbalanced;
  }
  if (traffic?.error) health.trafficError = traffic.error;

  return Object.keys(health).length ? health : undefined;
}

export function summarizeExperimentAnalysisForAI({
  experiment,
  snapshot,
  metricMap,
  goalMetricIds,
  secondaryMetricIds,
  guardrailMetricIds,
  segmentName,
  srmThreshold,
}: {
  experiment: ExperimentInterface;
  snapshot: ExperimentSnapshotInterface | undefined;
  metricMap: Map<string, ExperimentMetricInterface>;
  goalMetricIds: string[];
  secondaryMetricIds: string[];
  guardrailMetricIds: string[];
  segmentName?: string | null;
  srmThreshold: number;
}): AIExperimentSummary {
  const phases = experiment.phases || [];
  const lastPhase = phases[phases.length - 1];
  // Snapshot results are indexed against the latest phase's variation list,
  // which can reorder or omit entries relative to experiment.variations.
  const phaseVariations = getLatestPhaseVariations(experiment);
  // Results only describe the last phase, so earlier ones are listed as
  // context rather than mixed in with the numbers.
  const priorPhases: AIPhaseSummary[] = phases.slice(0, -1).map((phase) => ({
    name: phase.name,
    reason: phase.reason,
    startDate: toISODate(phase.dateStarted),
    endDate: toISODate(phase.dateEnded),
  }));
  const variationNames = phaseVariations.map(
    (v, i) => v.name || `Variation ${i}`,
  );

  const summary: AIExperimentSummary = {
    experiment: {
      id: experiment.id,
      name: experiment.name,
      status: experiment.status,
      hypothesis: truncateForAI(experiment.hypothesis, MAX_HYPOTHESIS_CHARS),
      description: truncateForAI(experiment.description, MAX_DESCRIPTION_CHARS),
      priorAnalysis: truncateForAI(experiment.analysis, MAX_ANALYSIS_CHARS),
      variations: phaseVariations.map((v, i) => ({
        name: variationNames[i],
        description: truncateForAI(
          v.description,
          MAX_VARIATION_DESCRIPTION_CHARS,
        ),
        weight: lastPhase?.variationWeights?.[i],
      })),
      startDate: toISODate(lastPhase?.dateStarted),
      endDate: toISODate(lastPhase?.dateEnded),
      coverage: lastPhase?.coverage,
      ...(priorPhases.length ? { priorPhases } : {}),
    },
  };

  if (!snapshot) return summary;

  const analysis = getSnapshotAnalysis(snapshot);
  if (!analysis) return summary;

  const metricResults = summarizeMetricResults({
    analysis,
    metricMap,
    variationNames,
    goalMetricIds,
    secondaryMetricIds,
    guardrailMetricIds,
  });
  if (!metricResults) return summary;

  const health = summarizeHealth(snapshot);

  summary.results = {
    statsEngine: analysis.settings.statsEngine,
    differenceType: analysis.settings.differenceType,
    pValueThreshold: analysis.settings.pValueThreshold,
    pValueCorrection: analysis.settings.pValueCorrection ?? undefined,
    sequentialTesting: analysis.settings.sequentialTesting,
    regressionAdjusted: analysis.settings.regressionAdjusted,
    srmPValue: roundForAI(analysis.results[0].srm),
    srmThreshold,
    multipleExposures: snapshot.multipleExposures,
    metrics: metricResults.metrics,
    ...(Object.keys(metricResults.droppedMetrics).length
      ? { droppedMetrics: metricResults.droppedMetrics }
      : {}),
    ...(health ? { health } : {}),
    // Both scope the analysis to a subset of users, so a summary that omits
    // them reads as if it covered everyone.
    ...(snapshot.settings?.segment
      ? { segment: segmentName || snapshot.settings.segment }
      : {}),
    ...(snapshot.settings?.queryFilter
      ? {
          queryFilter: truncateForAI(
            snapshot.settings.queryFilter,
            MAX_QUERY_FILTER_CHARS,
          ),
        }
      : {}),
    ...(snapshot.unknownVariations?.length
      ? { unknownVariations: snapshot.unknownVariations }
      : {}),
  };

  return summary;
}
