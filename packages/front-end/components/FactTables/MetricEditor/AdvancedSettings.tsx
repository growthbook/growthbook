import { UseFormReturn } from "react-hook-form";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "shared/constants";
import { Flex, Grid } from "@radix-ui/themes";
import {
  FactTableDefinition,
  MetricCappingSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import { capitalizeFirstLetter } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { Select, SelectItem } from "@/ui/Select";
import MultiSelectField from "@/ui/MultiSelectField";
import { DataListItem } from "@/ui/DataList";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "@/components/Metrics/MetricForm/MetricCappingSettingsForm";
import { MetricDelaySettings } from "@/components/Metrics/MetricForm/MetricDelaySettings";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";
import {
  cappingOk,
  FormMetricType,
  windowOk,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

function windowProse(windowSettings: MetricWindowSettings): string {
  const afterExposure = windowSettings.delayValue
    ? " plus the metric delay"
    : "";
  if (windowSettings.type === "conversion") {
    return `Conversion — within ${windowSettings.windowValue} ${windowSettings.windowUnit} of first exposure${afterExposure}.`;
  }
  if (windowSettings.type === "lookback") {
    return `Lookback — latest ${windowSettings.windowValue} ${windowSettings.windowUnit} of the experiment.`;
  }
  return `Disabled — includes all data after first exposure${afterExposure}.`;
}

function cappingSummary(
  cappingSettings: MetricCappingSettings,
): DataListItem | null {
  if (!cappingSettings.type || !cappingSettings.value) return null;
  const extra =
    cappingSettings.type === "percentile"
      ? ` (${100 * cappingSettings.value} pctile${
          cappingSettings.ignoreZeros ? ", ignoring zeros" : ""
        })`
      : "";
  return {
    label: `${capitalizeFirstLetter(cappingSettings.type)} capping`,
    value: `${cappingSettings.value}${extra}`,
  };
}

export default function AdvancedSettings({
  form,
  formType,
  factTable,
  canEdit,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  formType: FormMetricType;
  factTable: FactTableDefinition | null;
  canEdit: boolean;
}) {
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const orgSettings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const metricType = form.watch("metricType");
  const datasource = getDatasourceById(form.watch("datasource"));
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const showsGoalAndSlices = formType !== "funnel";
  const showsAutoSlices =
    showsGoalAndSlices && hasCommercialFeature("metric-slices") && !!factTable;
  const priorSettings = form.watch("priorSettings");
  const cappingItem = cappingSummary(form.watch("cappingSettings"));
  const windowSettings = form.watch("windowSettings");
  const minSampleSizeLabel =
    formType === "ratio" ? "Minimum numerator total" : "Minimum metric total";
  // A write gate around an edit control, not around the fact itself - the
  // fact itself is now an OfficialBadge next to the Name field in
  // MetricEditor's Basics card, matching how the rest of the app (FactMetricModal,
  // [fmid].tsx, fact table pages) always shows official status, not just when
  // Advanced Settings happens to be open.
  const canEditOfficial =
    canEdit &&
    permissionsUtil.canUpdateOfficialResources(
      { projects: form.watch("projects") },
      {},
    ) &&
    hasCommercialFeature("manage-official-resources");

  if (!canEdit) {
    const effectivePrior = priorSettings.override
      ? priorSettings
      : metricDefaults.priorSettings;
    const cupedOverride = form.watch("regressionAdjustmentOverride");
    const cupedEnabled = cupedOverride
      ? form.watch("regressionAdjustmentEnabled")
      : orgSettings.regressionAdjustmentEnabled;
    const cupedDays = cupedOverride
      ? form.watch("regressionAdjustmentDays")
      : orgSettings.regressionAdjustmentDays;
    const items: DataListItem[] = [
      ...(windowOk(formType)
        ? [{ label: "Metric window", value: windowProse(windowSettings) }]
        : []),
      ...(showsAutoSlices && factTable
        ? [
            {
              label: "Auto Slices",
              value:
                (form.watch("metricAutoSlices") || [])
                  .map(
                    (col) =>
                      factTable.columns.find((c) => c.column === col)?.name ||
                      col,
                  )
                  .join(", ") || "None",
            },
          ]
        : []),
      {
        label: "Target MDE",
        value: `${form.watch("targetMDE") ?? metricDefaults.targetMDE * 100}%`,
      },
      ...(formType !== "quantile"
        ? [
            {
              label: "Regression adjustment (CUPED)",
              value: cupedEnabled
                ? `On · ${cupedDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS} days lookback${cupedOverride ? "" : " · Organization defaults"}`
                : `Disabled${cupedOverride ? "" : " · Organization defaults"}`,
            },
          ]
        : []),
      {
        label: minSampleSizeLabel,
        value: form.watch("minSampleSize") ?? metricDefaults.minimumSampleSize,
      },
      {
        label: "Use proper prior",
        value: `${effectivePrior.proper ? "On" : "Off"}${priorSettings.override ? "" : " · Organization defaults"}`,
      },
      {
        label: "Max percent change",
        value: `${form.watch("maxPercentChange") ?? metricDefaults.maxPercentageChange * 100}%`,
      },
      {
        label: "Min percent change",
        value: `${form.watch("minPercentChange") ?? metricDefaults.minPercentageChange * 100}%`,
      },
      ...(effectivePrior.proper
        ? [
            { label: "Prior mean", value: effectivePrior.mean },
            { label: "Prior standard deviation", value: effectivePrior.stddev },
          ]
        : []),
      ...(windowOk(formType) && windowSettings.delayValue
        ? [
            {
              label: "Metric delay",
              value: `${windowSettings.delayValue} ${windowSettings.delayUnit} after experiment exposure`,
            },
          ]
        : []),
      ...(cappingOk(formType) && cappingItem ? [cappingItem] : []),
      ...(showsGoalAndSlices
        ? [
            {
              label: "Metric goal",
              value: form.watch("inverse")
                ? "Decrease the metric value"
                : "Increase the metric value",
            },
          ]
        : []),
      ...(formType === "ratio" || formType === "dailyParticipation"
        ? [
            {
              label: "Format variation value as a percentage",
              value: form.watch("displayAsPercentage") ? "Yes" : "No",
            },
          ]
        : []),
    ];

    return (
      <Frame px="4" py="3">
        <details open>
          <summary style={{ cursor: "pointer" }}>
            <Text weight="semibold">Advanced settings</Text>
          </summary>
          <Text as="div" size="sm" color="text-mid" mt="1">
            Metric window, decision framework, thresholds, priors, CUPED
          </Text>
          <Grid
            asChild
            columns={{ initial: "1", sm: "2" }}
            gapX="5"
            gapY="3"
            mt="3"
          >
            <dl style={{ marginBottom: 0 }}>
              {items.map(({ label, value }) => (
                <div key={label}>
                  <dt style={{ marginBottom: 4 }}>
                    <Text
                      size="sm"
                      weight="semibold"
                      color="text-mid"
                      textTransform="uppercase"
                    >
                      {label}
                    </Text>
                  </dt>
                  <dd style={{ margin: 0 }}>
                    <Text size="sm">{value}</Text>
                  </dd>
                </div>
              ))}
            </dl>
          </Grid>
        </details>
      </Frame>
    );
  }

  return (
    <Frame>
      <details>
        <summary style={{ cursor: "pointer" }}>
          <Text weight="semibold">Advanced settings</Text>
        </summary>
        <Flex direction="column" gap="3" mt="3">
          <Tabs defaultValue="analysis">
            <TabsList mb="4" aria-label="Advanced settings">
              <TabsTrigger value="analysis">Analysis settings</TabsTrigger>
              <TabsTrigger value="display">Display settings</TabsTrigger>
            </TabsList>
            <TabsContent value="analysis" forceMount>
              <Flex direction="column" gap="4">
                {
                  <>
                    {windowOk(formType) && (
                      <Frame mb="0">
                        <MetricDelaySettings form={form} />
                      </Frame>
                    )}
                    {cappingOk(formType) && (
                      <Frame mb="0">
                        <MetricCappingSettingsForm
                          form={form}
                          datasourceType={datasource?.type}
                          metricType={metricType}
                        />
                      </Frame>
                    )}
                    <Frame mb="0">
                      <Field
                        label={
                          <>
                            {" "}
                            <Text as="div" weight="semibold" mb="2">
                              Target MDE
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`The percentage change that you want to reliably detect before ending your experiment. This is used to estimate the "Days Left" for running experiments. (default ${
                              metricDefaults.targetMDE * 100
                            }%)`}</Text>
                          </>
                        }
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("targetMDE", { valueAsNumber: true })}
                      />
                    </Frame>
                    <Frame mb="0">
                      <MetricPriorSettingsForm
                        priorSettings={priorSettings}
                        setPriorSettings={(v) =>
                          form.setValue("priorSettings", v)
                        }
                        metricDefaults={metricDefaults}
                      />
                    </Frame>
                    {formType !== "quantile" && (
                      <Frame mb="0">
                        <PremiumTooltip commercialFeature="regression-adjustment">
                          <Text weight="semibold" as="div" mb="1">
                            Regression adjustment (CUPED)
                          </Text>
                        </PremiumTooltip>
                        <Switch
                          label="Override organization-level settings"
                          value={form.watch("regressionAdjustmentOverride")}
                          onChange={(v) =>
                            form.setValue("regressionAdjustmentOverride", v)
                          }
                          disabled={!hasRegressionAdjustmentFeature}
                        />
                        {form.watch("regressionAdjustmentOverride") && (
                          <Flex direction="column" gap="2" mt="2">
                            <Checkbox
                              label="Apply regression adjustment for this metric"
                              value={
                                !!form.watch("regressionAdjustmentEnabled")
                              }
                              setValue={(v) =>
                                form.setValue("regressionAdjustmentEnabled", v)
                              }
                              disabled={!hasRegressionAdjustmentFeature}
                            />
                            <Field
                              label="Pre-exposure lookback period (days)"
                              type="number"
                              append="days"
                              min="0"
                              disabled={!hasRegressionAdjustmentFeature}
                              {...form.register("regressionAdjustmentDays", {
                                valueAsNumber: true,
                              })}
                            />
                          </Flex>
                        )}
                      </Frame>
                    )}
                  </>
                }
                {windowOk(formType) && (
                  <MetricWindowSettingsForm form={form} type={metricType} />
                )}
                {showsGoalAndSlices && (
                  <>
                    <Select
                      label="Metric goal"
                      value={form.watch("inverse") ? "1" : "0"}
                      setValue={(v) => form.setValue("inverse", v === "1")}
                    >
                      <SelectItem value="0">
                        Increase the metric value
                      </SelectItem>
                      <SelectItem value="1">
                        Decrease the metric value
                      </SelectItem>
                    </Select>
                    {showsAutoSlices && factTable && (
                      <Flex direction="column" mt="3" mb="4">
                        <MultiSelectField
                          label="Auto Slices"
                          value={form.watch("metricAutoSlices") || []}
                          onChange={(metricAutoSlices) =>
                            form.setValue("metricAutoSlices", metricAutoSlices)
                          }
                          options={factTable.columns
                            .filter(
                              (c) =>
                                c.isAutoSliceColumn &&
                                !c.deleted &&
                                !factTable.userIdTypes.includes(c.column),
                            )
                            .map((c) => ({
                              label: c.name || c.column,
                              value: c.column,
                            }))}
                          placeholder="Select Auto Slice columns..."
                        />
                      </Flex>
                    )}
                  </>
                )}
              </Flex>
            </TabsContent>
            <TabsContent value="display" forceMount>
              <Flex direction="column" gap="4">
                {
                  <>
                    <Frame mb="0">
                      <Field
                        label={
                          <>
                            {" "}
                            <Text as="div" weight="semibold" mb="2">
                              {minSampleSizeLabel}
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`Required in an experiment variation before showing results (default ${metricDefaults.minimumSampleSize})`}</Text>
                          </>
                        }
                        type="number"
                        {...form.register("minSampleSize", {
                          valueAsNumber: true,
                        })}
                      />
                    </Frame>
                    <Frame mb="0">
                      <Field
                        label={
                          <>
                            {" "}
                            <Text as="div" weight="semibold" mb="2">
                              Max percent change
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`An experiment that changes the metric by more than this percent will be flagged as suspicious (default ${
                              metricDefaults.maxPercentageChange * 100
                            }%)`}</Text>
                          </>
                        }
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("maxPercentChange", {
                          valueAsNumber: true,
                        })}
                      />
                    </Frame>
                    <Frame mb="0">
                      <Field
                        label={
                          <>
                            {" "}
                            <Text as="div" weight="semibold" mb="2">
                              Min percent change
                            </Text>
                            <Text
                              as="div"
                              weight="regular"
                              color="text-mid"
                              mb="2"
                            >{`An experiment that changes the metric by less than this percent will be considered a draw (default ${
                              metricDefaults.minPercentageChange * 100
                            }%)`}</Text>
                          </>
                        }
                        type="number"
                        step="any"
                        append="%"
                        {...form.register("minPercentChange", {
                          valueAsNumber: true,
                        })}
                      />
                    </Frame>
                    {(formType === "ratio" ||
                      formType === "dailyParticipation") && (
                      <Checkbox
                        label="Format variation value as a percentage"
                        value={form.watch("displayAsPercentage") ?? false}
                        setValue={(v) =>
                          form.setValue("displayAsPercentage", v)
                        }
                        description="Will render variation values as a percentage rather than a proportion (e.g. 34% instead of 0.34)."
                      />
                    )}
                  </>
                }
                {canEditOfficial && (
                  <Checkbox
                    label="Mark as official metric"
                    disabled={form.watch("managedBy") === "api"}
                    disabledMessage="This Metric is managed by the API, so it can not be edited in the UI."
                    description="Official Metrics can only be modified by Admins or users with the ManageOfficialResources policy."
                    value={form.watch("managedBy") === "admin"}
                    setValue={(value) =>
                      form.setValue("managedBy", value ? "admin" : "")
                    }
                  />
                )}
              </Flex>
            </TabsContent>
          </Tabs>
        </Flex>
      </details>
    </Frame>
  );
}
