import React, { ReactNode, useMemo } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
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
import { StatsEngine } from "shared/types/stats";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import MetricName from "@/components/Metrics/MetricName";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import TextField, { TextFieldProps } from "@/ui/TextField";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { getDefaultMetricOverridesFormValue } from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";
import styles from "./MetricsOverridesSelector.module.scss";

const defaultFieldMap = {
  goalMetrics: "goalMetrics",
  guardrailMetrics: "guardrailMetrics",
  secondaryMetrics: "secondaryMetrics",
  activationMetric: "activationMetric",
  metricOverrides: "metricOverrides",
};

export default function MetricsOverridesSelector({
  experiment,
  form,
  disabled,
  fieldMap = defaultFieldMap,
  datasource = experiment.datasource,
  statsEngine,
  highlightMetricId = null,
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
  /** The engine the experiment will be analysed with, as currently edited. */
  statsEngine: StatsEngine;
  /** A metric whose card is outlined for a moment as it opens. */
  highlightMetricId?: string | null;
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
            highlighted={
              !!highlightMetricId &&
              form.watch(`${fieldMap["metricOverrides"]}.${i}.id`) ===
                highlightMetricId
            }
            settings={settings}
            hasRegressionAdjustmentFeature={hasCommercialFeature(
              "regression-adjustment",
            )}
            bayesian={statsEngine === "bayesian"}
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
          placeholder="Override another metric..."
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

/**
 * One overridden metric. Each setting it overrides is a row, always open;
 * the rest wait behind a link apiece until they're overridden too.
 */
function OverrideCard({
  path,
  form,
  metricDefinition,
  allMetricDefinitions,
  highlighted,
  settings,
  hasRegressionAdjustmentFeature,
  bayesian,
  onRemove,
}: {
  path: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  metricDefinition: ExperimentMetricDefinition | null;
  allMetricDefinitions: ExperimentMetricDefinition[];
  highlighted: boolean;
  settings: OrganizationSettings;
  hasRegressionAdjustmentFeature: boolean;
  /** Priors only apply under the Bayesian engine. */
  bayesian: boolean;
  onRemove: () => void;
}) {
  const field = (name: string) => `${path}.${name}`;
  const set = (values: Record<string, unknown>) =>
    Object.entries(values).forEach(([name, value]) =>
      form.setValue(field(name), value),
    );
  const mo = form.watch(path);
  const retention = !!metricDefinition && isRetentionMetric(metricDefinition);
  const minWindow =
    metricDefinition && isFactMetric(metricDefinition) ? 0 : 0.125;

  // Window: the metric's own unless one is chosen here.
  const metricWindowType = metricDefinition?.windowSettings?.type || "none";
  const windowType: string | undefined = mo?.windowType;
  const windowOverridden = windowType !== undefined;
  const windowChoice = windowType || "none";
  const defaultDelay = metricDefinition?.windowSettings
    ? getDelayWindowHours(metricDefinition.windowSettings)
    : 0;
  const defaultWindow =
    metricWindowType === windowChoice && metricDefinition?.windowSettings
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
  const priorOverridden = !!mo?.properPriorOverride;

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
  const cupedDefault = !!(metricDefinition?.regressionAdjustmentOverride
    ? metricDefinition.regressionAdjustmentEnabled
    : settings.regressionAdjustmentEnabled);
  const cupedDefaultDays = metricDefinition?.regressionAdjustmentOverride
    ? metricDefinition.regressionAdjustmentDays
    : (settings.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS);
  const cupedOverridden = !!mo?.regressionAdjustmentOverride;
  const days: number | undefined = mo?.regressionAdjustmentDays;
  const daysWarning =
    !isUndefined(days) && days > 28
      ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
      : !isUndefined(days) && days < 7
        ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
        : null;

  const clearWindow = () =>
    set({
      windowType: undefined,
      windowHours: undefined,
      delayHours: undefined,
    });
  const clearPrior = () =>
    set({
      properPriorOverride: false,
      properPriorEnabled: false,
      properPriorMean: undefined,
      properPriorStdDev: undefined,
    });
  const clearCuped = () =>
    set({
      regressionAdjustmentOverride: false,
      regressionAdjustmentEnabled: false,
      regressionAdjustmentDays: undefined,
    });

  const numberField = (
    name: string,
    label: string,
    placeholder: string,
    {
      unit,
      rules = {},
      ...extra
    }: {
      unit?: string;
      rules?: Parameters<typeof form.register>[1];
    } & Partial<TextFieldProps> = {},
  ) => (
    <Box minWidth="0">
      <TextField
        type="number"
        step="any"
        label={label}
        placeholder={placeholder}
        append={unit ? <Text color="text-low">{unit}</Text> : undefined}
        {...extra}
        {...form.register(field(name), { valueAsNumber: true, ...rules })}
      />
    </Box>
  );

  const addable = [
    !windowOverridden && {
      label: "Metric window",
      add: () =>
        set({
          windowType: metricWindowType === "none" ? "" : metricWindowType,
        }),
    },
    !priorOverridden &&
      bayesian &&
      hasRegressionAdjustmentFeature && {
        label: "Prior",
        add: () =>
          set({
            properPriorOverride: true,
            properPriorEnabled: !!defaultPrior.proper,
          }),
      },
    !cupedOverridden &&
      !cupedUnavailable &&
      hasRegressionAdjustmentFeature && {
        label: "CUPED",
        add: () =>
          set({
            regressionAdjustmentOverride: true,
            regressionAdjustmentEnabled: cupedDefault,
          }),
      },
  ].filter((a): a is { label: string; add: () => void } => !!a);

  return (
    <Box
      data-override-metric={metricDefinition?.id}
      className={highlighted ? styles.highlight : undefined}
    >
      <Table variant="surface">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>
              <Flex justify="between" align="center" gap="3">
                <Text weight="semibold">
                  <MetricName id={metricDefinition?.id || ""} />
                </Text>
                <Link type="button" color="red" onClick={onRemove}>
                  Remove overrides
                </Link>
              </Flex>
            </TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {windowOverridden ? (
            <OverrideRow
              label="Metric window"
              onClear={clearWindow}
              choice={
                <Select
                  value={windowChoice}
                  setValue={(value) =>
                    set({ windowType: value === "none" ? "" : value })
                  }
                >
                  {[
                    ["none", "None"],
                    ["conversion", "Conversion"],
                    ...(retention ? [] : [["lookback", "Lookback"]]),
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {withDefault(label, value === metricWindowType)}
                    </SelectItem>
                  ))}
                </Select>
              }
            >
              {windowChoice !== "none" || retention ? (
                <>
                  {numberField(
                    "delayHours",
                    retention
                      ? windowChoice === "lookback"
                        ? "Retention window"
                        : "Retention starts after"
                      : "Delay",
                    `Default ${defaultDelay}`,
                    { unit: "hours" },
                  )}
                  {windowChoice !== "none"
                    ? numberField(
                        "windowHours",
                        windowChoice === "lookback"
                          ? "Lookback window"
                          : "Conversion window",
                        defaultWindow,
                        {
                          unit: "hours",
                          min: minWindow,
                          rules: {
                            required: metricWindowType !== windowChoice,
                          },
                        },
                      )
                    : null}
                </>
              ) : null}
            </OverrideRow>
          ) : null}

          {priorOverridden ? (
            <OverrideRow
              label="Prior"
              tooltip="Only used by the Bayesian stats engine."
              onClear={clearPrior}
              help={
                bayesian
                  ? null
                  : "Not applied: this experiment uses the frequentist stats engine."
              }
              choice={
                <Select
                  disabled={!bayesian || !hasRegressionAdjustmentFeature}
                  value={mo?.properPriorEnabled ? "proper" : "improper"}
                  setValue={(value) =>
                    set({ properPriorEnabled: value === "proper" })
                  }
                >
                  <SelectItem value="proper">
                    {withDefault("Proper", !!defaultPrior.proper)}
                  </SelectItem>
                  <SelectItem value="improper">
                    {withDefault("Improper", !defaultPrior.proper)}
                  </SelectItem>
                </Select>
              }
            >
              {mo?.properPriorEnabled ? (
                <>
                  {numberField(
                    "properPriorMean",
                    "Mean",
                    `Default ${defaultPrior.mean}`,
                    { disabled: !bayesian },
                  )}
                  {numberField(
                    "properPriorStdDev",
                    "Standard deviation",
                    `Default ${defaultPrior.stddev}`,
                    {
                      disabled: !bayesian,
                      rules: { validate: (v) => !((v ?? 0) <= 0) },
                    },
                  )}
                </>
              ) : null}
            </OverrideRow>
          ) : null}

          {cupedOverridden ? (
            <OverrideRow
              label="CUPED"
              onClear={clearCuped}
              help={
                !cupedUnavailable && mo?.regressionAdjustmentEnabled
                  ? daysWarning
                  : null
              }
              choice={
                cupedUnavailable ? null : (
                  <Select
                    disabled={!hasRegressionAdjustmentFeature}
                    value={mo?.regressionAdjustmentEnabled ? "on" : "off"}
                    setValue={(value) =>
                      set({ regressionAdjustmentEnabled: value === "on" })
                    }
                  >
                    <SelectItem value="on">
                      {withDefault("On", cupedDefault)}
                    </SelectItem>
                    <SelectItem value="off">
                      {withDefault("Off", !cupedDefault)}
                    </SelectItem>
                  </Select>
                )
              }
            >
              {cupedUnavailable ? (
                <Text size="sm" color="text-low">
                  {cupedUnavailable}
                </Text>
              ) : mo?.regressionAdjustmentEnabled ? (
                numberField(
                  "regressionAdjustmentDays",
                  "Pre-exposure lookback",
                  `Default ${cupedDefaultDays}`,
                  {
                    unit: "days",
                    min: 0,
                    step: undefined,
                    disabled: !hasRegressionAdjustmentFeature,
                    rules: { validate: (v) => v === undefined || v > 0 },
                  },
                )
              ) : null}
            </OverrideRow>
          ) : null}

          {addable.length > 0 ? (
            <TableRow>
              <TableCell>
                <Box width={`${SELECT_WIDTH}px`}>
                  <Select
                    value=""
                    placeholder="Override a setting..."
                    setValue={(value) =>
                      addable.find(({ label }) => label === value)?.add()
                    }
                  >
                    {addable.map(({ label }) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </Select>
                </Box>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Box>
  );
}

const SELECT_WIDTH = 190;

const withDefault = (label: string, isDefault: boolean) =>
  isDefault ? `${label} (default)` : label;

/**
 * A row for a setting a metric overrides: its choice, labelled with the
 * setting, then its details and a reset. Details share two even slots, so they
 * line up from one row to the next.
 */
function OverrideRow({
  label,
  tooltip,
  choice,
  onClear,
  help,
  children,
}: {
  label: string;
  tooltip?: string;
  /** Left out where the setting can't be chosen; its details take its place. */
  choice: ReactNode;
  onClear: () => void;
  /** A warning about the setting, under the row. */
  help?: string | null;
  children?: ReactNode;
}) {
  const heading = (
    <Flex align="center" gap="1" mb="2">
      <Text as="label" weight="semibold" mb="0">
        {label}
      </Text>
      {tooltip ? (
        <Tooltip content={tooltip}>
          <Flex style={{ color: "var(--gray-10)" }}>
            <PiInfo size={14} />
          </Flex>
        </Tooltip>
      ) : null}
    </Flex>
  );
  return (
    <TableRow>
      <TableCell>
        <Flex align="end" gap="3">
          <Flex
            direction="column"
            flexShrink="0"
            width={choice ? `${SELECT_WIDTH}px` : undefined}
            flexGrow={choice ? undefined : "1"}
          >
            {heading}
            {choice ?? children}
          </Flex>
          {choice ? (
            <Grid columns="2" gap="3" align="end" flexGrow="1" minWidth="0">
              {children}
            </Grid>
          ) : null}
          <Box pb="6px">
            <RemoveButton
              label={`Stop overriding ${label}`}
              onClick={onClear}
            />
          </Box>
        </Flex>
        {help ? (
          <HelperText status="warning" size="sm" mt="2">
            {help}
          </HelperText>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        type="button"
        color="gray"
        variant="ghost"
        radius="full"
        size="1"
        aria-label={label}
        onClick={onClick}
      >
        <PiXBold size={16} />
      </IconButton>
    </Tooltip>
  );
}
