import {
  ExperimentMetricInterface,
  getAllMetricSettingsForSnapshot,
} from "shared/experiments";
import { getScopedSettings } from "shared/settings";
import {
  ExperimentMetricQueryParams,
  ExperimentMetricQueryResponseRows,
} from "shared/types/integrations";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  SnapshotBanditSettings,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { DataSourceInterface, ExposureQuery } from "shared/types/datasource";
import { MetricPriorSettings } from "shared/types/fact-table";
import { OrganizationSettings } from "shared/types/organization";
import {
  ContextualBanditInterface,
  ContextualBanditEventInterface,
} from "shared/validators";
import { MetricInterface } from "shared/types/metric";
import { ApiReqContext } from "back-end/types/api";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import {
  getDefaultExperimentAnalysisSettings,
  getSnapshotSettings,
} from "back-end/src/services/experiments";
import { getFactMetricGroups } from "back-end/src/services/experimentQueries/experimentQueries";
import {
  FactTableMap,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { expandDenominatorMetrics } from "back-end/src/util/sql";

export type ContextualBanditQueryResult = {
  rows: ExperimentMetricQueryResponseRows;
  durationMs: number;
  sql?: string;
};

export type ContextualBanditSnapshotContext = {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  decisionMetric: ExperimentMetricInterface;
};

/** Representative arm weights from a CBE (first leaf with updated weights). */
export function weightsFromContextualBanditEvent(
  cbe: ContextualBanditEventInterface,
): number[] {
  const response = cbe.responses.find((r) => r.updatedWeights?.length);
  return response?.updatedWeights ?? [];
}

export function totalUsersFromContextualBanditEvent(
  cbe: ContextualBanditEventInterface,
): number {
  return cbe.responses.reduce((sum, r) => {
    const perVar = r.sampleSizePerVariation ?? [];
    return sum + perVar.reduce((a, b) => a + b, 0);
  }, 0);
}

/**
 * Bandit period boundaries for SQL period weighting and RA theta.
 * Mirrors MAB `historicalWeights`: phase start plus each reweight event.
 */
export function buildContextualBanditHistoricalWeights(
  experiment: ExperimentInterface,
  phase: number,
  cb: ContextualBanditInterface,
  cbeEvents: ContextualBanditEventInterface[],
): SnapshotBanditSettings["historicalWeights"] {
  const numVariations = experiment.variations?.length ?? 1;
  const equalWeights = Array(numVariations).fill(1 / numVariations);
  const expPhase = experiment.phases?.[phase];
  const cbPhase = cb.phases[phase];

  const phaseStart =
    expPhase?.dateStarted ?? cbPhase?.dateStarted ?? new Date();

  const historicalWeights: SnapshotBanditSettings["historicalWeights"] = [
    {
      date: phaseStart,
      weights: equalWeights,
      totalUsers: 0,
    },
  ];

  const reweightEvents = [...cbeEvents]
    .filter((e) => e.weightsWereUpdated)
    .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime());

  for (const event of reweightEvents) {
    const weights = weightsFromContextualBanditEvent(event);
    if (weights.length !== numVariations) {
      continue;
    }
    historicalWeights.push({
      date: event.dateCreated,
      weights,
      totalUsers: totalUsersFromContextualBanditEvent(event),
    });
  }

  return historicalWeights;
}

function buildContextualBanditSnapshotBanditSettings(
  experiment: ExperimentInterface,
  phase: number,
  cb: ContextualBanditInterface,
  decisionMetricId: string,
  targetingAttributeColumns: string[],
  historicalWeights: SnapshotBanditSettings["historicalWeights"],
  existing?: SnapshotBanditSettings,
): SnapshotBanditSettings {
  if (existing) {
    return {
      ...existing,
      banditIsContextual: true,
      targetingAttributeColumns,
      historicalWeights,
    };
  }

  const numVariations = experiment.variations?.length ?? 1;
  const equalWeights = Array(numVariations).fill(1 / numVariations);
  const expPhase = experiment.phases?.[phase];

  return {
    reweight: true,
    decisionMetric: decisionMetricId,
    seed: phase,
    currentWeights:
      cb.phases[phase]?.currentLeafWeights?.[0]?.weights ??
      expPhase?.variationWeights ??
      equalWeights,
    historicalWeights,
    useFirstExposure: true,
    banditIsContextual: true,
    targetingAttributeColumns,
  };
}

