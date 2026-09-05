import { UseFormReturn } from "react-hook-form";
import { Flex, Grid } from "@radix-ui/themes";
import {
  ColumnRef,
  FactMetricType,
  FactTableDefinition,
  FunnelSettings,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import { getAggregateFilters } from "shared/experiments";
import {
  CreateFactMetricFormProps,
  getPercentileLabel,
} from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import DataList, { DataListItem } from "@/ui/DataList";
import TagsInput from "@/components/Tags/TagsInput";
import SortedTags from "@/components/Tags/SortedTags";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import FunnelStepsInput from "@/components/FactTables/FunnelStepsInput";
import MetricTypeSelect, {
  TYPE_DESCRIPTIONS,
  TYPE_LABELS,
} from "@/components/FactTables/MetricEditor/MetricTypeSelect";
import AdvancedSettings from "@/components/FactTables/MetricEditor/AdvancedSettings";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";
import FunnelStepsDisplay from "@/components/FactTables/MetricEditor/FunnelStepsDisplay";
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
  retentionModeFromWindow,
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

// Read-only helpers, ported from [fmid].tsx's numeratorData/denominatorData -
// same facts, adapted to read off form state instead of a saved FactMetricInterface.
function columnValueLabel(column: string): string {
  if (column === "$$count") return "Count of Rows";
  if (column === "$$distinctUsers") return "Unique Users";
  if (column === "$$distinctDates") return "Distinct Dates";
  return column;
}

function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");
  if (!factTable) {
    return (
      <em style={{ color: "var(--color-text-mid)" }}>Unknown fact table</em>
    );
  }
  return <Link href={`/fact-tables/${factTable.id}`}>{factTable.name}</Link>;
}

// Value/Per-User Aggregation/User Filter/Quantile lines only - Fact Table and
// Row Filter are separate top-level fields for every type these apply to
// (unlike Ratio, whose parts bundle their own fact table/filters).
function numeratorSummary({
  metricType,
  formType,
  numerator,
  quantileSettings,
}: {
  metricType: FactMetricType;
  formType: FormMetricType;
  numerator: ColumnRef;
  quantileSettings: MetricQuantileSettings | null;
}): DataListItem[] {
  // isBinomialMetric's own check ("proportion"|"retention"|"funnel") narrowed
  // to the two reachable here - funnel is handled by a wholly separate branch.
  const isBinomial = metricType === "proportion" || metricType === "retention";
  const userFilters = getAggregateFilters({
    columnRef: numerator,
    column:
      numerator.aggregateFilterColumn === "$$count"
        ? "COUNT(*)"
        : `SUM(${numerator.aggregateFilterColumn})`,
    ignoreInvalid: true,
  });

  return [
    ...(!isBinomial
      ? [{ label: "Value", value: columnValueLabel(numerator.column) }]
      : []),
    ...(!numerator.column.startsWith("$$") &&
    (formType !== "quantile" || quantileSettings?.type === "unit")
      ? [
          {
            label: "Per-User Aggregation",
            value: (numerator.aggregation || "SUM").toUpperCase(),
          },
        ]
      : userFilters.length > 0
        ? [{ label: "User Filter", value: userFilters.join(" AND ") }]
        : []),
    ...(formType === "quantile" && quantileSettings
      ? [
          { label: "Quantile Scope", value: quantileSettings.type },
          {
            label: "Ignore Zeros",
            value: quantileSettings.ignoreZeros ? "Yes" : "No",
          },
          {
            label: "Quantile",
            value: getPercentileLabel(quantileSettings.quantile),
          },
        ]
      : []),
  ];
}

// Ratio parts bundle fact table + filters + value/aggregation together,
// matching RatioFields' own per-part Frame in edit mode.
function ratioPartSummary(
  value: ColumnRef,
  factTable: FactTableDefinition | null,
): DataListItem[] {
  return [
    { label: "Fact Table", value: <FactTableLink id={value.factTableId} /> },
    {
      label: "Row Filter",
      value: (
        <FilterSummary
          rowFilters={value.rowFilters || []}
          factTable={factTable}
        />
      ),
    },
    { label: "Value", value: columnValueLabel(value.column) },
    ...(!value.column.startsWith("$$")
      ? [
          {
            label: "Per-User Aggregation",
            value: (value.aggregation || "SUM").toUpperCase(),
          },
        ]
      : []),
  ];
}

function retentionWindowProse(windowSettings: {
  delayValue: number;
  delayUnit: string;
  windowValue: number;
}): string {
  const mode = retentionModeFromWindow(windowSettings);
  if (mode === "starting") {
    return `Starting ${windowSettings.delayValue} ${windowSettings.delayUnit} after exposure`;
  }
  const end = windowSettings.delayValue + windowSettings.windowValue;
  return `Between ${windowSettings.delayValue} and ${end} ${windowSettings.delayUnit} after exposure`;
}

