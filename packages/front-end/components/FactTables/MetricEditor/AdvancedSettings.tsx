import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { FactTableDefinition } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "@/components/Metrics/MetricForm/MetricCappingSettingsForm";
import { MetricDelaySettings } from "@/components/Metrics/MetricForm/MetricDelaySettings";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";
import {
  cappingOk,
  FormMetricType,
  windowOk,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

// Collapsed by default, matching today's modal (metricformfields.md's
// "auto-opens when non-default" nice-to-have isn't built yet - a plain
// toggle already surfaces everything, just not open by default).
export default function AdvancedSettings({
  form,
  formType,
  factTable,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  formType: FormMetricType;
  factTable: FactTableDefinition | null;
}) {
  const [open, setOpen] = useState(false);
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const metricType = form.watch("metricType");
  const datasource = getDatasourceById(form.watch("datasource"));
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const showsGoalAndSlices = formType !== "funnel";

  if (!open) {
    return (
      <Frame>
        <Link href="#" onClick={() => setOpen(true)}>
          Show advanced settings
        </Link>
      </Frame>
    );
  }

  return (
    <Frame>
      {windowOk(formType) && (
        <MetricWindowSettingsForm form={form} type={metricType} />
      )}
      {showsGoalAndSlices && (
        <SelectField
          label="Metric Goal"
          value={form.watch("inverse") ? "1" : "0"}
          onChange={(v) => form.setValue("inverse", v === "1")}
          options={[
            { value: "0", label: "Increase the metric value" },
            { value: "1", label: "Decrease the metric value" },
          ]}
        />
      )}
      {showsGoalAndSlices &&
        hasCommercialFeature("metric-slices") &&
        factTable && (
          <Flex direction="column" gap="1" mt="3" mb="4">
            <Text weight="semibold" size="sm" as="div">
              Auto Slices
            </Text>
            <MultiSelectField
              value={form.watch("metricAutoSlices") || []}
              onChange={(metricAutoSlices) =>
                form.setValue("metricAutoSlices", metricAutoSlices)
              }
              options={factTable.columns
                .filter((c) => c.isAutoSliceColumn && !c.deleted)
                .map((c) => ({ label: c.name || c.column, value: c.column }))}
              placeholder="Select auto slice columns..."
            />
          </Flex>
        )}

      <Tabs defaultValue="query">
        <TabsList>
          <TabsTrigger value="query">Analysis Settings</TabsTrigger>
          <TabsTrigger value="display">Display Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="query">
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
            priorSettings={form.watch("priorSettings")}
            setPriorSettings={(priorSettings) =>
              form.setValue("priorSettings", priorSettings)
            }
            metricDefaults={metricDefaults}
          />
          {formType !== "quantile" && (
            <>
              <Text weight="semibold" as="div" mb="1">
                Regression Adjustment (CUPED)
              </Text>
              <Checkbox
                label="Override organization-level settings"
                value={form.watch("regressionAdjustmentOverride")}
                setValue={(v) =>
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
        </TabsContent>

        <TabsContent value="display">
          <Field
            label={
              formType === "ratio"
                ? "Minimum Numerator Total"
                : "Minimum Metric Total"
            }
            type="number"
            {...form.register("minSampleSize", { valueAsNumber: true })}
            helpText={`Required in an experiment variation before showing results (default ${metricDefaults.minimumSampleSize})`}
          />
          <Field
            label="Max Percent Change"
            type="number"
            step="any"
            append="%"
            {...form.register("maxPercentChange", { valueAsNumber: true })}
            helpText={`An experiment that changes the metric by more than this percent will be flagged as suspicious (default ${
              metricDefaults.maxPercentageChange * 100
            }%)`}
          />
          <Field
            label="Min Percent Change"
            type="number"
            step="any"
            append="%"
            {...form.register("minPercentChange", { valueAsNumber: true })}
            helpText={`An experiment that changes the metric by less than this percent will be considered a draw (default ${
              metricDefaults.minPercentageChange * 100
            }%)`}
          />
          {(formType === "ratio" || formType === "dailyParticipation") && (
            <Checkbox
              label="Format variation value as a percentage"
              value={form.watch("displayAsPercentage") ?? false}
              setValue={(v) => form.setValue("displayAsPercentage", v)}
              description="Will render variation values as a percentage rather than a proportion (e.g. 34% instead of 0.34)."
            />
          )}
        </TabsContent>
      </Tabs>

      {permissionsUtil.canUpdateOfficialResources(
        { projects: form.watch("projects") },
        {},
      ) &&
        hasCommercialFeature("manage-official-resources") && (
          <Checkbox
            label="Mark as Official Metric"
            disabled={form.watch("managedBy") === "api"}
            disabledMessage="This Metric is managed by the API, so it can not be edited in the UI."
            description="Official Metrics can only be modified by Admins or users with the ManageOfficialResources policy."
            value={form.watch("managedBy") === "admin"}
            setValue={(value) =>
              form.setValue("managedBy", value ? "admin" : "")
            }
          />
        )}
    </Frame>
  );
}
