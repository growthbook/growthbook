import { z } from "zod";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { getSelectedColumnDatatype } from "shared/experiments";
import { postFactMetricValidator } from "shared/validators";
import {
  ColumnRef,
  CreateFactMetricProps,
  FactMetricType,
  FactTableInterface,
} from "shared/types/fact-table";
import { OrganizationInterface } from "shared/types/organization";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";

export function validateAggregationSpecification({
  column,
  factTable,
  metricType,
  quantileType,
  quantileIgnoreZeros,
  quantileEventCountColumn,
  errorPrefix,
}: {
  column: ColumnRef;
  factTable: FactTableInterface;
  metricType?: FactMetricType;
  quantileType?: "unit" | "event";
  quantileIgnoreZeros?: boolean;
  quantileEventCountColumn?: string;
  errorPrefix?: string;
}) {
  const datatype = getSelectedColumnDatatype({
    factTable,
    column: column.column,
  });
  if (column.aggregation === "count distinct" && datatype !== "string") {
    throw new Error(
      `${errorPrefix}Cannot use 'count distinct' aggregation with the special or numeric column '${column.column}'.`,
    );
  }
  if (
    (column.aggregation === "hll merge" ||
      column.aggregation === "kll merge") &&
    datatype !== "binary"
  ) {
    throw new Error(
      `${errorPrefix}Cannot use '${column.aggregation}' aggregation with the ${datatype || "unknown"} column '${column.column}'. The column must have a binary datatype (e.g. BigQuery BYTES).`,
    );
  }
  if (datatype === "string" && column.aggregation !== "count distinct") {
    throw new Error(
      `${errorPrefix}Must use 'count distinct' aggregation with string column '${column.column}'.`,
    );
  }
  if (
    datatype === "binary" &&
    column.aggregation !== "hll merge" &&
    column.aggregation !== "kll merge"
  ) {
    throw new Error(
      `${errorPrefix}Must use 'hll merge' or 'kll merge' aggregation with binary column '${column.column}'.`,
    );
  }
  // 'kll merge' is only meaningful in event-quantile metrics — the
  // back-end aggregation pipeline silently falls through to a SUM in
  // any other context (which would produce broken SQL on a binary
  // sketch column). Block it at the API boundary when we have enough
  // context to tell.
  if (
    column.aggregation === "kll merge" &&
    metricType !== undefined &&
    (metricType !== "quantile" || quantileType !== "event")
  ) {
    throw new Error(
      `${errorPrefix}'kll merge' aggregation is only valid for event-quantile metrics (metricType=quantile, quantileSettings.type=event).`,
    );
  }
  // `ignoreZeros` cannot be applied when re-aggregating pre-built KLL
  // sketches: the zero-filtering must happen in the upstream pipeline
  // that built the sketch (we can no longer see individual event
  // values). Reject explicit attempts to combine the two.
  if (column.aggregation === "kll merge" && quantileIgnoreZeros) {
    throw new Error(
      `${errorPrefix}'ignoreZeros' is not supported with 'kll merge' aggregation. Filter zero-valued events before building the KLL sketch in your source pipeline.`,
    );
  }
  // KLL sketches do not expose an internal "items inserted" count via any
  // current SQL engine. To recover per-user event counts (needed for the
  // cluster-aware variance estimator and the two-pass rank recovery in
  // kllRankApprox) we require the user to materialize a paired count column
  // of numeric datatype alongside the sketch column on the same fact table.
  // Default name: `<sketch>_n_events`. The metric author can override that
  // default via quantileSettings.quantileEventCountColumn — useful when their
  // upstream pipeline already emits a count under a different name.
  if (column.aggregation === "kll merge") {
    const expectedNEventsColumn =
      quantileEventCountColumn?.trim() || `${column.column}_n_events`;
    const overrideUsed =
      !!quantileEventCountColumn && quantileEventCountColumn.trim().length > 0;
    const pairedColumn = factTable.columns.find(
      (c) => c.column === expectedNEventsColumn && !c.deleted,
    );
    if (!pairedColumn) {
      throw new Error(
        overrideUsed
          ? `${errorPrefix}quantileSettings.quantileEventCountColumn references '${expectedNEventsColumn}', which does not exist on the fact table. Add it as a numeric column or remove the override.`
          : `${errorPrefix}'kll merge' on column '${column.column}' requires a paired event-count column named '${expectedNEventsColumn}' on the same fact table. Add it as a numeric column, or set quantileSettings.quantileEventCountColumn to point at an existing one.`,
      );
    }
    if (pairedColumn.datatype !== "number") {
      throw new Error(
        `${errorPrefix}Paired event-count column '${expectedNEventsColumn}' must have a numeric datatype (got '${pairedColumn.datatype || "unknown"}').`,
      );
    }
  } else if (
    quantileEventCountColumn !== undefined &&
    quantileEventCountColumn !== ""
  ) {
    // The override is only meaningful for 'kll merge'. Any other context (raw
    // event quantiles, unit quantiles, non-quantile metrics) computes
    // n_events from the row stream itself, so a custom source column has no
    // semantics. Reject explicit attempts to combine the two.
    throw new Error(
      `${errorPrefix}quantileSettings.quantileEventCountColumn is only valid when numerator.aggregation === 'kll merge'.`,
    );
  }
}

