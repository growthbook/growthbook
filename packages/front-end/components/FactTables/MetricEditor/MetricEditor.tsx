import { UseFormReturn } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
import { Flex, Grid } from "@radix-ui/themes";
import { ColumnRef, FactMetricInterface } from "shared/types/fact-table";
import { reconcileInlineFilterPrompts } from "shared/experiments";
import {
  CreateFactMetricFormProps,
  getInitialInlineFilters,
} from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useFullFactTable from "@/hooks/useFullFactTable";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import Field from "@/components/Forms/Field";
import DataList from "@/ui/DataList";
import TagsInput from "@/components/Tags/TagsInput";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import FunnelStepsInput from "@/components/FactTables/FunnelStepsInput";
import MetricTypeSelect, {
  TYPE_LABELS,
} from "@/components/FactTables/MetricEditor/MetricTypeSelect";
import AdvancedSettings from "@/components/FactTables/MetricEditor/AdvancedSettings";
import FactTableLink from "@/components/FactTables/MetricEditor/FactTableLink";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";
import FunnelStepsDisplay from "@/components/FactTables/MetricEditor/FunnelStepsDisplay";
import DatasourcePicker from "@/components/FactTables/MetricEditor/DatasourcePicker";
import PreviewPanel from "@/components/FactTables/MetricEditor/PreviewPanel";
import MetricDescription from "@/components/FactTables/MetricEditor/MetricDescription";
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
  windowOk,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

