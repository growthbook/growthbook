import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ApiContextualBanditInterface,
  getEffectiveContextualAttributes,
  getEligibleContextualAttributes,
} from "shared/validators";
import { getScopedSettings } from "shared/settings";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAttributeSchema } from "@/services/features";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import ContextualBanditDecisionMetricSettings, {
  conversionWindowFormValuesFromMetricWindow,
  conversionWindowFromScheduleHours,
} from "@/components/ContextualBandit/ContextualBanditDecisionMetricSettings";

type FormValues = {
  datasource: string;
  exposureQueryId: string;
  contextualAttributes: string[];
  decisionMetric: string;
  banditScheduleValue: number;
  banditScheduleUnit: "hours" | "days";
  banditBurnInValue: number;
  banditBurnInUnit: "hours" | "days";
  banditConversionWindowValue?: number;
  banditConversionWindowUnit: "hours" | "days";
};

/**
 * Combined Analysis & Metrics editor — merges the (simplified) analysis settings
 * (data source + Contextual Bandit query + derived contextual attributes) with the
 * decision-metric selector and its conversion window. The decision metric + conversion
 * window reuse the same `ContextualBanditDecisionMetricSettings` component as the
 * creation flow, so editing behaves identically to creating.
 */
export default function ContextualBanditAnalysisMetricsModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();
  const { organization } = useUser();
  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({ organization });

  const [disableBanditConversionWindow, setDisableBanditConversionWindow] =
    useState(false);

  const scheduleHours =
    (cb.scheduleValue ?? 0) * (cb.scheduleUnit === "days" ? 24 : 1);

  const initialConversionWindow = useMemo(() => {
    if (
      (cb.conversionWindowValue ?? null) !== null &&
      (cb.conversionWindowUnit ?? null) !== null
    ) {
      return {
        value: cb.conversionWindowValue as number,
        unit: cb.conversionWindowUnit as "hours" | "days",
      };
    }
    const decisionMetric = cb.decisionMetric
      ? getExperimentMetricById(cb.decisionMetric)
      : null;
    const metricWindow =
      decisionMetric?.windowSettings?.type === "conversion"
        ? decisionMetric.windowSettings
        : null;
    return metricWindow
      ? conversionWindowFormValuesFromMetricWindow(metricWindow)
      : conversionWindowFromScheduleHours(scheduleHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm<FormValues>({
    defaultValues: {
      datasource: cb.datasource ?? "",
      exposureQueryId: cb.contextualBanditQueryId ?? "",
      contextualAttributes: cb.contextualAttributes ?? [],
      decisionMetric: cb.decisionMetric ?? "",
      banditScheduleValue:
        cb.scheduleValue ?? scopedSettings.banditScheduleValue.value,
      banditScheduleUnit:
        cb.scheduleUnit ?? scopedSettings.banditScheduleUnit.value,
      banditBurnInValue:
        cb.burnInValue ?? scopedSettings.banditBurnInValue.value,
      banditBurnInUnit: cb.burnInUnit ?? scopedSettings.banditBurnInUnit.value,
      banditConversionWindowValue: initialConversionWindow.value,
      banditConversionWindowUnit: initialConversionWindow.unit,
    },
  });

  const watchedDatasource = form.watch("datasource");
  const watchedQueryId = form.watch("exposureQueryId");

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

  const isDraft = cb.status === "draft";
  const attributeSchema = useAttributeSchema(false);
  const eligibleAttributes = useMemo(
    () =>
      getEligibleContextualAttributes(
        selectedQuery?.targetingAttributeColumns,
        attributeSchema,
      ),
    [selectedQuery, attributeSchema],
  );
  const watchedContextualAttributes = form.watch("contextualAttributes");
  const selectedContextualAttributes = useMemo(
    () => watchedContextualAttributes ?? [],
    [watchedContextualAttributes],
  );
  const effectiveContextualAttributes = getEffectiveContextualAttributes(
    selectedContextualAttributes,
    selectedQuery?.targetingAttributeColumns,
    attributeSchema,
  );

  useEffect(() => {
    if (!contextualBanditQueries.length) return;
    if (!contextualBanditQueries.find((q) => q.id === watchedQueryId)) {
      form.setValue("exposureQueryId", contextualBanditQueries[0]?.id ?? "");
    }
  }, [contextualBanditQueries, watchedQueryId, form]);

  const seededQueryIdRef = useRef<string | undefined>(
    cb.contextualBanditQueryId,
  );
  useEffect(() => {
    if (!isDraft || !selectedQuery) return;
    if (seededQueryIdRef.current === watchedQueryId) return;
    seededQueryIdRef.current = watchedQueryId;
    form.setValue("contextualAttributes", eligibleAttributes);
  }, [isDraft, selectedQuery, watchedQueryId, eligibleAttributes, form]);

  return (
    <FormProvider {...form}>
      <ModalStandard
        open
        trackingEventModalType="cb-edit-analysis-metrics"
        header="Edit Analysis & Metrics"
        close={close}
        cta="Save"
        size="lg"
        submit={form.handleSubmit(async (data) => {
          const query = contextualBanditQueries.find(
            (q) => q.id === data.exposureQueryId,
          );
          const eligible = getEligibleContextualAttributes(
            query?.targetingAttributeColumns,
            attributeSchema,
          );
          const contextualAttributes = isDraft
            ? data.contextualAttributes.filter((a) => eligible.includes(a))
            : cb.contextualAttributes;
          if (isDraft && contextualAttributes.length === 0) {
            throw new Error(
              "Select at least one contextual attribute for this Contextual Bandit.",
            );
          }
          const queryChanged =
            data.exposureQueryId !== cb.contextualBanditQueryId;
          if (
            !isDraft &&
            queryChanged &&
            !contextualAttributes.some((a) => eligible.includes(a))
          ) {
            throw new Error(
              `The selected query has no attributes in common with this Bandit's contextual attributes (${contextualAttributes.join(
                ", ",
              )}). Choose a query that includes at least one of them.`,
            );
          }

          const includeConversionWindow =
            !disableBanditConversionWindow &&
            !!data.banditConversionWindowValue &&
            !!data.banditConversionWindowUnit;

          await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
            method: "PUT",
            body: JSON.stringify({
              datasource: data.datasource || undefined,
              contextualBanditQueryId: data.exposureQueryId || undefined,
              contextualAttributes,
              decisionMetric: data.decisionMetric || undefined,
              scheduleValue: data.banditScheduleValue,
              scheduleUnit: data.banditScheduleUnit,
              burnInValue: data.banditBurnInValue,
              burnInUnit: data.banditBurnInUnit,
              conversionWindowValue: includeConversionWindow
                ? Number(data.banditConversionWindowValue)
                : null,
              conversionWindowUnit: includeConversionWindow
                ? data.banditConversionWindowUnit
                : null,
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
            form.setValue("decisionMetric", "");
          }}
          options={datasources.map((d) => ({
            value: d.id,
            label:
              d.name +
              (d.id === settings?.defaultDataSource ? " (default)" : ""),
          }))}
          initialOption="None"
          helpText="Only data sources with a Contextual Bandit query can power a Contextual Bandit."
        />

        {contextualBanditQueries.length > 0 ? (
          <SelectField
            label="Contextual Bandit Query"
            value={form.watch("exposureQueryId")}
            onChange={(v) => form.setValue("exposureQueryId", v)}
            required
            options={contextualBanditQueries.map((q) => ({
              value: q.id,
              label: q.name,
            }))}
            helpText="The bandit assignment query for this data source."
          />
        ) : null}

        {selectedQuery ? (
          isDraft ? (
            eligibleAttributes.length > 0 ? (
              <MultiSelectField
                label="Contextual Attributes"
                value={selectedContextualAttributes}
                onChange={(v) => form.setValue("contextualAttributes", v)}
                options={eligibleAttributes.map((a) => ({
                  label: a,
                  value: a,
                }))}
                placeholder="Select contextual attributes…"
                legacyLabelFormatting={false}
                helpText="Attributes this Bandit uses as context. Defaults to all query attributes; select a subset to narrow it."
              />
            ) : (
              <HelperText status="warning">
                The selected query has no targeting attribute columns that are
                still valid organization attributes.
              </HelperText>
            )
          ) : (
            <Box mb="3">
              <Text weight="semibold" size="m">
                Contextual Attributes
              </Text>
              <Box mt="1">
                {effectiveContextualAttributes.length > 0 ? (
                  effectiveContextualAttributes.map((attr, i) => (
                    <Fragment key={attr}>
                      {i > 0 ? ", " : ""}
                      <code>{attr}</code>
                    </Fragment>
                  ))
                ) : (
                  <Text color="text-low">None</Text>
                )}
              </Box>
              <HelperText status="info">
                Contextual attributes can only be changed while the Bandit is a
                draft.
              </HelperText>
            </Box>
          )
        ) : null}

        <hr className="my-4" />

        <Box mb="4">
          <BanditSettings
            page="experiment-settings"
            settings={scopedSettings}
          />
        </Box>

        <hr className="my-4" />

        <ContextualBanditDecisionMetricSettings
          disableBanditConversionWindow={disableBanditConversionWindow}
          setDisableBanditConversionWindow={setDisableBanditConversionWindow}
          project={cb.project}
          autoApplyDefaults={false}
        />
      </ModalStandard>
    </FormProvider>
  );
}
