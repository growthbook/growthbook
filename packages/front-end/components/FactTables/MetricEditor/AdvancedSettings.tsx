import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { FactTableDefinition } from "shared/types/fact-table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Link from "@/ui/Link";
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
// same facts and conditional hiding (Metric Delay only if set, Capping only
// if type+value are set), just reading off form state instead of a saved
// FactMetricInterface, and placed inside this same section for both modes.
function windowProse(
  windowSettings: {
    type: string;
    windowValue: number;
    windowUnit: string;
    delayValue: number;
  },
  metricType: string,
): string {
  const afterExposure =
    metricType === "retention"
      ? " plus the retention window"
      : windowSettings.delayValue
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

function cappingSummary(cappingSettings: {
  type: string;
  value: number;
  ignoreZeros?: boolean | null;
}): DataListItem | null {
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

// Collapsed by default, matching today's modal (metricformfields.md's
// "auto-opens when non-default" nice-to-have isn't built yet - a plain
// toggle already surfaces everything, just not open by default).
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
  const [open, setOpen] = useState(false);
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
  const priorSettings = form.watch("priorSettings");
  const cappingItem = cappingSummary(form.watch("cappingSettings"));

  if (!open) {
    return (
      <Frame>
        <Link onClick={() => setOpen(true)}>Show advanced settings</Link>
      </Frame>
    );
  }

  return (
    <Frame>
      {windowOk(formType) &&
        (canEdit ? (
          <MetricWindowSettingsForm form={form} type={metricType} />
        ) : (
          <Text as="div" mb="3">
            {windowProse(form.watch("windowSettings"), metricType)}
          </Text>
        ))}
      {showsGoalAndSlices &&
        (canEdit ? (
          <Select
            label="Metric goal"
            value={form.watch("inverse") ? "1" : "0"}
            setValue={(v) => form.setValue("inverse", v === "1")}
          >
            <SelectItem value="0">Increase the metric value</SelectItem>
            <SelectItem value="1">Decrease the metric value</SelectItem>
          </Select>
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
            ]}
          />
        ))}
      {showsGoalAndSlices &&
        hasCommercialFeature("metric-slices") &&
        factTable &&
        (canEdit ? (
          <Flex direction="column" mt="3" mb="4">
            <MultiSelectField
              label="Auto Slices"
              value={form.watch("metricAutoSlices") || []}
              onChange={(metricAutoSlices) =>
                form.setValue("metricAutoSlices", metricAutoSlices)
              }
              options={factTable.columns
                .filter((c) => c.isAutoSliceColumn && !c.deleted)
                .map((c) => ({ label: c.name || c.column, value: c.column }))}
              placeholder="Select Auto Slice columns..."
            />
          </Flex>
        ) : (
          <DataList
            columns={1}
            mt="3"
            mb="4"
            data={[
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
            ]}
          />
        ))}

      <Tabs defaultValue="query">
        <TabsList>
          <TabsTrigger value="query">Analysis settings</TabsTrigger>
          <TabsTrigger value="display">Display settings</TabsTrigger>
        </TabsList>

        <TabsContent value="query">
          {windowOk(formType) &&
            (canEdit ? (
              <MetricDelaySettings form={form} />
            ) : (
              <DataList
                columns={1}
                data={[
                  {
                    label: "Metric Delay",
                    value: `${form.watch("windowSettings").delayValue} ${form.watch("windowSettings").delayUnit} after experiment exposure`,
                  },
                ]}
              />
            ))}
          {cappingOk(formType) &&
            (canEdit ? (
              <MetricCappingSettingsForm
                form={form}
                datasourceType={datasource?.type}
                metricType={metricType}
              />
            ) : (
              cappingItem && <DataList columns={1} data={[cappingItem]} />
            ))}
          {canEdit ? (
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
          ) : (
            <DataList
              columns={1}
              data={[
                {
                  label: "Target MDE",
                  value: `${(form.watch("targetMDE") ?? 0) * 100}%`,
                },
              ]}
            />
          )}
          {canEdit ? (
            <MetricPriorSettingsForm
              priorSettings={priorSettings}
              setPriorSettings={(v) => form.setValue("priorSettings", v)}
              metricDefaults={metricDefaults}
            />
          ) : (
            <Flex direction="column" gap="1" mt="2" mb="2">
              <Text weight="semibold" size="sm" as="div">
                Priors
              </Text>
              {priorSettings.override ? (
                <>
                  <Text size="sm" as="div">
                    Use proper prior: {priorSettings.proper ? "On" : "Off"}
                  </Text>
                  {priorSettings.proper && (
                    <>
                      <Text size="sm" as="div">
                        Mean: {priorSettings.mean}
                      </Text>
                      <Text size="sm" as="div">
                        Standard deviation: {priorSettings.stddev}
                      </Text>
                    </>
                  )}
                </>
              ) : (
                <Text size="sm" color="text-mid" as="div">
                  Using organization defaults (proper prior:{" "}
                  {metricDefaults.priorSettings?.proper ? "On" : "Off"})
                </Text>
              )}
            </Flex>
          )}
          {formType !== "quantile" && (
            <>
              <PremiumTooltip commercialFeature="regression-adjustment">
                <Text weight="semibold" as="div" mb="1">
                  Regression adjustment (CUPED)
                </Text>
              </PremiumTooltip>
              {canEdit ? (
                <>
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
              ) : form.watch("regressionAdjustmentOverride") ? (
                <Flex direction="column" gap="1">
                  <Text size="sm" as="div">
                    Apply regression adjustment:{" "}
                    {form.watch("regressionAdjustmentEnabled") ? "On" : "Off"}
                  </Text>
                  <Text size="sm" as="div">
                    Lookback period (days):{" "}
                    {form.watch("regressionAdjustmentDays")}
                  </Text>
                </Flex>
              ) : orgSettings.regressionAdjustmentEnabled ? (
                <Text size="sm" color="text-mid" as="div">
                  Using organization defaults (apply regression adjustment:{" "}
                  {orgSettings.regressionAdjustmentEnabled ? "On" : "Off"},
                  lookback period: {orgSettings.regressionAdjustmentDays} days)
                </Text>
              ) : (
                <Text size="sm" color="text-mid" as="div">
                  Disabled
                </Text>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="display">
          {canEdit ? (
            <Field
              label={
                formType === "ratio"
                  ? "Minimum numerator total"
                  : "Minimum metric total"
              }
              type="number"
              {...form.register("minSampleSize", { valueAsNumber: true })}
              helpText={`Required in an experiment variation before showing results (default ${metricDefaults.minimumSampleSize})`}
            />
          ) : (
            <DataList
              columns={1}
              data={[
                {
                  label:
                    formType === "ratio"
                      ? "Minimum numerator total"
                      : "Minimum metric total",
                  value: form.watch("minSampleSize"),
                },
              ]}
            />
          )}
          {canEdit ? (
            <Field
              label="Max percent change"
              type="number"
              step="any"
              append="%"
              {...form.register("maxPercentChange", { valueAsNumber: true })}
              helpText={`An experiment that changes the metric by more than this percent will be flagged as suspicious (default ${
                metricDefaults.maxPercentageChange * 100
              }%)`}
            />
          ) : (
            <DataList
              columns={1}
              data={[
                {
                  label: "Max percent change",
                  value: `${form.watch("maxPercentChange") * 100}%`,
                },
              ]}
            />
          )}
          {canEdit ? (
            <Field
              label="Min percent change"
              type="number"
              step="any"
              append="%"
              {...form.register("minPercentChange", { valueAsNumber: true })}
              helpText={`An experiment that changes the metric by less than this percent will be considered a draw (default ${
                metricDefaults.minPercentageChange * 100
              }%)`}
            />
          ) : (
            <DataList
              columns={1}
              data={[
                {
                  label: "Min percent change",
                  value: `${form.watch("minPercentChange") * 100}%`,
                },
              ]}
            />
          )}
          {(formType === "ratio" || formType === "dailyParticipation") &&
            (canEdit ? (
              <Checkbox
                label="Format variation value as a percentage"
                value={form.watch("displayAsPercentage") ?? false}
                setValue={(v) => form.setValue("displayAsPercentage", v)}
                description="Will render variation values as a percentage rather than a proportion (e.g. 34% instead of 0.34)."
              />
            ) : (
              <DataList
                columns={1}
                data={[
                  {
                    label: "Format variation value as a percentage",
                    value: form.watch("displayAsPercentage") ? "Yes" : "No",
                  },
                ]}
              />
            ))}
        </TabsContent>
      </Tabs>

      {permissionsUtil.canUpdateOfficialResources(
        { projects: form.watch("projects") },
        {},
      ) &&
        hasCommercialFeature("manage-official-resources") &&
        (canEdit ? (
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
        ) : (
          <DataList
            columns={1}
            data={[
              {
                label: "Official metric",
                value: form.watch("managedBy") === "admin" ? "Yes" : "No",
              },
            ]}
          />
        ))}

      <Flex mt="3">
        <Link onClick={() => setOpen(false)}>Hide advanced settings</Link>
      </Flex>
    </Frame>
  );
}
