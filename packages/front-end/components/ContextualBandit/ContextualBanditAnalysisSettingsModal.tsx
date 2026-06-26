import { Fragment, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";

type FormValues = {
  datasource: string;
  contextualBanditQueryId: string;
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
  const { datasources, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();

  const form = useForm<FormValues>({
    defaultValues: {
      datasource: cb.datasource ?? "",
      contextualBanditQueryId: cb.contextualBanditQueryId ?? "",
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
    </ModalStandard>
  );
}
