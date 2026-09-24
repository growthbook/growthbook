import React, { useMemo } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiTrash } from "react-icons/pi";
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
import { capitalizeFirstLetter } from "@/services/utils";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";
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

const onOff = (on: boolean | undefined) => (on ? "On" : "Off");

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
  const metricWindowType = metricDefinition?.windowSettings?.type;
  const windowType: string | undefined = mo?.windowType;
  const effectiveWindowType = windowType ?? metricWindowType ?? "";
  const windowLabel = (type: string) =>
    type === "conversion"
      ? "Conversion"
      : type === "lookback"
        ? "Lookback"
        : "None";

  // Prior: from the metric where it sets one, the org otherwise.
  const defaultPriorSource = metricDefinition?.priorSettings.override
    ? "metric"
    : "organization";
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
        : null;

  const hoursField = (
    name: "delayHours" | "windowHours",
    label: string,
    placeholder: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Box flexGrow="1">
      <Field
        size="md"
        label={label}
        type="number"
        step="any"
        placeholder={placeholder}
        containerClassName="mb-0"
        {...extra}
        {...form.register(field(name), { valueAsNumber: true })}
      />
    </Box>
  );

  return (
    <Frame mb="0" p="4">
      <Flex justify="between" align="start" gap="3">
        <Box>
          <Text weight="semibold" as="div">
            <MetricName id={metricDefinition?.id || ""} />
          </Text>
          {metricDefinition ? (
            <Text size="sm" color="text-low" as="div">
              {metricTypeLabel(metricDefinition)}
            </Text>
          ) : null}
        </Box>
        <Tooltip content="Remove override">
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            aria-label="Remove override"
            onClick={(e) => {
              e.preventDefault();
              onRemove();
            }}
          >
            <PiTrash size={14} />
          </IconButton>
        </Tooltip>
      </Flex>
      <Separator size="4" my="3" />

      <SetupFieldRow
        label="Metric window"
        labelAlign="center"
        fieldMaxWidth="320px"
      >
        <SelectField
          size="md"
          sort={false}
          value={windowType === undefined ? METRIC_DEFAULT : windowType}
          onChange={(value) => {
            if (value === METRIC_DEFAULT) {
              form.setValue(field("windowType"), undefined);
              form.setValue(field("windowHours"), undefined);
              form.setValue(field("delayHours"), undefined);
            } else {
              form.setValue(field("windowType"), value);
            }
          }}
          options={[
            {
              label: `Metric default (${windowLabel(metricWindowType ?? "")})`,
              value: METRIC_DEFAULT,
            },
            { label: "None", value: "" },
            { label: "Conversion", value: "conversion" },
            ...(retention ? [] : [{ label: "Lookback", value: "lookback" }]),
          ]}
        />
      </SetupFieldRow>
      {effectiveWindowType === "conversion" || retention ? (
        <Flex gap="3" mt="1" mb="2" pl="0">
          {hoursField(
            "delayHours",
            retention
              ? "Retention starts after (hours)"
              : "Metric delay (hours)",
            `default ${metricDefinition?.windowSettings ? getDelayWindowHours(metricDefinition.windowSettings) : 0}`,
          )}
          {hoursField(
            "windowHours",
            "Conversion window (hours)",
            metricWindowType === "conversion" &&
              metricDefinition?.windowSettings
              ? `default ${getMetricWindowHours(metricDefinition.windowSettings)}`
              : "required",
            {
              min: minWindow,
              disabled: effectiveWindowType !== "conversion",
              required: metricWindowType !== "conversion",
            },
          )}
        </Flex>
      ) : effectiveWindowType === "lookback" ? (
        <Flex gap="3" mt="1" mb="2">
          {hoursField(
            "delayHours",
            retention ? "Retention window (hours)" : "Metric delay (hours)",
            `default ${metricDefinition?.windowSettings ? getDelayWindowHours(metricDefinition.windowSettings) : 0}`,
          )}
          {hoursField(
            "windowHours",
            "Lookback window (hours)",
            metricWindowType === "lookback" && metricDefinition?.windowSettings
              ? `default ${getMetricWindowHours(metricDefinition.windowSettings)}`
              : "required",
            { min: minWindow, required: metricWindowType !== "lookback" },
          )}
        </Flex>
      ) : null}

      <SetupFieldRow
        label="Prior"
        labelAlign="center"
        tooltip="Only used by the Bayesian stats engine."
        fieldMaxWidth="320px"
      >
        <SelectField
          size="md"
          sort={false}
          disabled={!hasRegressionAdjustmentFeature}
          value={priorChoice}
          onChange={(value) => {
            form.setValue(
              field("properPriorOverride"),
              value !== METRIC_DEFAULT,
            );
            form.setValue(field("properPriorEnabled"), value === "proper");
          }}
          options={[
            {
              label: `${capitalizeFirstLetter(defaultPriorSource)} default (${defaultPrior.proper ? "proper" : "improper"})`,
              value: METRIC_DEFAULT,
            },
            { label: "Proper prior", value: "proper" },
            { label: "Improper prior", value: "improper" },
          ]}
        />
      </SetupFieldRow>
      {priorChoice === "proper" ? (
        <Flex gap="3" mt="1" mb="2">
          <Box flexGrow="1">
            <Field
              size="md"
              label="Prior mean"
              type="number"
              step="any"
              placeholder={`default ${defaultPrior.mean}`}
              containerClassName="mb-0"
              {...form.register(field("properPriorMean"), {
                valueAsNumber: true,
              })}
            />
          </Box>
          <Box flexGrow="1">
            <Field
              size="md"
              label="Prior standard deviation"
              type="number"
              step="any"
              placeholder={`default ${defaultPrior.stddev}`}
              containerClassName="mb-0"
              {...form.register(field("properPriorStdDev"), {
                valueAsNumber: true,
                validate: (v) => !((v ?? 0) <= 0),
              })}
            />
          </Box>
        </Flex>
      ) : null}

      <SetupFieldRow label="CUPED" labelAlign="center" fieldMaxWidth="320px">
        {cupedUnavailable ? (
          <Text size="sm" color="text-low">
            {cupedUnavailable}
          </Text>
        ) : (
          <SelectField
            size="md"
            sort={false}
            disabled={!hasRegressionAdjustmentFeature}
            value={cupedChoice}
            onChange={(value) => {
              form.setValue(
                field("regressionAdjustmentOverride"),
                value !== METRIC_DEFAULT,
              );
              form.setValue(
                field("regressionAdjustmentEnabled"),
                value === "on",
              );
            }}
            options={[
              {
                label: `${metricDefinition?.regressionAdjustmentOverride ? "Metric" : "Organization"} default (${onOff(cupedDefault)})`,
                value: METRIC_DEFAULT,
              },
              { label: "On", value: "on" },
              { label: "Off", value: "off" },
            ]}
          />
        )}
      </SetupFieldRow>
      {!cupedUnavailable && cupedChoice === "on" ? (
        <Box mt="1" style={{ maxWidth: 240 }}>
          <Field
            size="md"
            label="Pre-exposure lookback (days)"
            type="number"
            min="0"
            placeholder={`default ${cupedDefaultDays}`}
            disabled={!hasRegressionAdjustmentFeature}
            containerClassName="mb-0"
            {...form.register(field("regressionAdjustmentDays"), {
              valueAsNumber: true,
              validate: (v) => v === undefined || v > 0,
            })}
          />
          {daysWarning ? (
            <HelperText status="warning" size="sm" mt="1">
              {daysWarning}
            </HelperText>
          ) : null}
        </Box>
      ) : null}
    </Frame>
  );
}
