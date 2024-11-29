import { useEffect, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import {
  ExperimentMetricInterface,
  isBinomialMetric,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { OrganizationSettings } from "back-end/types/organization";
import { MetricPriorSettings } from "back-end/types/fact-table";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import PercentField from "@/components/Forms/PercentField";
import Toggle from "@/components/Forms/Toggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";
import {
  config,
  isValidPowerCalculationParams,
  ensureAndReturnPowerCalculationParams,
  MetricParams,
  PartialMetricParams,
  FullModalPowerCalculationParams,
  PartialPowerCalculationParams,
  StatsEngineSettings,
} from "./types";

export type Props = {
  close?: () => void;
  onSuccess: (_: FullModalPowerCalculationParams) => void;
  params: PartialPowerCalculationParams;
  statsEngineSettings: StatsEngineSettings;
};

type Form = UseFormReturn<PartialPowerCalculationParams>;

type Config =
  | {
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings
      ) => number | undefined;
      defaultValue?: number;
    }
  | {
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings
      ) => boolean | undefined;
      defaultValue?: boolean;
    };

const defaultValue = (
  { defaultSettingsValue, defaultValue }: Config,
  priorSettings: MetricPriorSettings | undefined,
  settings: OrganizationSettings
) => {
  const settingsDefault = defaultSettingsValue?.(priorSettings, settings);
  if (settingsDefault !== undefined) return settingsDefault;

  return defaultValue;
};

const SelectStep = ({
  form,
  close,
  onNext,
}: {
  form: Form;
  close?: () => void;
  onNext: () => void;
}) => {
  const {
    metrics: appMetrics,
    factMetrics: appFactMetrics,
    getExperimentMetricById,
  } = useDefinitions();

  const settings = useOrgSettings();

  // combine both metrics and remove ratio and quntile metrics
  const allAppMetrics: ExperimentMetricInterface[] = [
    ...appMetrics,
    ...appFactMetrics,
  ].filter((m) => {
    const denominator =
      m.denominator && !isFactMetric(m)
        ? getExperimentMetricById(m.denominator) ?? undefined
        : undefined;
    const isQuantileMetric = quantileMetricType(m) !== "";
    return !isRatioMetric(m, denominator) && !isQuantileMetric;
  });
  const usersPerWeek = form.watch("usersPerWeek");
  const metrics = form.watch("metrics");

  const selectedMetrics = Object.keys(metrics);

  const isUsersPerDayInvalid = usersPerWeek !== undefined && usersPerWeek <= 0;
  const isNextDisabled =
    !selectedMetrics.length ||
    usersPerWeek === undefined ||
    isNaN(usersPerWeek) ||
    isUsersPerDayInvalid;

  const field = (
    key: keyof typeof config,
    metric: ExperimentMetricInterface
  ) => ({
    [key]: defaultValue(config[key], metric.priorSettings, settings),
  });

  return (
    <Modal
      trackingEventModalType=""
      open
      size="lg"
      header="New Calculation"
      close={close}
      includeCloseCta={false}
      cta="Next >"
      secondaryCTA={
        <button
          disabled={isNextDisabled}
          onClick={onNext}
          className="btn btn-primary"
        >
          Next &gt;
        </button>
      }
    >
      <MultiSelectField
        labelClassName="d-flex"
        label={
          <>
            <span className="mr-auto font-weight-bold">
              Select Metrics{" "}
              <Tooltip
                body={"Ratio and quantile metrics cannot be selected."}
              />
            </span>{" "}
            Limit 5
          </>
        }
        sort={false}
        value={selectedMetrics}
        options={allAppMetrics.map(({ name: label, id: value }) => ({
          label,
          value,
        }))}
        isOptionDisabled={() => 5 <= selectedMetrics.length}
        onChange={(value: string[]) => {
          form.setValue(
            "metrics",
            value.reduce((result, id) => {
              const metric = ensureAndReturn(
                allAppMetrics.find((m) => m.id === id)
              );

              return {
                ...result,
                [id]: metrics[id] || {
                  name: metric.name,
                  ...field("effectSize", metric),
                  ...(isBinomialMetric(metric)
                    ? { type: "binomial", ...field("conversionRate", metric) }
                    : {
                        type: "mean",
                        ...field("mean", metric),
                        ...field("standardDeviation", metric),
                        standardDeviation: undefined,
                      }),
                  ...field("overrideMetricLevelSettings", metric),
                  ...field("overrideProper", metric),
                  ...field("overridePriorLiftMean", metric),
                  ...field("overridePriorLiftStandardDeviation", metric),
                  ...field("metricProper", metric),
                  ...field("metricPriorLiftMean", metric),
                  ...field("metricPriorLiftStandardDeviation", metric),
                },
              };
            }, {})
          );
        }}
      />

      <Field
        label={
          <div>
            <span className="font-weight-bold mr-1">
              Estimated Users Per Week
            </span>
            <Tooltip
              popperClassName="text-left"
              body="Total users across all variations"
              tipPosition="right"
            />
          </div>
        }
        type="number"
        {...form.register("usersPerWeek", {
          valueAsNumber: true,
        })}
        className={isUsersPerDayInvalid ? "border border-danger" : undefined}
        helpText={
          isUsersPerDayInvalid ? (
            <div className="text-danger">Must be greater than 0</div>
          ) : undefined
        }
      />
    </Modal>
  );
};

