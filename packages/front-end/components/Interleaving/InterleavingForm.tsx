import React, { FC, useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  ApiInterleavingInterface,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEM_ID_COLUMN,
} from "shared/validators";
import { isFactMetric } from "shared/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import { useInterleavingQueries } from "@/hooks/useInterleavingQueries";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";

type InterleavingFormValues = {
  name: string;
  description?: string;
  datasource: string;
  interleavingQueryId: string;
  trackingKey: string;
  controlName: string;
  treatmentName: string;
  metricIds: string[];
};

type Props = {
  interleaving?: ApiInterleavingInterface;
  mode: "add" | "edit";
  onSave: (interleaving: ApiInterleavingInterface) => void;
  onCancel: () => void;
};

/**
 * Create/edit modal for an Interleaving experiment. Metrics are restricted to
 * mean/proportion Fact Metrics; metrics whose fact table lacks an `item_id`
 * column are flagged here and rejected server-side.
 */
export const InterleavingForm: FC<Props> = ({
  interleaving,
  mode,
  onSave,
  onCancel,
}) => {
  const { apiCall } = useAuth();
  const { datasources, project, factTables, getExperimentMetricById } =
    useDefinitions();

  const form = useForm<InterleavingFormValues>({
    defaultValues:
      mode === "edit" && interleaving
        ? {
            name: interleaving.name,
            description: interleaving.description ?? "",
            datasource: interleaving.datasource,
            interleavingQueryId: interleaving.interleavingQueryId,
            trackingKey: interleaving.trackingKey,
            controlName: interleaving.variationNames[0],
            treatmentName: interleaving.variationNames[1],
            metricIds: interleaving.metricIds,
          }
        : {
            name: "",
            description: "",
            datasource: "",
            interleavingQueryId: "",
            trackingKey: "",
            controlName: "control",
            treatmentName: "treatment",
            metricIds: [],
          },
  });

  const datasource = form.watch("datasource");
  const metricIds = form.watch("metricIds");
  const { interleavingQueries } = useInterleavingQueries(
    datasource || undefined,
  );

  // Metrics whose fact table has no live item_id column can't be attributed
  // to items; the server rejects them, so warn before save
  const metricsMissingItemId = useMemo(() => {
    return metricIds.filter((id) => {
      const metric = getExperimentMetricById(id);
      if (!metric || !isFactMetric(metric)) return false;
      const factTable = factTables.find(
        (ft) => ft.id === metric.numerator?.factTableId,
      );
      if (!factTable) return false;
      return !factTable.columns.some(
        (c) => c.column === INTERLEAVING_ITEM_ID_COLUMN && !c.deleted,
      );
    });
  }, [metricIds, factTables, getExperimentMetricById]);

  // Purely informational: which analysis each selected metric will get
  const selectedQueryId = form.watch("interleavingQueryId");
  const metricsUsingOwnership = useMemo(() => {
    const query = interleavingQueries.find((q) => q.id === selectedQueryId);
    return metricIds.filter((id) => {
      const metric = getExperimentMetricById(id);
      if (!metric || !isFactMetric(metric)) return false;
      const factTable = factTables.find(
        (ft) => ft.id === metric.numerator?.factTableId,
      );
      const factTableHasInterleaveId = !!factTable?.columns.some(
        (c) => c.column === INTERLEAVING_INTERLEAVE_ID_COLUMN && !c.deleted,
      );
      return !(query?.hasInterleaveId && factTableHasInterleaveId);
    });
  }, [
    metricIds,
    factTables,
    interleavingQueries,
    getExperimentMetricById,
    selectedQueryId,
  ]);

  const handleSubmit = form.handleSubmit(async (value) => {
    if (metricsMissingItemId.length > 0) {
      const names = metricsMissingItemId
        .map((id) => getExperimentMetricById(id)?.name || id)
        .join(", ");
      throw new Error(
        `These metrics' fact tables have no '${INTERLEAVING_ITEM_ID_COLUMN}' column: ${names}. Add the column or remove the metrics.`,
      );
    }
    const body = {
      name: value.name,
      description: value.description || undefined,
      trackingKey: value.trackingKey,
      interleavingQueryId: value.interleavingQueryId,
      variationNames: [value.controlName, value.treatmentName],
      metricIds: value.metricIds,
    };

    const res =
      mode === "edit" && interleaving
        ? await apiCall<{ interleaving: ApiInterleavingInterface }>(
            `/api/v1/interleavings/${interleaving.id}`,
            { method: "PUT", body: JSON.stringify(body) },
          )
        : await apiCall<{ interleaving: ApiInterleavingInterface }>(
            "/api/v1/interleavings",
            {
              method: "POST",
              body: JSON.stringify({
                ...body,
                datasource: value.datasource,
                project: project || undefined,
              }),
            },
          );
    onSave(res.interleaving);
  });

  const saveEnabled =
    !!form.watch("name") &&
    !!datasource &&
    !!form.watch("interleavingQueryId") &&
    !!form.watch("trackingKey") &&
    !!form.watch("controlName") &&
    !!form.watch("treatmentName");

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={
        mode === "add"
          ? "Add interleaving experiment"
          : "Edit interleaving experiment"
      }
      cta="Save"
      ctaEnabled={saveEnabled}
    >
      <div className="my-2 ml-3 mr-3">
        <Field label="Name" required {...form.register("name")} />
        <Field
          label="Description (optional)"
          textarea
          minRows={1}
          {...form.register("description")}
        />
        <Field
          label="Tracking key"
          helpText="Must match the SDK interleave experiment key (experiment_id in exposures)"
          required
          {...form.register("trackingKey")}
        />
        <SelectField
          label="Data Source"
          options={datasources.map((d) => ({ value: d.id, label: d.name }))}
          value={datasource}
          disabled={mode === "edit"}
          required
          onChange={(v) => {
            form.setValue("datasource", v);
            form.setValue("interleavingQueryId", "");
            form.setValue("metricIds", []);
          }}
        />
        <SelectField
          label="Interleaving exposure query"
          options={interleavingQueries.map((q) => ({
            value: q.id,
            label: q.name,
          }))}
          value={form.watch("interleavingQueryId")}
          disabled={!datasource}
          required
          onChange={(v) => form.setValue("interleavingQueryId", v)}
          helpText={
            datasource && interleavingQueries.length === 0
              ? "No interleaving exposure queries on this Data Source yet — add one from the Data Source page"
              : undefined
          }
        />
        <div className="row">
          <div className="col">
            <Field
              label="Control ranker name"
              helpText="Must match the SDK list name"
              required
              {...form.register("controlName")}
            />
          </div>
          <div className="col">
            <Field
              label="Treatment ranker name"
              helpText="Must match the SDK list name"
              required
              {...form.register("treatmentName")}
            />
          </div>
        </div>

        <ExperimentMetricsSelector
          datasource={datasource}
          project={project}
          experimentType={undefined}
          goalMetrics={metricIds}
          secondaryMetrics={[]}
          guardrailMetrics={[]}
          setGoalMetrics={(ids) => form.setValue("metricIds", ids)}
          goalMetricAllowedFactMetricTypes={["mean", "proportion"]}
          noLegacyMetrics={true}
          noQuantileGoalMetrics={true}
          goalMetricsDescription="Mean or proportion Fact Metrics whose fact table includes an item_id column"
        />

        {metricsMissingItemId.length > 0 && (
          <Callout status="error" mt="2">
            These metrics&apos; fact tables have no{" "}
            <code>{INTERLEAVING_ITEM_ID_COLUMN}</code> column, so engagement
            cannot be attributed to items:{" "}
            {metricsMissingItemId
              .map((id) => getExperimentMetricById(id)?.name || id)
              .join(", ")}
          </Callout>
        )}
        {metricsUsingOwnership.length > 0 &&
          metricsMissingItemId.length === 0 && (
            <Callout status="info" mt="2">
              Without <code>{INTERLEAVING_INTERLEAVE_ID_COLUMN}</code> on both
              the exposure query and the metric fact table, these metrics use
              the ownership analysis instead of the more sensitive paired
              analysis:{" "}
              {metricsUsingOwnership
                .map((id) => getExperimentMetricById(id)?.name || id)
                .join(", ")}
            </Callout>
          )}
      </div>
    </ModalStandard>
  );
};

export default InterleavingForm;