export async function loadContextualBanditSnapshotContext(
  context: ApiReqContext,
  experiment: ExperimentInterface,
  phase: number,
  cb: ContextualBanditInterface,
  datasource: DataSourceInterface,
  exposureQuery?: ExposureQuery,
): Promise<ContextualBanditSnapshotContext> {
  const decisionMetricId = experiment.goalMetrics?.[0];
  if (!decisionMetricId) {
    throw new Error("Contextual bandit experiment must have a goal metric");
  }

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  const decisionMetric = metricMap.get(decisionMetricId);
  if (!decisionMetric) {
    throw new Error(`Decision metric not found: ${decisionMetricId}`);
  }

  const { org } = context;
  let project = null;
  if (experiment.project) {
    project = await context.models.projects.getById(experiment.project);
  }
  const { settings: scopedSettings } = getScopedSettings({
    organization: org,
    project: project ?? undefined,
    experiment,
  });
  const orgSettings = org.settings as OrganizationSettings;
  const metricGroups = await context.models.metricGroups.getAll();

  const { settingsForSnapshotMetrics, regressionAdjustmentEnabled } =
    getAllMetricSettingsForSnapshot({
      allExperimentMetrics: [decisionMetric],
      denominatorMetrics: [],
      orgSettings,
      experimentRegressionAdjustmentEnabled:
        experiment.regressionAdjustmentEnabled,
      experimentMetricOverrides: experiment.metricOverrides,
      datasourceType: datasource.type,
      hasRegressionAdjustmentFeature: true,
    });

  const analysisSettings = getDefaultExperimentAnalysisSettings({
    statsEngine: "bayesian",
    experiment,
    organization: org,
    regressionAdjustmentEnabled,
    postStratificationEnabled: scopedSettings.postStratificationEnabled.value,
    dimension: undefined,
    pValueThreshold: scopedSettings.pValueThreshold.value,
    metricGroups,
  });

  const fullSettings = getSnapshotSettings({
    experiment,
    phaseIndex: phase,
    snapshotType: "standard",
    dimension: null,
    regressionAdjustmentEnabled,
    orgPriorSettings: orgSettings.metricDefaults as
      | MetricPriorSettings
      | undefined,
    orgDisabledPrecomputedDimensions:
      !!orgSettings.disablePrecomputedDimensions,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
    incrementalRefreshModel: null,
    reweight: true,
    datasource,
    useStickyBucketing: false,
  });

  const targetingAttributeColumns =
    exposureQuery?.targetingAttributeColumns ?? cb.contextualAttributes;

  const cbeEvents =
    await context.models.contextualBanditEvents.listForExperiment(
      experiment.id,
      phase,
      100,
    );
  const historicalWeights = buildContextualBanditHistoricalWeights(
    experiment,
    phase,
    cb,
    cbeEvents,
  );

  const snapshotSettings: ExperimentSnapshotSettings = {
    ...fullSettings,
    goalMetrics: [decisionMetricId],
    secondaryMetrics: [],
    guardrailMetrics: [],
    metricSettings: fullSettings.metricSettings.filter(
      (m) => m.id === decisionMetricId,
    ),
    banditSettings: buildContextualBanditSnapshotBanditSettings(
      experiment,
      phase,
      cb,
      decisionMetricId,
      targetingAttributeColumns,
      historicalWeights,
      fullSettings.banditSettings,
    ),
  };

  if (!snapshotSettings.banditSettings?.targetingAttributeColumns?.length) {
    throw new Error(
      "Contextual bandit snapshot requires targeting attribute columns on the assignment query",
    );
  }

  return {
    snapshotSettings,
    analysisSettings,
    metricMap,
    factTableMap,
    decisionMetric,
  };
}

