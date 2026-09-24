import React, { useMemo } from "react";
import { Card, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiInfo, PiXBold } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useFieldArray, UseFormReturn } from "react-hook-form";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { isUndefined } from "lodash";
import {
  ExperimentMetricDefinition,
  expandMetricGroups,
  getMetricWindowHours,
  getDelayWindowHours,
  isBinomialMetric,
  isFactMetric,
  isRetentionMetric,
} from "shared/experiments";
import { OrganizationSettings } from "shared/types/organization";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { metricTypeLabel } from "@/services/metrics";
import MetricName from "@/components/Metrics/MetricName";
import { Select, SelectItem } from "@/ui/Select";
import TextField, { TextFieldProps } from "@/ui/TextField";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { getDefaultMetricOverridesFormValue } from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";

const defaultFieldMap = {
  goalMetrics: "goalMetrics",
  guardrailMetrics: "guardrailMetrics",
  secondaryMetrics: "secondaryMetrics",
  activationMetric: "activationMetric",
  metricOverrides: "metricOverrides",
};

/** A select's own stand-in for "leave this to the metric". */
const METRIC_DEFAULT = "__metric-default";

export default function MetricsOverridesSelector({
  experiment,
  form,
  disabled,
  fieldMap = defaultFieldMap,
  datasource = experiment.datasource,
}: {
  experiment: ExperimentInterfaceStringDates;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  disabled: boolean;
  fieldMap?: typeof defaultFieldMap;
  /**
   * The data source the metrics are picked from. Defaults to the stored one;
   * pass the unsaved one when it may have changed, or its metrics can't be
   * picked.
   */
  datasource?: string;
}) {
  const {
    metrics: metricDefinitions,
    factMetrics: factMetricDefinitions,
    metricGroups,
    getExperimentMetricById,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();

  const allMetricDefinitions = useMemo(
    () => [...metricDefinitions, ...factMetricDefinitions],
    [metricDefinitions, factMetricDefinitions],
  );

  const unexpandedMetrics = new Set<string>(
    form
      .watch(fieldMap["goalMetrics"])
      .concat(form.watch(fieldMap["guardrailMetrics"]))
      .concat(form.watch(fieldMap["secondaryMetrics"])),
  );
  const activationMetric = form.watch(fieldMap["activationMetric"]);
  if (activationMetric) {
    unexpandedMetrics.add(activationMetric);
  }
  const expandedMetrics = expandMetricGroups(
    Array.from(unexpandedMetrics),
    metricGroups,
  );

  const metricOverrides = useFieldArray({
    control: form.control,
    name: fieldMap["metricOverrides"],
  });

  const usedMetrics: Set<string> = new Set(
    form.watch(fieldMap["metricOverrides"]).map((m) => m.id),
  );
  const unusedMetrics: string[] = [...expandedMetrics].filter(
    (m) => !usedMetrics.has(m),
  );

  const addOverride = (id: string) => {
    const metricOverride = getDefaultMetricOverridesFormValue(
      [{ id }],
      getExperimentMetricById,
      settings,
    )?.[0];
    if (metricOverride) metricOverrides.append(metricOverride);
  };

  return (
    <Flex direction="column" gap="3">
      {!disabled &&
        metricOverrides.fields.map((_, i) => (
          <OverrideCard
            key={i}
            path={`${fieldMap["metricOverrides"]}.${i}`}
            form={form}
            metricDefinition={
              allMetricDefinitions.find(
                (md) =>
                  md.id ===
                  form.watch(`${fieldMap["metricOverrides"]}.${i}.id`),
              ) ?? null
            }
            allMetricDefinitions={allMetricDefinitions}
            settings={settings}
            hasRegressionAdjustmentFeature={hasCommercialFeature(
              "regression-adjustment",
            )}
            onRemove={() => metricOverrides.remove(i)}
          />
        ))}
      {unusedMetrics.length > 0 ? (
        <MetricSelector
          size="md"
          datasource={datasource}
          availableIds={unusedMetrics}
          project={experiment.project}
          includeFacts={true}
          value=""
          // Picking a metric is the whole gesture: it lands as a new card.
          onChange={(m) => m && addOverride(m)}
          initialOption="Override another metric..."
          disabled={disabled}
          onPaste={(e) => {
            try {
              const clipboard = e.clipboardData;
              const data = JSON.parse(clipboard.getData("Text"));
              if (data.every((d) => d.startsWith("met_"))) {
                e.preventDefault();
                e.stopPropagation();
                data.forEach((d) => {
                  metricOverrides.append({
                    id: d,
                  });
                });
              }
            } catch (e) {
              // fail silently
            }
          }}
        />
      ) : null}
    </Flex>
  );
}

/** One overridden metric: its window, prior and CUPED, each defaulting to it. */
function OverrideCard({
  path,
  form,
  metricDefinition,
  allMetricDefinitions,
  settings,
  hasRegressionAdjustmentFeature,
  onRemove,
}: {
  path: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  metricDefinition: ExperimentMetricDefinition | null;
  allMetricDefinitions: ExperimentMetricDefinition[];
  settings: OrganizationSettings;
  hasRegressionAdjustmentFeature: boolean;
  onRemove: () => void;
}) {
  const field = (name: string) => `${path}.${name}`;
  const mo = form.watch(path);
  const retention = !!metricDefinition && isRetentionMetric(metricDefinition);
  const minWindow =
    metricDefinition && isFactMetric(metricDefinition) ? 0 : 0.125;

  // Window: the metric's own unless one is chosen here.
  const metricWindowType = metricDefinition?.windowSettings?.type || "none";
  const windowType: string | undefined = mo?.windowType;
  const windowChoice =
    windowType === undefined ? METRIC_DEFAULT : windowType || "none";
  const effectiveWindowType =
    windowChoice === METRIC_DEFAULT ? metricWindowType : windowChoice;
  const defaultDelay = metricDefinition?.windowSettings
    ? getDelayWindowHours(metricDefinition.windowSettings)
    : 0;
  const defaultWindow = (type: string) =>
    metricWindowType === type && metricDefinition?.windowSettings
      ? `Default ${getMetricWindowHours(metricDefinition.windowSettings)}`
      : "Required";

  // Prior: from the metric where it sets one, the org otherwise.
  const defaultPrior = metricDefinition?.priorSettings.override
    ? metricDefinition.priorSettings
    : (settings.metricDefaults?.priorSettings ?? {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
      });
  const priorChoice = !mo?.properPriorOverride
    ? METRIC_DEFAULT
    : mo?.properPriorEnabled
      ? "proper"
      : "improper";

  // CUPED: some metrics can't take it at all.
  let cupedUnavailable: string | null = null;
  if (metricDefinition?.denominator) {
    const denominator = allMetricDefinitions.find(
      (m) => m.id === metricDefinition.denominator,
    );
    if (
      denominator &&
      !isFactMetric(denominator) &&
      !isBinomialMetric(denominator)
    ) {
      cupedUnavailable = `Not available for metrics where the denominator is a ${denominator.type} type.`;
    }
  }
  if (
    metricDefinition &&
    !isFactMetric(metricDefinition) &&
    metricDefinition.aggregation
  ) {
    cupedUnavailable = "Not available for metrics with custom aggregations.";
  }
  const cupedDefault = metricDefinition?.regressionAdjustmentOverride
    ? metricDefinition.regressionAdjustmentEnabled
    : settings.regressionAdjustmentEnabled;
  const cupedDefaultDays = metricDefinition?.regressionAdjustmentOverride
    ? metricDefinition.regressionAdjustmentDays
    : (settings.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS);
  const cupedChoice = !mo?.regressionAdjustmentOverride
    ? METRIC_DEFAULT
    : mo?.regressionAdjustmentEnabled
      ? "on"
      : "off";
  const days: number | undefined = mo?.regressionAdjustmentDays;
  const daysWarning =
    !isUndefined(days) && days > 28
      ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
      : !isUndefined(days) && days < 7
        ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
        : undefined;

  const numberField = (
    name: string,
    label: string,
    unit: string,
    placeholder: string,
    options: Parameters<typeof form.register>[1] = {},
    extra: Partial<TextFieldProps> = {},
  ) => (
    <TextField
      label={label}
      type="number"
      step="any"
      placeholder={placeholder}
      append={
        <Text size="sm" color="text-low">
          {unit}
        </Text>
      }
      {...extra}
      {...form.register(field(name), { valueAsNumber: true, ...options })}
    />
  );

  return (
    <Card>
      <Flex justify="between" align="center" gap="3" mb="3">
        <Flex align="baseline" gap="2" minWidth="0">
          <Text weight="semibold">
            <MetricName id={metricDefinition?.id || ""} />
          </Text>
          {metricDefinition ? (
            <Text size="sm" color="text-low">
              {metricTypeLabel(metricDefinition)}
            </Text>
          ) : null}
        </Flex>
        <Tooltip content="Remove override">
          <IconButton
            type="button"
            color="gray"
            variant="ghost"
            radius="full"
            size="1"
            onClick={onRemove}
          >
            <PiXBold size={16} />
          </IconButton>
        </Tooltip>
      </Flex>

      <Grid columns={{ initial: "1", sm: "3" }} gap="4">
        <Flex direction="column" gap="3">
          <Select
            label="Metric window"
            value={windowChoice}
            setValue={(value) => {
              if (value === METRIC_DEFAULT) {
                form.setValue(field("windowType"), undefined);
                form.setValue(field("windowHours"), undefined);
                form.setValue(field("delayHours"), undefined);
              } else {
                form.setValue(
                  field("windowType"),
                  value === "none" ? "" : value,
                );
              }
            }}
          >
            <SelectItem value={METRIC_DEFAULT}>
              Default ({metricWindowType})
            </SelectItem>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="conversion">Conversion</SelectItem>
            {retention ? null : (
              <SelectItem value="lookback">Lookback</SelectItem>
            )}
          </Select>
          {effectiveWindowType === "conversion" ||
          effectiveWindowType === "lookback" ||
          retention ? (
            <>
              {numberField(
                "delayHours",
                retention ? "Retention starts after" : "Metric delay",
                "hours",
                `Default ${defaultDelay}`,
              )}
              {effectiveWindowType === "lookback"
                ? numberField(
                    "windowHours",
                    "Lookback window",
                    "hours",
                    defaultWindow("lookback"),
                    { required: metricWindowType !== "lookback" },
                    { min: minWindow },
                  )
                : numberField(
                    "windowHours",
                    "Conversion window",
                    "hours",
                    defaultWindow("conversion"),
                    { required: metricWindowType !== "conversion" },
                    {
                      min: minWindow,
                      disabled: effectiveWindowType !== "conversion",
                    },
                  )}
            </>
          ) : null}
        </Flex>

        <Flex direction="column" gap="3">
          <Select
            label={
              <Flex align="center" gap="1">
                <Text as="label" weight="semibold">
                  Prior
                </Text>
                <Tooltip content="Only used by the Bayesian stats engine.">
                  <Flex style={{ color: "var(--gray-10)" }}>
                    <PiInfo size={14} />
                  </Flex>
                </Tooltip>
              </Flex>
            }
            disabled={!hasRegressionAdjustmentFeature}
            value={priorChoice}
            setValue={(value) => {
              form.setValue(
                field("properPriorOverride"),
                value !== METRIC_DEFAULT,
              );
              form.setValue(field("properPriorEnabled"), value === "proper");
            }}
          >
            <SelectItem value={METRIC_DEFAULT}>
              Default ({defaultPrior.proper ? "proper" : "improper"})
            </SelectItem>
            <SelectItem value="proper">Proper</SelectItem>
            <SelectItem value="improper">Improper</SelectItem>
          </Select>
          {priorChoice === "proper" ? (
            <>
              <TextField
                label="Mean"
                type="number"
                step="any"
                placeholder={`Default ${defaultPrior.mean}`}
                {...form.register(field("properPriorMean"), {
                  valueAsNumber: true,
                })}
              />
              <TextField
                label="Standard deviation"
                type="number"
                step="any"
                placeholder={`Default ${defaultPrior.stddev}`}
                {...form.register(field("properPriorStdDev"), {
                  valueAsNumber: true,
                  validate: (v) => !((v ?? 0) <= 0),
                })}
              />
            </>
          ) : null}
        </Flex>

        <Flex direction="column" gap="3">
          {cupedUnavailable ? (
            <Flex direction="column" gap="1">
              <Text as="label" weight="semibold">
                CUPED
              </Text>
              <Text size="sm" color="text-low">
                {cupedUnavailable}
              </Text>
            </Flex>
          ) : (
            <>
              <Select
                label="CUPED"
                disabled={!hasRegressionAdjustmentFeature}
                value={cupedChoice}
                setValue={(value) => {
                  form.setValue(
                    field("regressionAdjustmentOverride"),
                    value !== METRIC_DEFAULT,
                  );
                  form.setValue(
                    field("regressionAdjustmentEnabled"),
                    value === "on",
                  );
                }}
              >
                <SelectItem value={METRIC_DEFAULT}>
                  Default ({cupedDefault ? "on" : "off"})
                </SelectItem>
                <SelectItem value="on">On</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </Select>
              {cupedChoice === "on"
                ? numberField(
                    "regressionAdjustmentDays",
                    "Pre-exposure lookback",
                    "days",
                    `Default ${cupedDefaultDays}`,
                    { validate: (v) => v === undefined || v > 0 },
                    {
                      min: 0,
                      step: undefined,
                      disabled: !hasRegressionAdjustmentFeature,
                      error: daysWarning,
                      errorLevel: "warning",
                    },
                  )
                : null}
            </>
          )}
        </Flex>
      </Grid>
    </Card>
  );
}
