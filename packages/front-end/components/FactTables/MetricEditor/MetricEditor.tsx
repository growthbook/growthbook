import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { Flex, Grid, TextArea } from "@radix-ui/themes";
import { ColumnRef, FunnelSettings } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import FunnelStepsInput from "@/components/FactTables/FunnelStepsInput";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import { MetricCappingSettingsForm } from "@/components/Metrics/MetricForm/MetricCappingSettingsForm";
import { MetricDelaySettings } from "@/components/Metrics/MetricForm/MetricDelaySettings";
import { MetricPriorSettingsForm } from "@/components/Metrics/MetricForm/MetricPriorSettingsForm";
import MetricTypeSelect from "@/components/FactTables/MetricEditor/MetricTypeSelect";
import PreviewPanel, {
  MetricDetailsPanel,
} from "@/components/FactTables/MetricEditor/PreviewPanel";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import ThresholdFields, {
  ThresholdBasisValue,
} from "@/components/FactTables/MetricEditor/typeFields/ThresholdFields";
import RetentionFields from "@/components/FactTables/MetricEditor/typeFields/RetentionFields";
import QuantileFields from "@/components/FactTables/MetricEditor/typeFields/QuantileFields";
import RatioFields from "@/components/FactTables/MetricEditor/typeFields/RatioFields";
import {
  applyFormType,
  formTypeFromStored,
  FormMetricType,
  onFactTableChange,
  onShapeChange,
  RatioShape,
  windowOk,
  cappingOk,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

// Pins the shape for the five Value-group form types - the type choice
// already fixes it 1:1, so these never show a ShapeSelect (spec).
const VALUE_TYPE_SHAPE: Partial<Record<FormMetricType, RatioShape>> = {
  rowCount: "count",
  colSum: "sum",
  colMax: "max",
  countDist: "distinct",
  activeDays: "days",
};

// MetricEditor takes no canEdit/isNew props yet - this PR only builds the
// editable tree. PR 4 adds canEdit once a read-only branch exists to consume
// it; isNew has no behavioral difference here yet either.
export default function MetricEditor({
  form,
  funnelSettings,
  onFunnelSettingsChange,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  funnelSettings: FunnelSettings | null;
  onFunnelSettingsChange: (value: FunnelSettings | null) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { getFactTableById, getDatasourceById, factTables, project } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const metricType = form.watch("metricType");
  const numerator = form.watch("numerator");
  const denominator = form.watch("denominator");
  const quantileSettings = form.watch("quantileSettings");
  const datasourceId = form.watch("datasource");
  const datasource = getDatasourceById(datasourceId);
  const hasCountDistinctHLL = !!datasource?.properties?.hasCountDistinctHLL;
  const quantileAvailableForDatasource =
    !!datasource?.properties?.hasQuantileTesting;

  const primaryFactTableId =
    metricType === "funnel"
      ? (funnelSettings?.steps[0]?.factTableId ?? "")
      : numerator.factTableId;
  const factTable = getFactTableById(primaryFactTableId) ?? null;
  const availableFactTables = factTables.filter(
    (ft) => !datasourceId || ft.datasource === datasourceId,
  );

  const formTypeResult = formTypeFromStored(
    { metricType, numerator, denominator, quantileSettings },
    factTable,
  );

  // Definitions the form can't represent (spec) are opened read-only with an
  // explanation rather than coerced to the nearest type, which would silently
  // rewrite the definition on save - this applies regardless of edit
  // permission, so it isn't deferred to PR 4's canEdit branch.
  if (!formTypeResult.representable) {
    return (
      <Callout status="warning">
        This metric&apos;s definition can&apos;t be shown in this editor (
        {formTypeResult.reason}). Edit it via the API, or contact support if
        this is unexpected.
      </Callout>
    );
  }
  const formType = formTypeResult.type;

  function changeFormType(newFormType: FormMetricType) {
    const result = applyFormType(
      { metricType, numerator, denominator, quantileSettings, funnelSettings },
      newFormType,
      factTable,
      hasCountDistinctHLL,
    );
    form.setValue("metricType", result.metricType);
    // Funnel has no numerator - matches today's modal, which leaves the
    // stale ColumnRef in the form and only nulls it in the submit payload.
    if (result.numerator) form.setValue("numerator", result.numerator);
    form.setValue("denominator", result.denominator ?? null);
    form.setValue("quantileSettings", result.quantileSettings ?? null);
    onFunnelSettingsChange(result.funnelSettings ?? null);
  }

  function changeFactTable(newFactTableId: string) {
    const newFactTable = getFactTableById(newFactTableId) ?? null;
    form.setValue(
      "numerator",
      onFactTableChange(
        numerator,
        newFactTableId,
        newFactTable,
        hasCountDistinctHLL,
      ),
    );
    // Datasource is derived from the fact table, not selected directly (spec).
    if (newFactTable) form.setValue("datasource", newFactTable.datasource);
  }

  const isRatioOrFunnel = formType === "ratio" || formType === "funnel";

  return (
    <Grid columns={{ initial: "1", md: "2fr 1fr" }} gap="4">
      <Flex direction="column" gap="4">
        <Frame>
          <Heading as="h4" size="sm" mb="1">
            Metric type
          </Heading>
          <Text color="text-mid" as="div" mb="3">
            Pick how everyday activity should turn into one number: a total, a
            percentage, an average.
          </Text>
          <MetricTypeSelect
            value={formType}
            onChange={changeFormType}
            hasRetentionMetrics={hasCommercialFeature("retention-metrics")}
            hasFunnelMetrics={hasCommercialFeature("funnel-metrics")}
            hasQuantileMetrics={hasCommercialFeature("quantile-metrics")}
            quantileAvailableForDatasource={quantileAvailableForDatasource}
          />
        </Frame>

        <Frame>
          <Heading as="h4" size="sm" mb="1">
            Definition
          </Heading>
          <Text color="text-mid" as="div" mb="3">
            Tell us what to count and where to find it, and we&apos;ll take care
            of matching it to the right experiments.
          </Text>
          <Flex direction="column" gap="3">
            {!isRatioOrFunnel && (
              <Select
                label="Fact table"
                value={primaryFactTableId}
                setValue={changeFactTable}
              >
                {availableFactTables.map((ft) => (
                  <SelectItem key={ft.id} value={ft.id}>
                    {ft.name}
                  </SelectItem>
                ))}
              </Select>
            )}

            {formType === "threshold" && (
              <ThresholdFields
                value={{
                  aggregateFilterColumn: numerator.aggregateFilterColumn,
                  aggregateFilter: numerator.aggregateFilter,
                }}
                onChange={(v: ThresholdBasisValue) =>
                  form.setValue("numerator", { ...numerator, ...v })
                }
                factTable={factTable}
              />
            )}

            {formType === "retention" && (
              <RetentionFields
                windowSettings={form.watch("windowSettings")}
                onWindowSettingsChange={(v) =>
                  form.setValue("windowSettings", v)
                }
                threshold={{
                  aggregateFilterColumn: numerator.aggregateFilterColumn,
                  aggregateFilter: numerator.aggregateFilter,
                }}
                onThresholdChange={(v: ThresholdBasisValue) =>
                  form.setValue("numerator", { ...numerator, ...v })
                }
                factTable={factTable}
              />
            )}

            {VALUE_TYPE_SHAPE[formType] && (
              <ColumnSelect
                shape={VALUE_TYPE_SHAPE[formType] as RatioShape}
                factTable={factTable}
                hasCountDistinctHLL={hasCountDistinctHLL}
                value={numerator.column}
                onChange={(column) => {
                  const refit = onShapeChange(
                    numerator,
                    VALUE_TYPE_SHAPE[formType] as RatioShape,
                    factTable,
                    hasCountDistinctHLL,
                  );
                  form.setValue("numerator", { ...refit, column });
                }}
              />
            )}

            {formType === "quantile" && quantileSettings && (
              <QuantileFields
                quantileSettings={quantileSettings}
                onQuantileSettingsChange={(v) =>
                  form.setValue("quantileSettings", v)
                }
                numerator={numerator}
                onNumeratorChange={(v: ColumnRef) =>
                  form.setValue("numerator", v)
                }
                onScopeChange={({ numerator: n, quantileSettings: qs }) => {
                  form.setValue("numerator", n);
                  form.setValue("quantileSettings", qs);
                }}
                factTable={factTable}
                hasCountDistinctHLL={hasCountDistinctHLL}
              />
            )}

            {formType === "ratio" && denominator && (
              <RatioFields
                numerator={numerator}
                onNumeratorChange={(v: ColumnRef) =>
                  form.setValue("numerator", v)
                }
                denominator={denominator}
                onDenominatorChange={(v: ColumnRef) =>
                  form.setValue("denominator", v)
                }
                factTable={factTable}
                availableFactTables={availableFactTables}
                getFactTableById={(id) => getFactTableById(id) ?? null}
                hasCountDistinctHLL={hasCountDistinctHLL}
              />
            )}

            {formType === "funnel" && (
              <FunnelStepsInput
                value={funnelSettings ?? { steps: [] }}
                setValue={onFunnelSettingsChange}
                datasource={datasourceId}
                project={project}
                initialFactTable={primaryFactTableId || undefined}
              />
            )}

            {!isRatioOrFunnel && factTable && (
              <RowFilterInput
                factTable={factTable}
                value={numerator.rowFilters || []}
                setValue={(rowFilters) =>
                  form.setValue("numerator", { ...numerator, rowFilters })
                }
              />
            )}
          </Flex>
        </Frame>

        <Frame>
          <Heading as="h4" size="sm" mb="1">
            Basics
          </Heading>
          <Text color="text-mid" as="div" mb="3">
            Define this metric with a clear name, description, and tags.
          </Text>
          <Flex direction="column" gap="3">
            <TextField
              label="Name"
              value={form.watch("name")}
              onChange={(e) => form.setValue("name", e.target.value)}
              required
            />
            <Flex direction="column" gap="1">
              <Text weight="semibold" size="sm" as="div">
                Description
              </Text>
              <TextArea
                value={form.watch("description")}
                onChange={(e) => form.setValue("description", e.target.value)}
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text weight="semibold" size="sm" as="div">
                Tags
              </Text>
              <TagsInput
                value={form.watch("tags") || []}
                onChange={(tags) => form.setValue("tags", tags)}
              />
            </Flex>
          </Flex>
        </Frame>

        <Frame>
          {advancedOpen ? (
            <>
              {windowOk(formType) && (
                <MetricWindowSettingsForm form={form} type={metricType} />
              )}
              {formType !== "funnel" && (
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
              {formType !== "funnel" &&
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
                        .map((c) => ({
                          label: c.name || c.column,
                          value: c.column,
                        }))}
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
                        disabled={
                          !hasCommercialFeature("regression-adjustment")
                        }
                      />
                      {form.watch("regressionAdjustmentOverride") && (
                        <Flex direction="column" gap="2" mt="2">
                          <Checkbox
                            label="Apply regression adjustment for this metric"
                            value={!!form.watch("regressionAdjustmentEnabled")}
                            setValue={(v) =>
                              form.setValue("regressionAdjustmentEnabled", v)
                            }
                            disabled={
                              !hasCommercialFeature("regression-adjustment")
                            }
                          />
                          <Field
                            label="Pre-exposure lookback period (days)"
                            type="number"
                            append="days"
                            min="0"
                            disabled={
                              !hasCommercialFeature("regression-adjustment")
                            }
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
                    {...form.register("minSampleSize", {
                      valueAsNumber: true,
                    })}
                    helpText={`Required in an experiment variation before showing results (default ${metricDefaults.minimumSampleSize})`}
                  />
                  <Field
                    label="Max Percent Change"
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
                    label="Min Percent Change"
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
            </>
          ) : (
            <Link href="#" onClick={() => setAdvancedOpen(true)}>
              Show advanced settings
            </Link>
          )}
        </Frame>
      </Flex>

      <Flex direction="column" gap="4">
        <PreviewPanel />
        <MetricDetailsPanel
          data={[
            { label: "Owner", value: form.watch("owner") || "—" },
            {
              label: "Directionality",
              value: form.watch("inverse") ? "Decrease" : "Increase",
            },
          ]}
        />
      </Flex>
    </Grid>
  );
}