const sortParams = (params: PartialMetricParams): PartialMetricParams => {
  const overridePrior = {
    overrideMetricLevelSettings: params.overrideMetricLevelSettings,
    overrideProper: params.overrideProper,
    overridePriorLiftMean: params.overridePriorLiftMean,
    overridePriorLiftStandardDeviation:
      params.overridePriorLiftStandardDeviation,
    metricProper: params.metricProper,
    metricPriorLiftMean: params.metricPriorLiftMean,
    metricPriorLiftStandardDeviation: params.metricPriorLiftStandardDeviation,
  };

  if (params.type === "binomial")
    return {
      name: params.name,
      type: params.type,
      effectSize: params.effectSize,
      conversionRate: params.conversionRate,
      ...overridePrior,
    };

  return {
    name: params.name,
    type: params.type,
    effectSize: params.effectSize,
    mean: params.mean,
    standardDeviation: params.standardDeviation,
    ...overridePrior,
  };
};

const displayedMetricParams = [
  "conversionRate",
  "mean",
  "standardDeviation",
  "effectSize",
] as const;

const displayedBayesianParams = [
  "overridePriorLiftMean",
  "overridePriorLiftStandardDeviation",
  "overrideProper",
] as const;

const InputField = ({
  entry,
  form,
  metricId,
  disabled = false,
  className = "",
}: {
  entry: keyof typeof config;
  form: Form;
  metricId: string;
  disabled?: boolean;
  className?: string;
}) => {
  const metrics = form.watch("metrics");
  const params = ensureAndReturn(metrics[metricId]);
  const entryValue = isNaN(params[entry]) ? undefined : params[entry];
  const { title, tooltip, ...c } = config[entry];

  const isKeyInvalid = (() => {
    if (entryValue === undefined) return false;
    if (c.type === "boolean") return false;
    if (c.minValue !== undefined && entryValue <= c.minValue) return true;
    if (c.maxValue !== undefined && c.maxValue < entryValue) return true;
    return false;
  })();

  const helpText = (() => {
    if (c.type === "boolean") return;

    const min = c.minValue ? c.minValue * 100 : c.minValue;
    const max = c.maxValue ? c.maxValue * 100 : c.maxValue;

    if (min !== undefined && max !== undefined)
      return `Must be greater than ${min} and less than or equal to ${max}`;
    if (min !== undefined) return `Must be greater than ${min}`;
    if (max !== undefined) return `Must be less than ${max}`;
    return "Must be a number";
  })();

  const commonOptions = {
    label: (
      <>
        <span className="font-weight-bold mr-1">{title}</span>{" "}
        {tooltip && (
          <Tooltip
            popperClassName="text-left"
            body={tooltip}
            tipPosition="right"
          />
        )}
      </>
    ),
    ...(c.type !== "boolean" ? { min: c.minValue, max: c.maxValue } : {}),
    className: clsx("w-50", isKeyInvalid && "border border-danger"),
    helpText: isKeyInvalid ? (
      <div className="text-danger">{helpText}</div>
    ) : undefined,
  };

  return (
    <div className={`col-4 ${className}`}>
      {c.type === "percent" && (
        <PercentField
          {...commonOptions}
          value={entryValue}
          onChange={(v) => form.setValue(`metrics.${metricId}.${entry}`, v)}
          disabled={disabled}
        />
      )}
      {c.type === "number" && (
        <Field
          {...commonOptions}
          {...form.register(`metrics.${metricId}.${entry}`, {
            valueAsNumber: true,
          })}
          disabled={disabled}
        />
      )}
      {c.type === "boolean" && (
        <div className="form-group">
          <div className="row align-items-center mt-4 self-start">
            <div className="col-auto">
              <Toggle
                id={`input-value-${metricId}-${entry}`}
                value={entryValue}
                setValue={(v) => {
                  form.setValue(`metrics.${metricId}.${entry}`, v);
                }}
                disabled={disabled}
              />
            </div>
            <div>{title}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricParamsInput = ({
  form,
  metricId,
  engineType,
}: {
  form: Form;
  metricId: string;
  engineType: "bayesian" | "frequentist";
}) => {
  const metrics = form.watch("metrics");
  // eslint-disable-next-line
  const { name, ...params } = sortParams(ensureAndReturn(metrics[metricId]));

  const isBayesianParamDisabled = (entity) => {
    if (params.overrideProper) return false;

    return [
      "overridePriorLiftMean",
      "overridePriorLiftStandardDeviation",
    ].includes(entity);
  };

  return (
    <div className="card gsbox mb-3 pt-3 pl-3 pr-3 pb-1 mb-2 power-analysis-params">
      <div className="card-title uppercase-title mb-3">{name}</div>
      <div className="row">
        {Object.keys(params)
          .filter((v) =>
            (displayedMetricParams as readonly string[]).includes(v)
          )
          .map((entry: keyof Omit<MetricParams, "name" | "type">) => (
            <InputField
              key={`${name}-${entry}`}
              entry={entry}
              form={form}
              metricId={metricId}
            />
          ))}
      </div>
      {engineType === "bayesian" && (
        <>
          <div className="row align-items-center h-100 mb-2">
            <div className="col-auto">
              <input
                id={`input-value-${metricId}-overrideMetricLevelSettings`}
                type="checkbox"
                checked={params.overrideMetricLevelSettings}
                onChange={() =>
                  form.setValue(
                    `metrics.${metricId}.overrideMetricLevelSettings`,
                    !params.overrideMetricLevelSettings
                  )
                }
              />
            </div>
            <div>Override metric-level settings</div>
          </div>
          <div className="row">
            {params.overrideMetricLevelSettings &&
              Object.keys(params)
                .filter((v) =>
                  (displayedBayesianParams as readonly string[]).includes(v)
                )
                .map((entry: keyof Omit<MetricParams, "name" | "type">) => (
                  <InputField
                    key={`${name}-${entry}`}
                    entry={entry}
                    form={form}
                    metricId={metricId}
                    className={
                      isBayesianParamDisabled(entry) ? "invisible" : "visible"
                    }
                  />
                ))}
          </div>
        </>
      )}
    </div>
  );
};

const SetParamsStep = ({
  form,
  close,
  onBack,
  onSubmit,
  engineType,
}: {
  form: Form;
  close?: () => void;
  onBack: () => void;
  onSubmit: (_: FullModalPowerCalculationParams) => void;
  engineType: "bayesian" | "frequentist";
}) => {
  const metrics = form.watch("metrics");
  const metricIds = Object.keys(metrics);

  return (
    <Modal
      trackingEventModalType=""
      open
      size="lg"
      header="New Calculation"
      close={close}
      includeCloseCta={false}
      cta="Submit"
      secondaryCTA={
        <button className="btn btn-link" onClick={onBack}>
          &lt; Back
        </button>
      }
      tertiaryCTA={
        <button
          disabled={
            !isValidPowerCalculationParams(engineType, form.getValues())
          }
          className="btn btn-primary"
          onClick={() =>
            onSubmit(
              ensureAndReturnPowerCalculationParams(
                engineType,
                form.getValues()
              )
            )
          }
        >
          Submit
        </button>
      }
    >
      <div className="ml-2">
        <p>Customize metric details for calculating experiment duration.</p>

        {metricIds.map((metricId) => (
          <MetricParamsInput
            key={metricId}
            metricId={metricId}
            engineType={engineType}
            form={form}
          />
        ))}
      </div>
    </Modal>
  );
};

export default function PowerCalculationModal({
  close,
  onSuccess,
  statsEngineSettings,
  params,
}: Props) {
  const [step, setStep] = useState<"select" | "set-params">("select");
  const settings = useOrgSettings();

  const form = useForm<PartialPowerCalculationParams>({
    defaultValues: params,
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
    {}
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
              {}
            ),
            ...metrics[id],
          },
        }),
        {}
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {step === "select" && (
        <SelectStep
          form={form}
          close={close}
          onNext={() => setStep("set-params")}
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