const UNREPRESENTABLE_REASON_COPY: Record<UnrepresentableReason, string> = {
  "retention-lookback-window":
    "its lookback window is relative to the experiment end, which is not supported here",
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
  existingMetric,
}: {
  existingMetric?: FactMetricInterface | null;
  form: UseFormReturn<CreateFactMetricFormProps>;
  canEdit: boolean;
  // Lets MetricWorkspace gate its Save button on the same representable
  // check this component already computes for its own unrepresentable-
  // definition Callout, instead of deriving formTypeFromStored a second time
  // from the same form fields.
  onRepresentableChange?: (representable: boolean) => void;
}) {
  const {
    getFactTableById,
    getDatasourceById,
    factTables,
    datasources,
    project,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const [showDescription, setShowDescription] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showCappingConversionNotice, setShowCappingConversionNotice] =
    useState(false);
  const cappingSettings = form.watch("cappingSettings");

  const metricType = form.watch("metricType");
  const numerator = form.watch("numerator");
  const denominator = form.watch("denominator");
  const denominatorTableOverridden = useRef(
    !!denominator?.factTableId &&
      denominator.factTableId !== numerator.factTableId,
  );
  const initializedFilterTables = useRef({ numerator: "", denominator: "" });
  useEffect(() => {
    if (!canEdit || metricType === "funnel") return;
    for (const field of ["numerator", "denominator"] as const) {
      const ref = field === "numerator" ? numerator : denominator;
      if (field === "denominator" && metricType !== "ratio") continue;
      const table = getFactTableById(ref?.factTableId ?? "");
      if (!ref || !table || initializedFilterTables.current[field] === table.id)
        continue;
      initializedFilterTables.current[field] = table.id;
      const rowFilters = getInitialInlineFilters(table, ref.rowFilters);
      if (rowFilters.length !== (ref.rowFilters?.length ?? 0)) {
        form.setValue(field, { ...ref, rowFilters });
      }
    }
  }, [canEdit, metricType, numerator, denominator, getFactTableById, form]);
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
  // A new metric picks its datasource up front (page-level picker); every
  // fact table select below only offers that datasource's tables. Existing
  // metrics can't change datasource (the update payload omits it).
  const isNew = canEdit && !existingMetric;
  const datasourceOptions = datasources.filter((d) =>
    factTables.some((ft) => ft.datasource === d.id),
  );
  // The guessed default (org default / first datasource) may have no fact
  // tables, which would leave every select empty - fall back to one that does.
  useEffect(() => {
    if (!isNew || !datasourceOptions.length) return;
    if (!datasourceOptions.some((d) => d.id === datasourceId)) {
      form.setValue("datasource", datasourceOptions[0].id);
    }
  }, [isNew, datasourceOptions, datasourceId, form]);
  const sameDatasourceFactTables = factTables.filter(
    (ft) => !datasourceId || ft.datasource === datasourceId,
  );

  const previewSql = (() => {
    if (metricType === "funnel") {
      return funnelSettings && funnelSettings.steps.length > 0
        ? getFunnelPreviewSQL({
            steps: funnelSettings.steps,
            factTable:
              getFactTableById(funnelSettings.steps[0].factTableId) ?? null,
            windowSettings,
            getFactTableById: (id) => getFactTableById(id) ?? null,
            datasourceType: datasource?.type,
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
      cappingSettings,
      lowerCappingSettings: form.watch("lowerCappingSettings"),
      datasourceType: datasource?.type,
      numerator,
      denominator,
      numeratorFactTable: getFactTableById(numerator.factTableId) ?? null,
      denominatorFactTable:
        getFactTableById(denominator?.factTableId || "") ?? null,
    });
  })();

  const formTypeResult = formTypeFromStored(
    {
      metricType,
      numerator,
      denominator,
      quantileSettings,
      windowSettings: form.watch("windowSettings"),
    },
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
      <Flex direction="column" gap="3">
        <Callout status="warning">
          This metric&apos;s definition can&apos;t be shown in this editor:{" "}
          {UNREPRESENTABLE_REASON_COPY[formTypeResult.reason]}. Edit it via the
          API, or contact support if this is unexpected.
        </Callout>
      </Flex>
    );
  }
  const formType = formTypeResult.type;

  function changeFormType(newFormType: FormMetricType) {
    const previousCapping = form.getValues("cappingSettings");
    if (newFormType !== "ratio") denominatorTableOverridden.current = false;
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
      { hasCountDistinctHLL: () => hasCountDistinctHLL },
    );
    setShowCappingConversionNotice(
      previousCapping.type === "absolute" &&
        result.cappingSettings?.type === "percentile",
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
      onFactTableChange(numerator, newFactTable, {
        hasCountDistinctHLL: () => hasCountDistinctHLL,
      }),
    );
    if (metricType === "ratio" && !denominatorTableOverridden.current) {
      form.setValue(
        "denominator",
        onFactTableChange(
          denominator ?? { factTableId: "", column: "$$count", rowFilters: [] },
          newFactTable,
          { hasCountDistinctHLL: () => hasCountDistinctHLL },
        ),
      );
    }
  }

  function changeDatasource(newDatasourceId: string) {
    const dialect = { hasCountDistinctHLL: () => hasCountDistinctHLL };
    denominatorTableOverridden.current = false;
    form.setValue("datasource", newDatasourceId);
    form.setValue("numerator", onFactTableChange(numerator, null, dialect));
    if (denominator) {
      form.setValue(
        "denominator",
        onFactTableChange(denominator, null, dialect),
      );
    }
    if (funnelSettings) {
      form.setValue("funnelSettings", {
        ...funnelSettings,
        steps: funnelSettings.steps.map((step) => ({
          ...step,
          factTableId: "",
          rowFilters: [],
        })),
      });
    }
  }
  const hasChosenFactTable =
    !!numerator.factTableId ||
    !!denominator?.factTableId ||
    !!funnelSettings?.steps.some((step) => step.factTableId);

  const isFunnel = formType === "funnel";
  const isRatioOrFunnel = formType === "ratio" || isFunnel;
  const primaryFactTableSelect = (
    <Select
      label="Fact table"
      placeholder="Select a fact table"
      value={primaryFactTableId}
      setValue={changeFactTable}
    >
      {sameDatasourceFactTables.map((ft) => (
        <SelectItem key={ft.id} value={ft.id}>
          {ft.name}
        </SelectItem>
      ))}
    </Select>
  );
  const thresholdValue: ThresholdBasisValue = {
    aggregateFilterColumn: numerator.aggregateFilterColumn,
    aggregateFilter: numerator.aggregateFilter,
  };
  const onThresholdChange = (v: ThresholdBasisValue) =>
    form.setValue("numerator", { ...numerator, ...v });
  const valueShape = shapeForValueType(formType);

  const grid = (
    <Grid columns={{ initial: "1", md: "minmax(0, 1fr) 380px" }} gap="4">
      <Flex direction="column" gap="4" minWidth="0">
        <Frame px="4" py="4" mb="0">
          <Flex align="center" gap="1" mb="3">
            <Heading as="h4" size="sm" mb="0">
              Details
            </Heading>
            <OfficialBadge type="metric" managedBy={form.watch("managedBy")} />
          </Flex>
          {canEdit ? (
            <Flex direction="column" gap="3">
              <Text color="text-mid">
                Define this metric with a clear name, description, and tags.
              </Text>
              <TextField
                label="Name"
                autoFocus
                markRequired
                value={form.watch("name")}
                onChange={(e) => form.setValue("name", e.target.value)}
                required
              />
              <Grid columns={{ initial: "1", sm: "2" }} gap="4">
                <div style={{ minWidth: 0 }}>
                  {showDescription || form.watch("description") ? (
                    <Field
                      label="Description"
                      textarea
                      autoFocus={showDescription}
                      value={form.watch("description")}
                      onChange={(e) => {
                        setShowDescription(true);
                        form.setValue("description", e.target.value);
                      }}
                    />
                  ) : (
                    <Flex direction="column" align="start" gap="3">
                      <Text weight="semibold">Description</Text>
                      <Link size="sm" onClick={() => setShowDescription(true)}>
                        + Add a description
                      </Link>
                    </Flex>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  {showTags || !!form.watch("tags")?.length ? (
                    <TagsInput
                      label="Tags"
                      autoFocus={showTags}
                      value={form.watch("tags") || []}
                      onChange={(tags) => {
                        setShowTags(true);
                        form.setValue("tags", tags);
                      }}
                    />
                  ) : (
                    <Flex direction="column" align="start" gap="3">
                      <Text weight="semibold">Tags</Text>
                      <Link size="sm" onClick={() => setShowTags(true)}>
                        + Group with related metrics
                      </Link>
                    </Flex>
                  )}
                </div>
              </Grid>
            </Flex>
          ) : (
            <Flex direction="column" gap="6">
              <DataList
                columns={1}
                data={[{ label: "Name", value: form.watch("name") }]}
              />
              {existingMetric && <MetricDescription metric={existingMetric} />}
            </Flex>
          )}
        </Frame>

        <Frame px="4" py="4" mb="0">
          {!canEdit && (
            <Heading as="h4" size="sm" mb="3">
              Metric Type
            </Heading>
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
            </Flex>
          )}
        </Frame>

        {canEdit &&
          formType === "ratio" &&
          showCappingConversionNotice &&
          cappingSettings.type === "percentile" &&
          cappingSettings.value === 0 && (
            <Callout
              status="warning"
              role="status"
              action={
                <Link onClick={() => setShowCappingConversionNotice(false)}>
                  Dismiss
                </Link>
              }
            >
              Switching to Ratio automatically changed absolute capping to
              percentile capping and reset the value to 0. Choose a percentile
              before saving in Advanced settings → Analysis settings → &quot;Cap
              high values&quot; → &quot;Upper tail (ceiling percentile)&quot;.
            </Callout>
          )}

        <Frame px="4" py="4" mb="0">
          <Heading as="h4" size="sm" mb="3">
            Definition
          </Heading>
          <Flex direction="column" gap="3">
            {canEdit && !isRatioOrFunnel && primaryFactTableSelect}
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

            {!isRatioOrFunnel &&
              (canEdit ? (
                factTable && (
                  <RowFilterInput
                    factTable={factTable}
                    value={numerator.rowFilters || []}
                    setValue={(rowFilters) =>
                      form.setValue("numerator", {
                        ...numerator,
                        rowFilters: reconcileInlineFilterPrompts(
                          factTable,
                          numerator.rowFilters || [],
                          rowFilters,
                        ),
                      })
                    }
                  />
                )
              ) : (
                <FilterSummary
                  rowFilters={numerator.rowFilters || []}
                  factTable={factTable}
                />
              ))}
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
                    { hasCountDistinctHLL: () => hasCountDistinctHLL },
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
                numeratorFactTableSelect={primaryFactTableSelect}
                numerator={numerator}
                onNumeratorChange={(v: ColumnRef) =>
                  form.setValue("numerator", v)
                }
                denominator={denominator}
                onDenominatorChange={(v: ColumnRef) => {
                  if (v.factTableId !== denominator?.factTableId) {
                    denominatorTableOverridden.current = true;
                  }
                  form.setValue("denominator", v);
                }}
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
                  setValue={(v) => form.setValue("funnelSettings", v)}
                  datasource={datasourceId}
                  project={project}
                />
              ) : (
                <FunnelStepsDisplay
                  funnelSettings={funnelSettings ?? { steps: [] }}
                />
              ))}

            {windowOk(formType) &&
              (canEdit ? (
                <MetricWindowSettingsForm
                  form={form}
                  type={metricType}
                  autoFocus={false}
                />
              ) : (
                <DataList
                  data={[
                    {
                      label: "Metric window",
                      value: windowSettings.type
                        ? `${windowSettings.type === "conversion" ? "Conversion" : "Lookback"}: ${windowSettings.windowValue} ${windowSettings.windowUnit}`
                        : "None",
                    },
                  ]}
                />
              ))}
          </Flex>
        </Frame>
        <AdvancedSettings
          form={form}
          formType={formType}
          factTable={factTable}
          canEdit={canEdit}
        />
      </Flex>

      <Flex direction="column" gap="4" minWidth="0">
        <PreviewPanel
          draft={canEdit ? form.watch() : null}
          previewSql={previewSql}
          metric={canEdit ? null : existingMetric}
        />
      </Flex>
    </Grid>
  );

  if (!isNew) return grid;
  return (
    <Flex direction="column" gap="3">
      <Flex mt="-2">
        <DatasourcePicker
          value={datasourceId}
          options={datasourceOptions}
          onChange={changeDatasource}
          confirmChange={hasChosenFactTable}
        />
      </Flex>
      {grid}
    </Flex>
  );
}
