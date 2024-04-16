import { useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";
import {
  isValidPowerCalculationParams,
  ensureAndReturnPowerCalculationParams,
  MetricParams,
  PowerCalculationParams,
  PartialPowerCalculationParams,
} from "./types";

export type Props = {
  close?: () => void;
  onSuccess: (_: PowerCalculationParams) => void;
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
  const usersPerDay = form.watch("usersPerDay");
  const metrics = form.watch("metrics");
  const selectedMetrics = Object.keys(metrics);
  const isUsersPerDayInvalid = usersPerDay !== undefined && usersPerDay <= 0;
  const isNextDisabled =
    !selectedMetrics.length ||
    usersPerDay === undefined ||
    isNaN(usersPerDay) ||
    isUsersPerDayInvalid;

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
            value.reduce((metrics, id) => {
              const metric = ensureAndReturn(
                appMetrics.find((m) => m.id === id)
              );

              return {
                ...metrics,
                [id]: metrics[id] || {
                  name: metric.name,
                  effect: undefined,
                  ...(metric.type === "binomial"
                    ? { type: "binomial", conversionRate: undefined }
                    : {
                        type: "mean",
                        mean: undefined,
                        standardDeviation: undefined,
                      }),
                },
              };
            }, metrics)
          );
        }}
      />

      <Field
        label={
          <div>
            <span className="font-weight-bold mr-1">
              Estimated users per day
            </span>
            <Tooltip
              popperClassName="text-left"
              body="Total users accross all variations"
              tipPosition="right"
            />
          </div>
        }
        type="number"
        {...form.register("usersPerDay", {
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

const titles = {
  effect: "Effect Size",
  mean: "Mean",
  standardDeviation: "Standard Deviation",
  conversionRate: "Conversion Rate",
} as const;

const InputField = ({
  entry,
  form,
  metricId,
}: {
  entry: keyof typeof titles;
  form: Form;
  metricId: string;
}) => {
  const metrics = form.watch("metrics");
  const params = ensureAndReturn(metrics[metricId]);
  const entryValue = params[entry];
  const isKeyInvalid = entryValue !== undefined && entryValue <= 0;

  return (
    <div className="col">
      <Field
        label={<span className="font-weight-bold mr-1">{titles[entry]}</span>}
        type="number"
        {...form.register(`metrics.${metricId}.${entry}`, {
          valueAsNumber: true,
        })}
        className={clsx("w-50", isKeyInvalid && "border border-danger")}
        helpText={
          isKeyInvalid ? (
            <div className="text-danger">Must be greater than 0</div>
          ) : undefined
        }
      />
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
  const { name, type: _type, ...params } = ensureAndReturn(metrics[metricId]);

  return (
    <div className="card gsbox mb-3 p-3 mb-2 power-analysis-params">
      <div className="card-title uppercase-title mb-3">{name}</div>
      <div className="row">
        {Object.keys(params).map(
          (entry: keyof Omit<MetricParams, "name" | "type">) => (
            <InputField
              key={name}
              entry={entry}
              form={form}
              metricId={metricId}
            />
          )
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
  onSubmit: (_: PowerCalculationParams) => void;
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

export default function PowerCalculationModal({ close, onSuccess }: Props) {
  const [step, setStep] = useState<"select" | "set-params">("select");

  const form = useForm<PartialPowerCalculationParams>({
    defaultValues: {
      metrics: {},
    },
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
