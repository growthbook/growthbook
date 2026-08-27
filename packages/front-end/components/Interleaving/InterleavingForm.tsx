import React, { FC, useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  ApiInterleavingInterface,
  InterleavingMetricConfig,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEM_ID_COLUMN,
} from "shared/validators";
import { isFactMetric } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
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
  metrics: InterleavingMetricConfig[];
};

type Props = {
  interleaving?: ApiInterleavingInterface;
  mode: "add" | "edit";
  onSave: (interleaving: ApiInterleavingInterface) => void;
  onCancel: () => void;
};

/**
 * Create/edit modal for an Interleaving experiment. Metrics are restricted
 * to mean/proportion Fact Metrics whose fact table has an `item_id` column.
 * Each metric is analyzed as "paired" or "ownership" — the user chooses, and
 * paired is only offered when the fact table also has `interleave_id`.
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
            metrics: interleaving.metrics,
          }
        : {
            name: "",
            description: "",
            datasource: "",
            interleavingQueryId: "",
            trackingKey: "",
            controlName: "control",
            treatmentName: "treatment",
            metrics: [],
          },
  });

  const datasource = form.watch("datasource");
  const metrics = form.watch("metrics");
  const { interleavingQueries } = useInterleavingQueries(
    datasource || undefined,
  );

  const factTableFor = (metricId: string) => {
    const metric = getExperimentMetricById(metricId);
    if (!metric || !isFactMetric(metric)) return null;
    return (
      factTables.find((ft) => ft.id === metric.numerator?.factTableId) ?? null
    );
  };
  const tableHasColumn = (metricId: string, column: string) =>
    !!factTableFor(metricId)?.columns.some(
      (c) => c.column === column && !c.deleted,
    );

  // Metrics whose fact table has no live item_id column can't be attributed
  // to items; the server rejects them, so warn before save
  const metricsMissingItemId = useMemo(() => {
    return metrics
      .map((m) => m.id)
      .filter(
        (id) =>
          factTableFor(id) && !tableHasColumn(id, INTERLEAVING_ITEM_ID_COLUMN),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, factTables, getExperimentMetricById]);

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
      metrics: value.metrics,
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
            form.setValue("metrics", []);
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
          goalMetrics={metrics.map((m) => m.id)}
          secondaryMetrics={[]}
          guardrailMetrics={[]}
          setGoalMetrics={(ids) => {
            const existing = new Map(metrics.map((m) => [m.id, m.estimator]));
            form.setValue(
              "metrics",
              ids.map((id) => ({
                id,
                estimator:
                  existing.get(id) ??
                  (tableHasColumn(id, INTERLEAVING_INTERLEAVE_ID_COLUMN)
                    ? "paired"
                    : "ownership"),
              })),
            );
          }}
          goalMetricAllowedFactMetricTypes={["mean", "proportion"]}
          noLegacyMetrics={true}
          noQuantileGoalMetrics={true}
          goalMetricsDescription="Mean or proportion Fact Metrics whose fact table includes an item_id column"
        />

        {metrics.length > 0 && (
          <div className="mt-2">
            <label>Analysis method per metric</label>
            {metrics.map((m, i) => {
              const pairedEligible = tableHasColumn(
                m.id,
                INTERLEAVING_INTERLEAVE_ID_COLUMN,
              );
              return (
                <Flex key={m.id} align="center" gap="3" mb="1">
                  <div style={{ minWidth: 220 }}>
                    {getExperimentMetricById(m.id)?.name || m.id}
                  </div>
                  <Tooltip
                    body={
                      pairedEligible
                        ? "Paired joins engagement to individual impressions via interleave_id (most sensitive). Ownership attributes engagement by each user's item-ownership shares."
                        : `Paired requires an '${INTERLEAVING_INTERLEAVE_ID_COLUMN}' column on this metric's fact table`
                    }
                  >
                    <SelectField
                      value={m.estimator}
                      options={[
                        {
                          value: "paired",
                          label: pairedEligible
                            ? "Paired"
                            : "Paired (requires interleave_id)",
                        },
                        { value: "ownership", label: "Ownership" },
                      ]}
                      disabled={!pairedEligible}
                      onChange={(v) => {
                        const next = [...metrics];
                        next[i] = {
                          id: m.id,
                          estimator: v === "paired" ? "paired" : "ownership",
                        };
                        form.setValue("metrics", next);
                      }}
                    />
                  </Tooltip>
                </Flex>
              );
            })}
          </div>
        )}

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
      </div>
    </ModalStandard>
  );
};

export default InterleavingForm;
