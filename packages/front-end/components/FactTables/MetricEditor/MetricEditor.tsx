import { useId } from "react";
import { UseFormReturn } from "react-hook-form";
import { Flex, Grid, TextArea } from "@radix-ui/themes";
import { ColumnRef, FunnelSettings } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import TagsInput from "@/components/Tags/TagsInput";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import FunnelStepsInput from "@/components/FactTables/FunnelStepsInput";
import MetricTypeSelect from "@/components/FactTables/MetricEditor/MetricTypeSelect";
import AdvancedSettings from "@/components/FactTables/MetricEditor/AdvancedSettings";
import PreviewPanel, {
  MetricDetailsPanel,
} from "@/components/FactTables/MetricEditor/PreviewPanel";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import ThresholdBasisRow, {
  ThresholdBasisValue,
} from "@/components/FactTables/MetricEditor/typeFields/ThresholdBasisRow";
import RetentionFields from "@/components/FactTables/MetricEditor/typeFields/RetentionFields";
import QuantileFields from "@/components/FactTables/MetricEditor/typeFields/QuantileFields";
import RatioFields from "@/components/FactTables/MetricEditor/typeFields/RatioFields";
import {
  applyFormType,
  formTypeFromStored,
  FormMetricType,
  onFactTableChange,
  onShapeChange,
  shapeForValueType,
  UnrepresentableReason,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

const UNREPRESENTABLE_REASON_COPY: Record<UnrepresentableReason, string> = {
  "sketch-aggregation":
    "it uses an HLL or KLL sketch aggregation, which isn't supported here",
  "quantile-event-count-column":
    "it uses a quantile event-count column, which isn't supported here",
  "mean-on-distinct-users":
    "it averages a distinct-users column, which isn't supported here",
  "unsupported-aggregate-filter":
    "its threshold comparison uses a column or basis that isn't supported here",
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
  const { getFactTableById, getDatasourceById, factTables, project } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();
  const descriptionId = useId();

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
        This metric&apos;s definition can&apos;t be shown in this editor:{" "}
        {UNREPRESENTABLE_REASON_COPY[formTypeResult.reason]}. Edit it via the
        API, or contact support if this is unexpected.
      </Callout>
    );
  }
  const formType = formTypeResult.type;

  function changeFormType(newFormType: FormMetricType) {
    const result = applyFormType(
      {
        metricType,
        numerator,
        denominator,
        quantileSettings,
        funnelSettings,
        cappingSettings: form.watch("cappingSettings"),
        windowSettings: form.watch("windowSettings"),
      },
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
    if (result.cappingSettings) {
      form.setValue("cappingSettings", result.cappingSettings);
    }
    if (result.windowSettings) {
      form.setValue("windowSettings", result.windowSettings);
    }
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

  const isFunnel = formType === "funnel";
  const isRatioOrFunnel = formType === "ratio" || isFunnel;
  const thresholdValue: ThresholdBasisValue = {
    aggregateFilterColumn: numerator.aggregateFilterColumn,
    aggregateFilter: numerator.aggregateFilter,
  };
  const onThresholdChange = (v: ThresholdBasisValue) =>
    form.setValue("numerator", { ...numerator, ...v });
  const valueShape = shapeForValueType(formType);

  return (
    <Grid columns={{ initial: "1", md: "2fr 1fr" }} gap="4">
      <Flex direction="column" gap="4">
        <Frame>
          <Heading as="h4" size="sm" mb="1">
            Metric Type
          </Heading>
          <Text color="text-mid" as="div" mb="3">
            Choose what kind of number this metric produces.
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
            {/* Ratio's numerator has no override of its own, so this select
                is its only way to set a fact table - only funnel (which owns
                per-step fact tables via FunnelStepsInput) hides it. */}
            {!isFunnel && (
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
              <ThresholdBasisRow
                value={thresholdValue}
                onChange={onThresholdChange}
                factTable={factTable}
              />
            )}

            {formType === "retention" && (
              <RetentionFields
                windowSettings={form.watch("windowSettings")}
                onWindowSettingsChange={(v) =>
                  form.setValue("windowSettings", v)
                }
                threshold={thresholdValue}
                onThresholdChange={onThresholdChange}
                factTable={factTable}
              />
            )}

            {valueShape && (
              <ColumnSelect
                shape={valueShape}
                factTable={factTable}
                hasCountDistinctHLL={hasCountDistinctHLL}
                value={numerator.column}
                onChange={(column) => {
                  const refit = onShapeChange(
                    numerator,
                    valueShape,
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

            {isFunnel && (
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
              <Text
                as="label"
                htmlFor={descriptionId}
                weight="semibold"
                size="sm"
              >
                Description
              </Text>
              <TextArea
                id={descriptionId}
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

        <AdvancedSettings
          form={form}
          formType={formType}
          factTable={factTable}
        />
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
