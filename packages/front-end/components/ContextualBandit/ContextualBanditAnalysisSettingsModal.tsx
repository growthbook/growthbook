import { Fragment, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";

type FormValues = {
  datasource: string;
  contextualBanditQueryId: string;
  regressionAdjustmentEnabled: boolean;
  activationMetric: string;
  segment: string;
  queryFilter: string;
  skipPartialData: boolean;
};

export default function ContextualBanditAnalysisSettingsModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { datasources, getDatasourceById, segments, metrics } =
    useDefinitions();
  const settings = useOrgSettings();

  const form = useForm<FormValues>({
    defaultValues: {
      datasource: cb.datasource ?? "",
      contextualBanditQueryId: cb.contextualBanditQueryId ?? "",
      regressionAdjustmentEnabled: cb.regressionAdjustmentEnabled ?? false,
      activationMetric: cb.activationMetric ?? "",
      segment: cb.segment ?? "",
      queryFilter: cb.queryFilter ?? "",
      skipPartialData: cb.skipPartialData ?? false,
    },
  });

  const watchedDatasource = form.watch("datasource");
  const watchedQueryId = form.watch("contextualBanditQueryId");

  const datasource = watchedDatasource
    ? getDatasourceById(watchedDatasource)
    : null;

  const { contextualBanditQueries } = useContextualBanditQueries(
    datasource?.id,
  );

  const selectedQuery = useMemo(
    () => contextualBanditQueries.find((q) => q.id === watchedQueryId),
    [contextualBanditQueries, watchedQueryId],
  );

  const derivedContextualAttributes =
    selectedQuery?.targetingAttributeColumns ?? [];

  useEffect(() => {
    if (!contextualBanditQueries.length) return;
    if (!contextualBanditQueries.find((q) => q.id === watchedQueryId)) {
      form.setValue(
        "contextualBanditQueryId",
        contextualBanditQueries[0]?.id ?? "",
      );
    }
  }, [contextualBanditQueries, watchedQueryId, form]);

  const metricsForDatasource = useMemo(
    () => (metrics ?? []).filter((m) => m.datasource === watchedDatasource),
    [metrics, watchedDatasource],
  );

  const segmentsForDatasource = useMemo(
    () => segments.filter((s) => s.datasource === watchedDatasource),
    [segments, watchedDatasource],
  );

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-analysis-settings"
      header="Edit Analysis Settings"
      close={close}
      cta="Save"
      size="lg"
      submit={form.handleSubmit(async (data) => {
        const query = contextualBanditQueries.find(
          (q) => q.id === data.contextualBanditQueryId,
        );
        const contextualAttributes =
          query?.targetingAttributeColumns ?? cb.contextualAttributes;

        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({
            datasource: data.datasource || undefined,
            contextualBanditQueryId: data.contextualBanditQueryId || undefined,
            contextualAttributes,
            regressionAdjustmentEnabled: data.regressionAdjustmentEnabled,
            activationMetric: data.activationMetric || undefined,
            segment: data.segment || undefined,
            queryFilter: data.queryFilter || undefined,
            skipPartialData: data.skipPartialData,
          }),
        });
        mutate();
      })}
    >
      <SelectField
        label="Data Source"
        value={form.watch("datasource")}
        onChange={(v) => {
          form.setValue("datasource", v);
          form.setValue("activationMetric", "");
          form.setValue("segment", "");
        }}
        options={datasources.map((d) => ({
          value: d.id,
          label:
            d.name + (d.id === settings?.defaultDataSource ? " (default)" : ""),
        }))}
        initialOption="None"
        helpText="Only data sources with a Contextual Bandit query can power a Contextual Bandit."
      />

      {contextualBanditQueries.length > 0 ? (
        <SelectField
          label="Contextual Bandit Query"
          value={form.watch("contextualBanditQueryId")}
          onChange={(v) => form.setValue("contextualBanditQueryId", v)}
          required
          options={contextualBanditQueries.map((q) => ({
            value: q.id,
            label: q.name,
          }))}
          helpText="The bandit assignment query for this data source."
        />
      ) : null}

      {selectedQuery ? (
        <div className="form-group">
          <label className="font-weight-bold">Contextual Attributes</label>
          <div>
            {derivedContextualAttributes.length > 0 ? (
              derivedContextualAttributes.map((attr, i) => (
                <Fragment key={attr}>
                  {i > 0 ? ", " : ""}
                  <code>{attr}</code>
                </Fragment>
              ))
            ) : (
              <em className="text-muted">
                None — add targeting attribute columns to the selected query.
              </em>
            )}
          </div>
          <small className="form-text text-muted">
            Derived from the selected Contextual Bandit query.
          </small>
        </div>
      ) : null}

      <hr className="my-4" />

      <Switch
        label="Use Regression Adjustment (CUPED)"
        value={form.watch("regressionAdjustmentEnabled")}
        onChange={(v) => form.setValue("regressionAdjustmentEnabled", v)}
        mb="4"
      />

      <hr className="my-4" />

      <SelectField
        label="Activation Metric"
        value={form.watch("activationMetric")}
        onChange={(v) => form.setValue("activationMetric", v)}
        initialOption="None"
        options={metricsForDatasource.map((m) => ({
          value: m.id,
          label: m.name,
        }))}
        helpText="Only users who convert on this metric will be included in analysis."
        disabled={!watchedDatasource}
      />

      {segmentsForDatasource.length > 0 ? (
        <SelectField
          label="Segment"
          value={form.watch("segment")}
          onChange={(v) => form.setValue("segment", v)}
          initialOption="None"
          options={segmentsForDatasource.map((s) => ({
            value: s.id,
            label: s.name,
          }))}
          helpText="Restrict analysis to a specific segment of users."
        />
      ) : null}

      <Field
        label="Query Filter"
        textarea
        minRows={2}
        {...form.register("queryFilter")}
        placeholder="Optional SQL WHERE clause to filter the bandit assignment query"
        helpText="Applied directly to the assignment query."
      />

      <Switch
        label="Skip Partial Data"
        description="Exclude rows that may have incomplete conversion data (e.g. from the end of the experiment window)."
        value={form.watch("skipPartialData")}
        onChange={(v) => form.setValue("skipPartialData", v)}
        mb="2"
      />
    </ModalStandard>
  );
}