export type ContextualBanditMetricQueryPlan = {
  sql: string;
  execute: (sql: string) => Promise<ExperimentMetricQueryResponseRows>;
};

export async function planContextualBanditMetricQuery(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<ContextualBanditMetricQueryPlan> {
  const integration = await getIntegrationFromDatasourceId(
    context,
    datasource.id,
  );
  if (!integration.getExperimentMetricQuery) {
    throw new Error(
      "Datasource integration does not support experiment queries",
    );
  }

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  const { factMetricGroups, legacyMetricSingles } = getFactMetricGroups(
    [decisionMetric],
    snapshotSettings,
    integration,
    context.org,
  );

  if (factMetricGroups.length > 0) {
    const group = factMetricGroups[0];
    if (
      !integration.getExperimentFactMetricsQuery ||
      !integration.runExperimentFactMetricsQuery
    ) {
      throw new Error("Integration does not support fact metric queries");
    }
    const queryParams = {
      activationMetric,
      dimensions: [],
      metrics: group,
      segment: null,
      settings: snapshotSettings,
      unitsSource: "exposureQuery" as const,
      unitsTableFullName: "",
      factTableMap,
    };
    const sql = integration.getExperimentFactMetricsQuery(queryParams);
    return {
      sql,
      execute: async (querySql: string) => {
        const { rows } = await integration.runExperimentFactMetricsQuery!(
          querySql,
          async () => {},
        );
        return rows as ExperimentMetricQueryResponseRows;
      },
    };
  }

  const legacyMetric = legacyMetricSingles[0];
  if (!legacyMetric) {
    throw new Error("No runnable metric query for contextual bandit");
  }

  const denominatorMetrics: MetricInterface[] = [];
  if (legacyMetric.denominator) {
    denominatorMetrics.push(
      ...expandDenominatorMetrics(
        legacyMetric.denominator,
        metricMap as Map<string, MetricInterface>,
      )
        .map((m) => metricMap.get(m) as MetricInterface)
        .filter(Boolean),
    );
  }

  const queryParams: ExperimentMetricQueryParams = {
    activationMetric,
    denominatorMetrics,
    dimensions: [],
    metric: legacyMetric,
    segment: null,
    settings: snapshotSettings,
    unitsSource: "exposureQuery",
    unitsTableFullName: "",
    factTableMap,
  };

  const sql = integration.getExperimentMetricQuery(queryParams);
  return {
    sql,
    execute: async (querySql: string) => {
      const { rows } = await integration.runExperimentMetricQuery(
        querySql,
        async () => {},
      );
      return rows;
    },
  };
}

export async function buildContextualBanditMetricQuerySql(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<string> {
  const plan = await planContextualBanditMetricQuery(
    context,
    datasource,
    snapshotSettings,
    decisionMetric,
    factTableMap,
    metricMap,
  );
  return plan.sql;
}

export async function executeContextualBanditMetricQuery(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  sql: string,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<Omit<ContextualBanditQueryResult, "sql">> {
  const startMs = Date.now();
  const plan = await planContextualBanditMetricQuery(
    context,
    datasource,
    snapshotSettings,
    decisionMetric,
    factTableMap,
    metricMap,
  );
  const rows = await plan.execute(sql);
  return {
    rows,
    durationMs: Date.now() - startMs,
  };
}

export async function runContextualBanditMetricQuery(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<ContextualBanditQueryResult> {
  const plan = await planContextualBanditMetricQuery(
    context,
    datasource,
    snapshotSettings,
    decisionMetric,
    factTableMap,
    metricMap,
  );
  const startMs = Date.now();
  const rows = await plan.execute(plan.sql);
  return {
    rows,
    durationMs: Date.now() - startMs,
    sql: plan.sql,
  };
}
