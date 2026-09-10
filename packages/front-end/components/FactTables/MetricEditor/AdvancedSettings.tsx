import { UseFormReturn } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import {
  FactTableDefinition,
  MetricCappingSettings,
  MetricPriorSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";
import {
  MetricDefaults,
  OrganizationSettings,
} from "shared/types/organization";
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
import { Select, SelectItem } from "@/ui/Select";
import Heading from "@/ui/Heading";
import MultiSelectField from "@/ui/MultiSelectField";
import DataList, { DataListItem } from "@/ui/DataList";
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

// Read-only prose, ported from [fmid].tsx's right-rail Advanced Settings -
// same facts and conditional hiding, just reading off form state instead of
// a saved FactMetricInterface, and placed inside this same section for both
// modes. No metricType param: windowOk already excludes retention at the
// call site, so a "plus the retention window" clause here could never fire.
function windowProse(windowSettings: MetricWindowSettings): string {
  const afterExposure = windowSettings.delayValue
    ? " plus the metric delay"
    : "";
  if (windowSettings.type === "conversion") {
    return `Conversion Window - Require conversions to happen within ${windowSettings.windowValue} ${windowSettings.windowUnit} of first experiment exposure${afterExposure}.`;
  }
  if (windowSettings.type === "lookback") {
    return `Lookback Window - Require metric data to be in latest ${windowSettings.windowValue} ${windowSettings.windowUnit} of the experiment.`;
  }
  return `Disabled - Include all metric data after first experiment exposure${afterExposure}.`;
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

function priorsItemValue(
  priorSettings: MetricPriorSettings,
  metricDefaults: MetricDefaults,
): string {
  if (!priorSettings.override) {
    return `Using organization defaults (proper prior: ${
      metricDefaults.priorSettings?.proper ? "On" : "Off"
    })`;
  }
  const properPart = priorSettings.proper
    ? ` (mean ${priorSettings.mean}, stddev ${priorSettings.stddev})`
    : "";
  return `Use proper prior: ${priorSettings.proper ? "On" : "Off"}${properPart}`;
}

function cupedItemValue(
  regressionAdjustment: {
    override: boolean;
    enabled?: boolean;
    days?: number;
  },
  orgSettings: OrganizationSettings,
): string {
  if (regressionAdjustment.override) {
    return `Apply: ${
      regressionAdjustment.enabled ? "On" : "Off"
    }, lookback ${regressionAdjustment.days} days`;
  }
  if (orgSettings.regressionAdjustmentEnabled) {
    return `Using organization defaults (apply: On, lookback ${orgSettings.regressionAdjustmentDays} days)`;
  }
  return "Disabled";
}

// Query tab's read-only side, next to cappingSummary/windowProse - one
// DataList for the whole tab instead of a canEdit branch per control.
function queryItems({
  form,
  formType,
  windowSettings,
  priorSettings,
  cappingItem,
  metricDefaults,
  orgSettings,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  formType: FormMetricType;
  windowSettings: MetricWindowSettings;
  priorSettings: MetricPriorSettings;
  cappingItem: DataListItem | null;
  metricDefaults: MetricDefaults;
  orgSettings: OrganizationSettings;
}): DataListItem[] {
  return [
    ...(windowOk(formType) && windowSettings.delayValue
      ? [
          {
            label: "Metric delay",
            value: `${windowSettings.delayValue} ${windowSettings.delayUnit} after experiment exposure`,
          },
        ]
      : []),
    ...(cappingOk(formType) && cappingItem ? [cappingItem] : []),
    {
      label: "Target MDE",
      value: `${form.watch("targetMDE") ?? 0}%`,
    },
    { label: "Priors", value: priorsItemValue(priorSettings, metricDefaults) },
    ...(formType !== "quantile"
      ? [
          {
            label: "Regression adjustment (CUPED)",
            value: cupedItemValue(
              {
                override: form.watch("regressionAdjustmentOverride"),
                enabled: form.watch("regressionAdjustmentEnabled"),
                days: form.watch("regressionAdjustmentDays"),
              },
              orgSettings,
            ),
          },
        ]
      : []),
  ];
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

  return (
    <Frame>
      <Heading as="h4" size="sm" mb="3">
        Advanced Settings
      </Heading>
      <Flex direction="column" gap="3">
        {windowOk(formType) &&
          (canEdit ? (
            <MetricWindowSettingsForm form={form} type={metricType} />
          ) : (
            <Text as="div" mb="3">
              {windowProse(windowSettings)}
            </Text>
          ))}
        {showsGoalAndSlices &&
          (canEdit ? (
            <>
              <Select
                label="Metric goal"
                value={form.watch("inverse") ? "1" : "0"}
                setValue={(v) => form.setValue("inverse", v === "1")}
              >
                <SelectItem value="0">Increase the metric value</SelectItem>
                <SelectItem value="1">Decrease the metric value</SelectItem>
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
                      .filter((c) => c.isAutoSliceColumn && !c.deleted)
                      .map((c) => ({
                        label: c.name || c.column,
                        value: c.column,
                      }))}
                    placeholder="Select Auto Slice columns..."
                  />
                </Flex>
              )}
            </>
          ) : (
            <DataList
              columns={1}
              data={[
                {
                  label: "Metric goal",
                  value: form.watch("inverse")
                    ? "Decrease the metric value"
                    : "Increase the metric value",
                },
                ...(showsAutoSlices && factTable
                  ? [
                      {
                        label: "Auto Slices",
                        value:
                          (form.watch("metricAutoSlices") || [])
                            .map(
                              (col) =>
                                factTable.columns.find((c) => c.column === col)
                                  ?.name || col,
                            )
                            .join(", ") || "None",
                      },
                    ]
                  : []),
              ]}
            />
          ))}

        <details open={!canEdit || undefined}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Analysis settings
          </summary>
          <Flex direction="column" gap="3" mt="3">
            {canEdit ? (
              <>
                {windowOk(formType) && <MetricDelaySettings form={form} />}
                {cappingOk(formType) && (
                  <MetricCappingSettingsForm
                    form={form}
                    datasourceType={datasource?.type}
                    metricType={metricType}
                  />
                )}
                <Field
                  label="Target MDE"
                  type="number"
                  step="any"
                  append="%"
                  {...form.register("targetMDE", { valueAsNumber: true })}
                  helpText={`The percentage change that you want to reliably detect before ending your experiment. (default ${
                    metricDefaults.targetMDE * 100
                  }%)`}
                />
                <MetricPriorSettingsForm
                  priorSettings={priorSettings}
                  setPriorSettings={(v) => form.setValue("priorSettings", v)}
                  metricDefaults={metricDefaults}
                />
                {formType !== "quantile" && (
                  <>
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
                          value={!!form.watch("regressionAdjustmentEnabled")}
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
                  </>
                )}
              </>
            ) : (
              <DataList
                columns={1}
                data={queryItems({
                  form,
                  formType,
                  windowSettings,
                  priorSettings,
                  cappingItem,
                  metricDefaults,
                  orgSettings,
                })}
              />
            )}
          </Flex>
        </details>
        <details open={!canEdit || undefined}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Display settings
          </summary>
          <Flex direction="column" gap="3" mt="3">
            {canEdit ? (
              <>
                <Field
                  label={minSampleSizeLabel}
                  type="number"
                  {...form.register("minSampleSize", { valueAsNumber: true })}
                  helpText={`Required in an experiment variation before showing results (default ${metricDefaults.minimumSampleSize})`}
                />
                <Field
                  label="Max percent change"
                  type="number"
                  step="any"
                  append="%"
                  {...form.register("maxPercentChange", {
                    valueAsNumber: true,
                  })}
                  helpText={`An experiment that changes the metric by more than this percent will be flagged as suspicious (default ${
                    metricDefaults.maxPercentageChange * 100
                  }%)`}
                />
                <Field
                  label="Min percent change"
                  type="number"
                  step="any"
                  append="%"
                  {...form.register("minPercentChange", {
                    valueAsNumber: true,
                  })}
                  helpText={`An experiment that changes the metric by less than this percent will be considered a draw (default ${
                    metricDefaults.minPercentageChange * 100
                  }%)`}
                />
                {(formType === "ratio" ||
                  formType === "dailyParticipation") && (
                  <Checkbox
                    label="Format variation value as a percentage"
                    value={form.watch("displayAsPercentage") ?? false}
                    setValue={(v) => form.setValue("displayAsPercentage", v)}
                    description="Will render variation values as a percentage rather than a proportion (e.g. 34% instead of 0.34)."
                  />
                )}
              </>
            ) : (
              <DataList
                columns={1}
                data={[
                  {
                    label: minSampleSizeLabel,
                    value: form.watch("minSampleSize"),
                  },
                  {
                    label: "Max percent change",
                    value: `${form.watch("maxPercentChange")}%`,
                  },
                  {
                    label: "Min percent change",
                    value: `${form.watch("minPercentChange")}%`,
                  },
                  ...(formType === "ratio" || formType === "dailyParticipation"
                    ? [
                        {
                          label: "Format variation value as a percentage",
                          value: form.watch("displayAsPercentage")
                            ? "Yes"
                            : "No",
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </Flex>
        </details>

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
    </Frame>
  );
}
