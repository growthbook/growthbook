import { useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import PercentField from "@/components/Forms/PercentField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";
import {
  config,
  isValidPowerCalculationParams,
  ensureAndReturnPowerCalculationParams,
  MetricParams,
  FullModalPowerCalculationParams,
  PartialPowerCalculationParams,
} from "./types";

export type Props = {
  close?: () => void;
  onSuccess: (_: FullModalPowerCalculationParams) => void;
  params: PartialPowerCalculationParams;
};

type Form = UseFormReturn<PartialPowerCalculationParams>;

const SelectStep = ({
  form,
  close,
  onNext,
}: {
  form: Form;
  close?: () => void;
  onNext: () => void;
}) => {
  const { metrics: appMetrics } = useDefinitions();
  const usersPerWeek = form.watch("usersPerWeek");
  const metrics = form.watch("metrics");

  const selectedMetrics = Object.keys(metrics);

  const isUsersPerDayInvalid = usersPerWeek !== undefined && usersPerWeek <= 0;
  const isNextDisabled =
    !selectedMetrics.length ||
    usersPerWeek === undefined ||
    isNaN(usersPerWeek) ||
    isUsersPerDayInvalid;

  const field = (key: keyof typeof config) => ({
    [key]: config[key].defaultValue,
  });

  return (
    <Modal
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
            <span className="mr-auto font-weight-bold">Select Metrics</span>{" "}
            Limit 5
          </>
        }
        sort={false}
        value={selectedMetrics}
        options={appMetrics.map(({ name: label, id: value }) => ({
          label,
          value,
        }))}
        disabled={5 <= selectedMetrics.length}
        onChange={(value: string[]) => {
          form.setValue(
            "metrics",
            value.reduce((result, id) => {
              const metric = ensureAndReturn(
                appMetrics.find((m) => m.id === id),
              );

              return {
                ...result,
                [id]: metrics[id] || {
                  name: metric.name,
                  ...field("effectSize"),
                  ...(metric.type === "binomial"
                    ? { type: "binomial", ...field("conversionRate") }
                    : {
                        type: "mean",
                        ...field("mean"),
                        ...field("standardDeviation"),
                        standardDeviation: undefined,
                      }),
                },
              };
            }, {}),
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
              body="Total users accross all variations"
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

const InputField = ({
  entry,
  form,
  metricId,
}: {
  entry: keyof typeof config;
  form: Form;
  metricId: string;
}) => {
  const metrics = form.watch("metrics");
  const params = ensureAndReturn(metrics[metricId]);
  const entryValue = params[entry];
  const { title, isPercent, tooltip, maxValue, minValue } = config[entry];

  const isKeyInvalid = (() => {
    if (entryValue === undefined) return false;
    if (minValue !== undefined && entryValue <= minValue) return true;
    if (maxValue !== undefined && maxValue < entryValue) return true;
    return false;
  })();

  const helpText = (() => {
    const min = isPercent && minValue ? minValue * 100 : minValue;
    const max = isPercent && maxValue ? maxValue * 100 : maxValue;

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
    min: minValue,
    max: maxValue,
    className: clsx("w-50", isKeyInvalid && "border border-danger"),
    helpText: isKeyInvalid ? (
      <div className="text-danger">{helpText}</div>
    ) : undefined,
  };

  return (
    <div className="col">
      {isPercent ? (
        <PercentField
          {...commonOptions}
          value={entryValue}
          onChange={(v) => form.setValue(`metrics.${metricId}.${entry}`, v)}
        />
      ) : (
        <Field
          {...commonOptions}
          {...form.register(`metrics.${metricId}.${entry}`, {
            valueAsNumber: true,
          })}
        />
      )}
    </div>
  );
};

const MetricParamsInput = ({
  form,
  metricId,
}: {
  form: Form;
  metricId: string;
}) => {
  const metrics = form.watch("metrics");
  // eslint-disable-next-line
  const { name, type: _type, ...params } = ensureAndReturn(metrics[metricId]);

  return (
    <div className="card gsbox mb-3 p-3 mb-2 power-analysis-params">
      <div className="card-title uppercase-title mb-3">{name}</div>
      <div className="row">
        {Object.keys(params).map(
          (entry: keyof Omit<MetricParams, "name" | "type">) => (
            <InputField
              key={`${name}-${entry}`}
              entry={entry}
              form={form}
              metricId={metricId}
            />
          ),
        )}
      </div>
    </div>
  );
};

const SetParamsStep = ({
  form,
  close,
  onBack,
  onSubmit,
}: {
  form: Form;
  close?: () => void;
  onBack: () => void;
  onSubmit: (_: FullModalPowerCalculationParams) => void;
}) => {
  const metrics = form.watch("metrics");
  const metricIds = Object.keys(metrics);

  return (
    <Modal
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
          disabled={!isValidPowerCalculationParams(form.getValues())}
          className="btn btn-primary"
          onClick={() =>
            onSubmit(ensureAndReturnPowerCalculationParams(form.getValues()))
          }
        >
          Submit
        </button>
      }
    >
      <div className="ml-2">
        <p>Customize metric details for calculating experiment duration.</p>

        {metricIds.map((metricId) => (
          <MetricParamsInput key={metricId} metricId={metricId} form={form} />
        ))}
      </div>
    </Modal>
  );
};

export default function PowerCalculationModal({
  close,
  onSuccess,
  params,
}: Props) {
  const [step, setStep] = useState<"select" | "set-params">("select");

  const form = useForm<PartialPowerCalculationParams>({
    defaultValues: params,
  });

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
          onBack={() => setStep("select")}
          onSubmit={onSuccess}
        />
      )}
    </>
  );
}
