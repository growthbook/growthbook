import { useFormContext } from "react-hook-form";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MetricDefaults } from "back-end/types/organization";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

interface FormValues {
  metricDefaults: MetricDefaults;
}

export default function BayesianPriorSettings({
  defaultMean,
  defaultStdDev,
  labelText,
}: {
  defaultMean?: number;
  defaultStdDev?: number;
  labelText?: string;
}) {
  const form = useFormContext<FormValues>();
  return (
    <div className="form-group mb-0 mr-2">
      <label>
        先验{" "}
        <small className="text-muted">
          {labelText ? labelText : "(可能会被指标覆盖)"}
        </small>
      </label>
      <div className="appbox py-2 px-3">
        <div className="w-100 mt-2">
          <div className="d-flex">
            <label className="mr-2" htmlFor="toggle-properPrior">
              使用合适先验
            </label>
            <Toggle
              id={"toggle-properPrior"}
              value={form.watch("metricDefaults.priorSettings.proper")}
              setValue={(value) => {
                form.setValue("metricDefaults.priorSettings.proper", value);
              }}
              disabled={hasFileConfig()}
            />
          </div>
          {form.watch("metricDefaults.priorSettings.proper") ? (
            <>
              <div className="row">
                <div className="col">
                  <Field
                    label="先验均值"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    disabled={hasFileConfig()}
                    required
                    helpText={`默认值：${defaultMean ?? 0}`}
                    {...form.register("metricDefaults.priorSettings.mean", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="col">
                  <Field
                    label="先验标准差"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    min="0"
                    required
                    helpText={`默认值：${defaultStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV
                      }`}
                    disabled={hasFileConfig()}
                    {...form.register("metricDefaults.priorSettings.stddev", {
                      valueAsNumber: true,
                      validate: (v) => {
                        return !(v <= 0);
                      },
                    })}
                  />
                </div>
              </div>
              <div>
                <small className="text-muted mt-1">
                  {`您的先验分布指定平均提升为${percentFormatter.format(
                    form.watch("metricDefaults.priorSettings.mean")
                  )}, 并且大约68%的实验提升介于${percentFormatter.format(
                    -1 * form.watch("metricDefaults.priorSettings.stddev") +
                    form.watch("metricDefaults.priorSettings.mean")
                  )} 和 ${percentFormatter.format(
                    form.watch("metricDefaults.priorSettings.stddev") +
                    form.watch("metricDefaults.priorSettings.mean")
                  )}之间`}
                </small>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
