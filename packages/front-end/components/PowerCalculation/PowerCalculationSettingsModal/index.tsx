import { useEffect, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import {
  config,
  FullModalPowerCalculationParams,
  PartialPowerCalculationParams,
  StatsEngineSettings,
} from "shared/power";
import { MetricPriorSettings } from "shared/types/fact-table";
import { OrganizationSettings } from "shared/types/organization";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import {
  postPopulationData,
  setMetricDataFromExperiment,
  setMetricDataFromPopulationData,
} from "@/components/PowerCalculation/power-calculation-utils";
import { SetParamsStep } from "@/components/PowerCalculation/PowerCalculationSettingsModal/SetParamsStep";
import { SelectStep } from "@/components/PowerCalculation/PowerCalculationSettingsModal/SelectStep";

export type PowerModalPages = "select" | "set-params";

export type Props = {
  close?: () => void;
  onSuccess: (_: FullModalPowerCalculationParams) => void;
  params: PartialPowerCalculationParams;
  statsEngineSettings: StatsEngineSettings;
  startPage: PowerModalPages;
};

export type PowerCalculationForm = UseFormReturn<PartialPowerCalculationParams>;

type Config =
  | {
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings,
      ) => number | undefined;
      defaultValue?: number;
    }
  | {
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings,
      ) => boolean | undefined;
      defaultValue?: boolean;
    };

export const defaultValue = (
  { defaultSettingsValue, defaultValue }: Config,
  priorSettings: MetricPriorSettings | undefined,
  settings: OrganizationSettings,
) => {
  const settingsDefault = defaultSettingsValue?.(priorSettings, settings);
  if (settingsDefault !== undefined) return settingsDefault;

  return defaultValue;
};

export default function PowerCalculationSettingsModal({
  close,
  onSuccess,
  statsEngineSettings,
  params,
  startPage,
}: Props) {
  const settings = useOrgSettings();
  const { project } = useDefinitions();
  const { experiments } = useExperiments(project, false, "standard");
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();

  const [step, setStep] = useState<PowerModalPages>(startPage);

  const form = useForm<PartialPowerCalculationParams>({
    defaultValues: {
      ...params,
      metricValuesData: {
        source: hasCommercialFeature("historical-power")
          ? "factTable"
          : "manual",
        ...params.metricValuesData,
      },
    },
  });

  const metrics = form.watch("metrics");
  const defaultValues = Object.keys(config).reduce(
    (defaultValues, key) =>
      config[key].metricType
        ? {
            ...defaultValues,
            [key]: {
              type: config[key].metricType,
              value: defaultValue(config[key], undefined, settings),
            },
          }
        : defaultValues,
    {},
  );

  useEffect(() => {
    form.setValue(
      "metrics",
      Object.keys(metrics).reduce(
        (m, id) => ({
          ...m,
          [id]: {
            ...Object.keys(defaultValues).reduce(
              (values, key) =>
                metrics[id].type === defaultValues[key].type ||
                defaultValues[key].type === "all"
                  ? { ...values, [key]: defaultValues[key].value }
                  : {},
              {},
            ),
            ...metrics[id],
          },
        }),
        {},
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {step === "select" && (
        <SelectStep
          form={form}
          experiments={experiments}
          close={close}
          onNext={async () => {
            form.setValue("metricValuesData.error", undefined);
            try {
              if (form.watch("metricValuesData.source") === "experiment") {
                const experimentId = form.watch("metricValuesData.sourceId");
                const experiment = experiments.find(
                  (e) => e.id === experimentId,
                );
                // Retrieve experiment snapshot and set data from it before moving
                // to the set params step
                setMetricDataFromExperiment({ form, experiment, apiCall });
              } else if (form.watch("metricValuesData.source") !== "manual") {
                // Kick of segment of fact table power query, or retrieve
                // existing values from cache and proceed to the set params step
                const res = await postPopulationData({ form, apiCall });

                form.setValue(
                  "metricValuesData.populationId",
                  res.populationData?.id,
                );
                // sets it if data already exists, otherwise starts running on next page
                if (res.populationData?.status === "success") {
                  setMetricDataFromPopulationData({
                    populationData: res.populationData,
                    form,
                  });
                }
              }
            } catch (e) {
              form.setValue(
                "metricValuesData.error",
                `Unable to compute metric values: ${e.message}`,
              );
            } finally {
              setStep("set-params");
            }
          }}
        />
      )}
      {step === "set-params" && (
        <SetParamsStep
          form={form}
          close={close}
          engineType={statsEngineSettings.type}
          onBack={() => setStep("select")}
          onSubmit={onSuccess}
        />
      )}
    </>
  );
}