export async function getCreateMetricPropsFromBody(
  body: z.infer<typeof postFactMetricValidator.bodySchema>,
  organization: OrganizationInterface,
  getFactTable: (id: string) => Promise<FactTableInterface | null>,
): Promise<CreateFactMetricProps> {
  const { settings: scopedSettings } = getScopedSettings({
    organization,
  });

  const factTable = await getFactTable(body.numerator.factTableId);
  if (!factTable) {
    throw new Error("Could not find fact table");
  }

  const {
    quantileSettings,
    cappingSettings,
    windowSettings,
    regressionAdjustmentSettings,
    priorSettings,
    numerator,
    denominator,
    riskThresholdSuccess,
    riskThresholdDanger,
    minPercentChange,
    maxPercentChange,
    minSampleSize,
    targetMDE,
    ...otherFields
  } = body;

  const cleanedNumerator = FactMetricModel.migrateColumnRef({
    ...numerator,
    column:
      body.metricType === "proportion" || body.metricType === "retention"
        ? "$$distinctUsers"
        : body.numerator.column || "$$distinctUsers",
  });

  validateAggregationSpecification({
    errorPrefix: "Numerator misspecified. ",
    column: cleanedNumerator,
    factTable: factTable,
    metricType: body.metricType,
    quantileType: quantileSettings?.type,
    quantileIgnoreZeros: quantileSettings?.ignoreZeros,
    quantileEventCountColumn: quantileSettings?.quantileEventCountColumn,
  });

  const data: CreateFactMetricProps = {
    datasource: factTable.datasource,
    loseRisk:
      riskThresholdDanger ||
      scopedSettings.loseRisk.value ||
      DEFAULT_LOSE_RISK_THRESHOLD,
    winRisk:
      riskThresholdSuccess ||
      scopedSettings.winRisk.value ||
      DEFAULT_WIN_RISK_THRESHOLD,
    maxPercentChange:
      maxPercentChange ||
      scopedSettings.metricDefaults.value.maxPercentageChange ||
      0,
    minPercentChange:
      minPercentChange ||
      scopedSettings.metricDefaults.value.minPercentageChange ||
      0,
    targetMDE:
      targetMDE || scopedSettings.metricDefaults.value.targetMDE || 0.1,
    minSampleSize:
      minSampleSize ||
      scopedSettings.metricDefaults.value.minimumSampleSize ||
      150,
    description: "",
    owner: "",
    projects: [],
    tags: [],
    inverse: false,
    quantileSettings: quantileSettings ?? null,
    windowSettings: {
      type: DEFAULT_FACT_METRIC_WINDOW,
      delayValue:
        windowSettings?.delayValue ??
        windowSettings?.delayHours ??
        DEFAULT_METRIC_WINDOW_DELAY_HOURS,
      delayUnit: windowSettings?.delayUnit ?? "hours",
      windowValue: DEFAULT_METRIC_WINDOW_HOURS,
      windowUnit: "hours",
    },
    cappingSettings: {
      type: "",
      value: 0,
    },
    priorSettings: priorSettings ?? {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    regressionAdjustmentOverride: false,
    regressionAdjustmentDays:
      scopedSettings.regressionAdjustmentDays.value || 0,
    regressionAdjustmentEnabled: !!scopedSettings.regressionAdjustmentEnabled,
    numerator: cleanedNumerator,
    denominator: null,
    metricAutoSlices: [],
    ...otherFields,
  };

  if (denominator) {
    data.denominator = FactMetricModel.migrateColumnRef({
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    });
    const denominatorFactTable =
      denominator.factTableId === numerator.factTableId
        ? factTable
        : await getFactTable(denominator.factTableId);
    if (!denominatorFactTable) {
      throw new Error("Could not find denominator fact table");
    }
    validateAggregationSpecification({
      errorPrefix: "Denominator misspecified. ",
      column: data.denominator,
      factTable: denominatorFactTable,
      metricType: body.metricType,
      quantileType: quantileSettings?.type,
      quantileIgnoreZeros: quantileSettings?.ignoreZeros,
      // The override only applies to numerators (denominators don't support
      // 'kll merge'). Pass undefined so the validator never sees it here.
      quantileEventCountColumn: undefined,
    });
  }

  if (cappingSettings?.type && cappingSettings?.type !== "none") {
    data.cappingSettings.type = cappingSettings.type;
    data.cappingSettings.value = cappingSettings.value || 0;
    data.cappingSettings.ignoreZeros = cappingSettings.ignoreZeros || false;
  }

  if (windowSettings?.type && windowSettings?.type !== "none") {
    data.windowSettings.type = windowSettings.type;
    if (windowSettings.windowValue) {
      data.windowSettings.windowValue = windowSettings.windowValue;
    }
    if (windowSettings.windowUnit) {
      data.windowSettings.windowUnit = windowSettings.windowUnit;
    }
  }

  if (regressionAdjustmentSettings?.override) {
    data.regressionAdjustmentOverride = true;
    if (regressionAdjustmentSettings.enabled) {
      data.regressionAdjustmentEnabled = true;
    }
    if (regressionAdjustmentSettings.days) {
      data.regressionAdjustmentDays = regressionAdjustmentSettings.days;
    }
  }

  return data;
}

export const postFactMetric = createApiRequestHandler(postFactMetricValidator)(
  async (req) => {
    if (
      req.body.metricAutoSlices &&
      req.body.metricAutoSlices.length > 0 &&
      !req.context.hasPremiumFeature("metric-slices")
    ) {
      throw new Error("Metric slices require an enterprise license");
    }

    const lookupFactTable = async (id: string) => getFactTable(req.context, id);

    const data = await getCreateMetricPropsFromBody(
      req.body,
      req.organization,
      lookupFactTable,
    );
    const factMetric = await req.context.models.factMetrics.create(data);

    return {
      factMetric: await resolveOwnerEmail(
        req.context.models.factMetrics.toApiInterface(factMetric),
        req.context,
      ),
    };
  },
);