export default function MetricEditor({
  form,
  canEdit,
  funnelSettings,
  onFunnelSettingsChange,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  canEdit: boolean;
  funnelSettings: FunnelSettings | null;
  onFunnelSettingsChange: (value: FunnelSettings | null) => void;
}) {
  const { getFactTableById, getDatasourceById, factTables, project } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();

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
  // rewrite the definition on save - this applies regardless of canEdit.
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
          {canEdit ? (
            <MetricTypeSelect
              value={formType}
              onChange={changeFormType}
              hasRetentionMetrics={hasCommercialFeature("retention-metrics")}
              hasFunnelMetrics={hasCommercialFeature("funnel-metrics")}
              hasQuantileMetrics={hasCommercialFeature("quantile-metrics")}
              quantileAvailableForDatasource={quantileAvailableForDatasource}
            />
          ) : (
            <Flex direction="column" gap="1">
              <Text weight="semibold" as="div">
                {TYPE_LABELS[formType]}
              </Text>
              <Text size="sm" color="text-mid" as="div">
                {TYPE_DESCRIPTIONS[formType]}
              </Text>
            </Flex>
          )}
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
            {!isFunnel &&
              (canEdit ? (
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
              ) : (
                !isRatioOrFunnel && (
                  <DataList
                    columns={1}
                    data={[
                      {
                        label: "Fact Table",
                        value: <FactTableLink id={primaryFactTableId} />,
                      },
                    ]}
                  />
                )
              ))}

            {formType === "threshold" &&
              (canEdit ? (
                <ThresholdBasisRow
                  value={thresholdValue}
                  onChange={onThresholdChange}
                  factTable={factTable}
                />
              ) : null)}

            {formType === "retention" &&
              (canEdit ? (
                <RetentionFields
                  windowSettings={form.watch("windowSettings")}
                  onWindowSettingsChange={(v) =>
                    form.setValue("windowSettings", v)
                  }
                  threshold={thresholdValue}
                  onThresholdChange={onThresholdChange}
                  factTable={factTable}
                />
              ) : (
                <Text as="div">
                  {retentionWindowProse(form.watch("windowSettings"))}
                </Text>
              ))}

            {valueShape &&
              (canEdit ? (
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
              ) : null)}

            {!isRatioOrFunnel && (
              <DataList
                columns={1}
                data={numeratorSummary({
                  metricType,
                  formType,
                  numerator,
                  quantileSettings,
                })}
              />
            )}

            {formType === "quantile" && quantileSettings && canEdit && (
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

            {formType === "ratio" && denominator && canEdit && (
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

            {formType === "ratio" && denominator && !canEdit && (
              <Flex direction="column" gap="3">
                <Frame p="3" mb="0">
                  <Text weight="semibold" size="sm" mb="2" as="div">
                    Numerator
                  </Text>
                  <DataList
                    columns={1}
                    data={ratioPartSummary(numerator, factTable)}
                  />
                </Frame>
                <Frame p="3" mb="0">
                  <Text weight="semibold" size="sm" mb="2" as="div">
                    Denominator
                  </Text>
                  <DataList
                    columns={1}
                    data={ratioPartSummary(
                      denominator,
                      getFactTableById(denominator.factTableId) ?? factTable,
                    )}
                  />
                </Frame>
              </Flex>
            )}

            {isFunnel &&
              (canEdit ? (
                <FunnelStepsInput
                  value={funnelSettings ?? { steps: [] }}
                  setValue={onFunnelSettingsChange}
                  datasource={datasourceId}
                  project={project}
                  initialFactTable={primaryFactTableId || undefined}
                />
              ) : (
                <FunnelStepsDisplay
                  funnelSettings={funnelSettings ?? { steps: [] }}
                />
              ))}

            {!isRatioOrFunnel &&
              (canEdit ? (
                factTable && (
                  <RowFilterInput
                    factTable={factTable}
                    value={numerator.rowFilters || []}
                    setValue={(rowFilters) =>
                      form.setValue("numerator", { ...numerator, rowFilters })
                    }
                  />
                )
              ) : (
                <FilterSummary
                  rowFilters={numerator.rowFilters || []}
                  factTable={factTable}
                />
              ))}
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
            {canEdit ? (
              <TextField
                label="Name"
                value={form.watch("name")}
                onChange={(e) => form.setValue("name", e.target.value)}
                required
              />
            ) : (
              <DataList
                columns={1}
                data={[{ label: "Name", value: form.watch("name") }]}
              />
            )}
            {canEdit ? (
              <Field
                label="Description"
                textarea
                value={form.watch("description")}
                onChange={(e) => form.setValue("description", e.target.value)}
              />
            ) : (
              <DataList
                columns={1}
                data={[
                  {
                    label: "Description",
                    value: form.watch("description") || "—",
                  },
                ]}
              />
            )}
            {canEdit ? (
              <Flex direction="column" gap="1">
                <Text weight="semibold" size="sm" as="div">
                  Tags
                </Text>
                <TagsInput
                  value={form.watch("tags") || []}
                  onChange={(tags) => form.setValue("tags", tags)}
                />
              </Flex>
            ) : (
              <Flex direction="column" gap="1">
                <Text weight="semibold" size="sm" as="div">
                  Tags
                </Text>
                {form.watch("tags")?.length ? (
                  <SortedTags tags={form.watch("tags")} useFlex />
                ) : (
                  <Text color="text-mid" as="div">
                    No tags
                  </Text>
                )}
              </Flex>
            )}
          </Flex>
        </Frame>

        <AdvancedSettings
          form={form}
          formType={formType}
          factTable={factTable}
          canEdit={canEdit}
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
