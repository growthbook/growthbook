import { useFormContext } from "react-hook-form";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Box, Separator } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import AddEditContextualBanditQueryModal from "@/components/ContextualBandit/AddEditContextualBanditQueryModal";
import ContextualBanditDecisionMetricSettings from "@/components/ContextualBandit/ContextualBanditDecisionMetricSettings";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import useOrgSettings from "@/hooks/useOrgSettings";
import Tooltip from "@/components/Tooltip/Tooltip";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

export default function ContextualBanditAnalysisFields({
  project,
  disableBanditConversionWindow,
  setDisableBanditConversionWindow,
}: {
  project?: string;
  disableBanditConversionWindow: boolean;
  setDisableBanditConversionWindow: (v: boolean) => void;
}) {
  const form = useFormContext();

  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const exposureQueryId = form.watch("exposureQueryId");

  const {
    contextualBanditQueries: cbQueries,
    mutate: mutateCbQueries,
    loading: cbQueriesLoading,
  } = useContextualBanditQueries(datasource?.id ?? undefined);
  const [cbQueryModalOpen, setCbQueryModalOpen] = useState(false);

  const selectedCbQuery = useMemo(
    () => cbQueries.find((q) => q.id === exposureQueryId),
    [cbQueries, exposureQueryId],
  );

  useEffect(() => {
    if (!cbQueries.length) return;
    if (!cbQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", cbQueries[0]?.id ?? "");
    }
  }, [cbQueries, exposureQueryId, form]);

  const settings = useOrgSettings();

  return (
    <>
      <div className="rounded px-3 pt-3 pb-3 bg-highlight mb-4">
        <SelectField
          label="Data Source"
          labelClassName="font-weight-bold"
          value={form.watch("datasource") ?? ""}
          onChange={(newDatasource) => {
            form.setValue("datasource", newDatasource);
            if (!newDatasource) {
              form.setValue("decisionMetric", "");
              return;
            }
            const decisionMetricId = form.watch("decisionMetric");
            if (
              decisionMetricId &&
              getExperimentMetricById(decisionMetricId)?.datasource !==
                newDatasource
            ) {
              form.setValue("decisionMetric", "");
            }
          }}
          options={datasources.map((d) => {
            const isDefaultDataSource = d.id === settings.defaultDataSource;
            return {
              value: d.id,
              label: `${d.name}${
                d.description ? ` — ${d.description}` : ""
              }${isDefaultDataSource ? " (default)" : ""}`,
            };
          })}
          className="portal-overflow-ellipsis"
        />

        {datasource ? (
          <>
            {cbQueries.length === 0 && !cbQueriesLoading ? (
              <Callout status="warning" mt="3">
                No Contextual Bandit queries exist for this data source yet.{" "}
                <Link
                  href="#"
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    setCbQueryModalOpen(true);
                  }}
                >
                  Add one
                </Link>
                .
              </Callout>
            ) : (
              <SelectField
                label={
                  <>
                    Contextual Bandit Query{" "}
                    <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
                  </>
                }
                labelClassName="font-weight-bold"
                value={form.watch("exposureQueryId") ?? ""}
                onChange={(v) => form.setValue("exposureQueryId", v)}
                required
                options={cbQueries.map((q) => ({
                  label: q.name,
                  value: q.id,
                }))}
                formatOptionLabel={({ label, value }) => {
                  const userIdType = cbQueries.find(
                    (e) => e.id === value,
                  )?.userIdType;
                  return (
                    <>
                      {label}
                      {userIdType ? (
                        <span
                          className="text-muted small float-right position-relative"
                          style={{ top: 3 }}
                        >
                          Identifier Type: <code>{userIdType}</code>
                        </span>
                      ) : null}
                    </>
                  );
                }}
              />
            )}
            {selectedCbQuery ? (
              <Box mt="2">
                <strong className="font-weight-semibold">
                  Targeting Attributes:{" "}
                </strong>
                {(selectedCbQuery.targetingAttributeColumns ?? []).map(
                  (d, i) => (
                    <Fragment key={d}>
                      {i ? ", " : ""}
                      <code>{d}</code>
                    </Fragment>
                  ),
                )}
                {!(selectedCbQuery.targetingAttributeColumns ?? []).length && (
                  <em className="text-muted">none</em>
                )}
              </Box>
            ) : null}
            {cbQueryModalOpen && datasource ? (
              <AddEditContextualBanditQueryModal
                dataSource={datasource}
                mode="add"
                onSave={async (q) => {
                  await mutateCbQueries();
                  form.setValue("exposureQueryId", q.id);
                  setCbQueryModalOpen(false);
                }}
                onCancel={() => setCbQueryModalOpen(false)}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <Box my="4">
        <BanditSettings page="experiment-settings" />
      </Box>

      <Separator my="5" size="4" />

      <ContextualBanditDecisionMetricSettings
        disableBanditConversionWindow={disableBanditConversionWindow}
        setDisableBanditConversionWindow={setDisableBanditConversionWindow}
        project={project}
      />
    </>
  );
}
