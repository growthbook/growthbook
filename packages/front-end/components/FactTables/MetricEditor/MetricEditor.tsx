import { UseFormReturn } from "react-hook-form";
import { useEffect, useMemo } from "react";
import { Flex, Grid } from "@radix-ui/themes";
import { ColumnRef } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import DataList from "@/ui/DataList";
import TagsInput from "@/components/Tags/TagsInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import FunnelStepsInput from "@/components/FactTables/FunnelStepsInput";
import MetricTypeSelect, {
  TYPE_DESCRIPTIONS,
  TYPE_LABELS,
} from "@/components/FactTables/MetricEditor/MetricTypeSelect";
import AdvancedSettings from "@/components/FactTables/MetricEditor/AdvancedSettings";
import FactTableLink from "@/components/FactTables/MetricEditor/FactTableLink";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";
import FunnelStepsDisplay from "@/components/FactTables/MetricEditor/FunnelStepsDisplay";
import PreviewPanel, {
  PreviewPart,
} from "@/components/FactTables/MetricEditor/PreviewPanel";
import {
  getFunnelPreviewSQL,
  getPreviewSQL,
} from "@/components/FactTables/MetricEditor/previewSql";
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

export default function MetricEditor({
  form,
  canEdit,
  onRepresentableChange,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  canEdit: boolean;
  // Lets MetricWorkspace gate its Save button on the same representable
  // check this component already computes for its own unrepresentable-
  // definition Callout, instead of deriving formTypeFromStored a second time
  // from the same form fields.
  onRepresentableChange?: (representable: boolean) => void;
}) {
  const { getFactTableById, getDatasourceById, factTables, project } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();

  const metricType = form.watch("metricType");
  const numerator = form.watch("numerator");
  const denominator = form.watch("denominator");
  const quantileSettings = form.watch("quantileSettings");
  const windowSettings = form.watch("windowSettings");
  const funnelSettings = form.watch("funnelSettings");
  const datasourceId = form.watch("datasource");
  const datasource = getDatasourceById(datasourceId);
  const hasCountDistinctHLL = !!datasource?.properties?.hasCountDistinctHLL;
  const quantileAvailableForDatasource =
    !!datasource?.properties?.hasQuantileTesting;

  const primaryFactTableId =
    metricType === "funnel"
      ? (funnelSettings?.steps[0]?.factTableId ?? "")
      : numerator.factTableId;
  // useDefinitions()'s own factTables/getFactTableById return the slimmed
  // definitions-endpoint shape (no jsonFields per column) - fine for the
  // Fact Table select's own options list, but every column/filter picker
  // rendered below needs the full fact table, or JSON sub-field columns are
  // simply missing and an existing filter referencing one reads as invalid.
  const { factTable } = useFullFactTable(primaryFactTableId || null);
  // The primary Fact Table select is what DERIVES datasource (spec, see
  // changeFactTable below) - filtering its own options by a datasource that
  // hasn't actually been chosen yet would make some or all fact tables
  // permanently unreachable (e.g. a fresh create's guessed default
  // datasource has no fact tables of its own: the selector would be empty
  // with no way out). Ratio's denominator override is different: it has to
  // stay on the SAME datasource as the already-chosen numerator, since one
  // metric's query runs against one datasource.
  const availableFactTables = factTables;
  const sameDatasourceFactTables = factTables.filter(
    (ft) => !datasourceId || ft.datasource === datasourceId,
  );

  // Illustrative (fact table shown by its display name, never its actual
  // configured `sql`), computed purely client-side - see previewSql.ts for
  // why this can't just reuse the real dialect-correct SQL the "Run Preview"
  // (rows) tab generates server-side. Computed above the unrepresentable-
  // definition early return below, since hooks can't run conditionally.
  const previewSql = useMemo(() => {
    if (metricType === "funnel") {
      return funnelSettings && funnelSettings.steps.length > 0
        ? getFunnelPreviewSQL({
            steps: funnelSettings.steps,
            factTable:
              getFactTableById(funnelSettings.steps[0].factTableId) ?? null,
            windowSettings,
          })
        : null;
    }
    return getPreviewSQL({
      type: metricType,
      // Only meaningful for type === "quantile", where the form always sets
      // it - this default just satisfies the type for every other metric.
      quantileSettings: quantileSettings ?? {
        type: "event",
        quantile: 0.5,
        ignoreZeros: false,
      },
      windowSettings,
      numerator,
      denominator,
      numeratorFactTable: getFactTableById(numerator.factTableId) ?? null,
      denominatorFactTable:
        getFactTableById(denominator?.factTableId || "") ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    metricType,
    numerator,
    denominator,
    quantileSettings,
    windowSettings,
    funnelSettings,
  ]);

  const formTypeResult = formTypeFromStored(
    { metricType, numerator, denominator, quantileSettings },
    factTable,
  );

  useEffect(() => {
    onRepresentableChange?.(formTypeResult.representable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formTypeResult.representable]);

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
    // One atomic reset instead of a pile of setValues - safe because nothing
    // reads form.formState.isDirty. numerator is carried over as the old
    // value rather than written through: funnel has no numerator, and
    // CreateFactMetricFormProps types it against the Standard side of a
    // discriminated union (see its own comment in services/metrics.tsx) -
    // matches today's modal, which leaves the stale ColumnRef in the form
    // and only nulls it in the submit payload.
    form.reset({
      ...form.getValues(),
      metricType: result.metricType,
      numerator: result.numerator ?? numerator,
      denominator: result.denominator ?? null,
      quantileSettings: result.quantileSettings ?? null,
      funnelSettings: result.funnelSettings ?? null,
      ...(result.cappingSettings && {
        cappingSettings: result.cappingSettings,
      }),
      ...(result.windowSettings && { windowSettings: result.windowSettings }),
    });
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

  // Funnel has no single numerator/denominator to preview - each step owns
  // its own fact table and filters, a shape this simple row-level preview
  // isn't built for.
  const previewParts: PreviewPart[] = isFunnel
    ? []
    : [
        {
          key: "numerator",
          label: formType === "ratio" ? "Numerator" : "Metric",
          factTable: getFactTableById(numerator.factTableId) ?? null,
          rowFilters: numerator.rowFilters || [],
        },
        ...(formType === "ratio" && denominator
          ? [
              {
                key: "denominator",
                label: "Denominator",
                factTable: getFactTableById(denominator.factTableId) ?? null,
                rowFilters: denominator.rowFilters || [],
              },
            ]
          : []),
      ];

  return (
    <Grid columns={{ initial: "1", md: "2fr 1fr" }} gap="4">
      <Flex direction="column" gap="4">
        <Frame>
          <Heading as="h4" size="sm" mb="1">
            Metric Type
          </Heading>
          {canEdit && (
            <Text color="text-mid" as="div" mb="3">
              Choose what kind of number this metric produces.
            </Text>
          )}
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
          {canEdit && (
            <Text color="text-mid" as="div" mb="3">
              Tell us what to count and where to find it, and we&apos;ll take
              care of matching it to the right experiments.
            </Text>
          )}
          <Flex direction="column" gap="3">
            {/* Ratio's numerator has no override of its own, so this select
                is its only way to set a fact table - only funnel (which owns
                per-step fact tables via FunnelStepsInput) hides it. Read-only
                mode shows it here for every type except ratio, which shows
                its own Fact Table line per-part below instead. */}
            {canEdit && !isFunnel && (
              <Select
                label="Fact table"
                value={primaryFactTableId}
                setValue={changeFactTable}
              >
                {availableFactTables.map((ft) => (
                  <SelectItem key={ft.id} value={ft.id}>
                    {ft.name} (
                    {getDatasourceById(ft.datasource)?.name || ft.datasource})
                  </SelectItem>
                ))}
              </Select>
            )}
            {!canEdit && !isRatioOrFunnel && (
              <DataList
                columns={1}
                data={[
                  {
                    label: "Fact table",
                    value: <FactTableLink id={primaryFactTableId} />,
                  },
                ]}
              />
            )}

            {formType === "threshold" && (
              <ThresholdBasisRow
                value={thresholdValue}
                onChange={onThresholdChange}
                factTable={factTable}
                canEdit={canEdit}
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
                canEdit={canEdit}
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
                canEdit={canEdit}
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
                canEdit={canEdit}
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
                availableFactTables={sameDatasourceFactTables}
                getFactTableById={(id) => getFactTableById(id) ?? null}
                hasCountDistinctHLL={hasCountDistinctHLL}
                canEdit={canEdit}
              />
            )}

            {isFunnel &&
              (canEdit ? (
                <FunnelStepsInput
                  value={funnelSettings ?? { steps: [] }}
                  setValue={(v) => {
                    form.setValue("funnelSettings", v);
                    // Datasource is derived from the fact table, not selected
                    // directly (spec) - same as changeFactTable does for every
                    // other type, just off step 1's fact table instead of the
                    // numerator's, since that's what primaryFactTableId
                    // already treats as the authoritative one for funnel.
                    const stepFactTable = getFactTableById(
                      v.steps[0]?.factTableId ?? "",
                    );
                    if (stepFactTable) {
                      form.setValue("datasource", stepFactTable.datasource);
                    }
                  }}
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
          <Flex align="center" gap="1" mb="1">
            <Heading as="h4" size="sm" mb="0">
              Basics
            </Heading>
            <OfficialBadge type="metric" managedBy={form.watch("managedBy")} />
          </Flex>
          {canEdit && (
            <Text color="text-mid" as="div" mb="3">
              Define this metric with a clear name, description, and tags.
            </Text>
          )}
          {canEdit ? (
            <Flex direction="column" gap="3">
              <TextField
                label="Name"
                value={form.watch("name")}
                onChange={(e) => form.setValue("name", e.target.value)}
                required
              />
              <Field
                label="Description"
                textarea
                value={form.watch("description")}
                onChange={(e) => form.setValue("description", e.target.value)}
              />
              <TagsInput
                label="Tags"
                autoFocus={false}
                value={form.watch("tags") || []}
                onChange={(tags) => form.setValue("tags", tags)}
              />
            </Flex>
          ) : (
            <Flex direction="column" gap="6">
              <DataList
                columns={1}
                data={[
                  { label: "Name", value: form.watch("name") },
                  {
                    label: "Description",
                    value: form.watch("description") || "—",
                  },
                ]}
              />
              <div>
                <Text weight="semibold" as="div" mb="2">
                  Tags
                </Text>
                {form.watch("tags")?.length ? (
                  <SortedTags tags={form.watch("tags")} useFlex />
                ) : (
                  <Text>No tags</Text>
                )}
              </div>
            </Flex>
          )}
        </Frame>

        <AdvancedSettings
          form={form}
          formType={formType}
          factTable={factTable}
          canEdit={canEdit}
        />
      </Flex>

      <Flex direction="column" gap="4">
        <PreviewPanel parts={previewParts} previewSql={previewSql} />

        <Frame>
          <Heading as="h4" size="sm" mb="3">
            Details
          </Heading>
          <DataList
            columns={1}
            data={[
              { label: "Owner", value: form.watch("owner") || "—" },
              {
                label: "Metric goal",
                value: form.watch("inverse")
                  ? "Decrease the metric value"
                  : "Increase the metric value",
              },
            ]}
          />
        </Frame>
      </Flex>
    </Grid>
  );
}
