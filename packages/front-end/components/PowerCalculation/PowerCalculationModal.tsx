import { useEffect, useState, ReactNode } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";

export type Props = {
  close?: () => void;
  onSuccess: (calculation: unknown) => Promise<void>;
};

interface MetricParams {
  name: string;
  effectSize?: number;
  mean?: number;
  standardDeviation?: number;
}

interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  effectSize?: number;
  conversionRate?: number;
  usersPerDay?: number;
}

const SelectStep = ({
  form,
  setSecondaryCTA,
  onNext,
}: {
  form: UseFormReturn<PowerCalculationParams>;
  setSecondaryCTA: (_: ReactNode) => void;
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

  useEffect(() =>
    setSecondaryCTA(
      <button
        disabled={isNextDisabled}
        onClick={onNext}
        className="btn btn-primary"
      >
        Next &gt;
      </button>
    )
  );

  return (
    <>
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
            value.reduce(
              (metrics, id) => ({
                ...metrics,
                [id]: metrics[id] || {
                  name: ensureAndReturn(appMetrics.find((m) => m.id === id))
                    .name,
                },
              }),
              metrics
            )
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
    </>
  );
};

const titles = {
  effectSize: "Effect Size",
  mean: "Mean",
  standardDeviation: "Standard Deviation",
} as const;

const InputField = ({
  entry,
  form,
  metricId,
}: {
  entry: keyof typeof titles;
  form: UseFormReturn<PowerCalculationParams>;
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

const MetricParams = ({
  form,
  metricId,
}: {
  form: UseFormReturn<PowerCalculationParams>;
  metricId: string;
}) => {
  const metrics = form.watch("metrics");
  const params = ensureAndReturn(metrics[metricId]);

  console.log("m", metrics);
  console.log("p", params);

  return (
    <div className="card gsbox mb-3 p-3 mb-2 power-analysis-params">
      <div className="card-title uppercase-title mb-3">{params.name}</div>
      <div className="row">
        <InputField entry="effectSize" form={form} metricId={metricId} />
        <InputField entry="mean" form={form} metricId={metricId} />
        <InputField entry="standardDeviation" form={form} metricId={metricId} />
      </div>
    </div>
  );
};

const SetParamsStep = ({
  form,
  setSecondaryCTA,
  onSubmit,
}: {
  form: UseFormReturn<PowerCalculationParams>;
  setSecondaryCTA: (_: ReactNode) => void;
  onSubmit: () => Promise<void>;
}) => {
  useEffect(() =>
    setSecondaryCTA(
      <button className="btn btn-primary" onClick={onSubmit}>
        Submit
      </button>
    )
  );

  const effectSize = form.watch("effectSize");
  const isEffectSizeInvalid = effectSize !== undefined && effectSize <= 0;
  const conversionRate = form.watch("conversionRate");
  const isConversionRateInvalid =
    conversionRate !== undefined && conversionRate <= 0;

  return (
    <div className="ml-2">
      <p>Customize metric details for calculating experiment duration.</p>

      <div className="card gsbox mb-3 p-3 mb-2 power-analysis-params">
        <div className="card-title uppercase-title mb-3">Total Revenue</div>
        <div className="row">
          <div className="col">
            <Field
              label={<span className="font-weight-bold mr-1">Effect Size</span>}
              type="number"
              {...form.register("effectSize", {
                valueAsNumber: true,
              })}
              className={clsx(
                "w-50",
                isEffectSizeInvalid && "border border-danger"
              )}
              helpText={
                isEffectSizeInvalid ? (
                  <div className="text-danger">Must be greater than 0</div>
                ) : undefined
              }
            />
          </div>
          <div className="col">
            <Field
              label={<span className="font-weight-bold mr-1">Effect Size</span>}
              type="number"
              {...form.register("conversionRate", {
                valueAsNumber: true,
              })}
              className={clsx(
                "w-50",
                isConversionRateInvalid && "border border-danger"
              )}
              helpText={
                isConversionRateInvalid ? (
                  <div className="text-danger">Must be greater than 0</div>
                ) : undefined
              }
            />
          </div>
          <div className="col" />
        </div>
      </div>

      {Object.keys(form.watch("metrics")).map((metricId) => (
        <MetricParams key={metricId} metricId={metricId} form={form} />
      ))}
    </div>
  );
};

export default function PowerCalculationModal({ close, onSuccess }: Props) {
  const [step, setStep] = useState<"select" | "set-params">("select");
  const [secondaryCTA, setSecondaryCTA] = useState<ReactNode>(null);

  const form = useForm<PowerCalculationParams>({
    defaultValues: {
      metrics: {},
    },
  });

  return (
    <Modal
      open
      size="lg"
      header="New Calculation"
      close={close}
      includeCloseCta={false}
      cta="Next >"
      secondaryCTA={secondaryCTA}
    >
      {step === "select" && (
        <SelectStep
          form={form}
          setSecondaryCTA={setSecondaryCTA}
          onNext={() => setStep("set-params")}
        />
      )}
      {step === "set-params" && (
        <SetParamsStep
          form={form}
          setSecondaryCTA={setSecondaryCTA}
          onSubmit={onSuccess}
        />
      )}
    </Modal>
  );
}
