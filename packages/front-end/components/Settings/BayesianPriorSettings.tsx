import { useFormContext } from "react-hook-form";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MetricDefaults } from "back-end/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";

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
        Priors{" "}
        <small className="text-muted">
          {labelText ? labelText : "(may be overridden by Metric)"}
        </small>
      </label>
      <div className="appbox py-2 px-3">
        <div className="w-100 mt-2">
          <Flex gap="3">
            <Checkbox
              disabled={hasFileConfig()}
              value={form.watch("metricDefaults.priorSettings.proper")}
              setValue={(v) =>
                form.setValue("metricDefaults.priorSettings.proper", v)
              }
            />
            <label className="mr-2" htmlFor="toggle-properPrior">
              Use proper priors
            </label>
          </Flex>
          {form.watch("metricDefaults.priorSettings.proper") ? (
            <>
              <div className="row">
                <div className="col">
                  <Field
                    label="Prior Mean"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    disabled={hasFileConfig()}
                    required
                    helpText={`Default: ${defaultMean ?? 0}`}
                    {...form.register("metricDefaults.priorSettings.mean", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="col">
                  <Field
                    label="Prior Standard Deviation"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    min="0"
                    required
                    helpText={`Default: ${
                      defaultStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV
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
                <Box className="text-muted" mt="3">
                  {`Your prior distribution specifies that the average lift is ${percentFormatter.format(
                    form.watch("metricDefaults.priorSettings.mean"),
                  )}, and that ~68% of experiment lifts lie between ${percentFormatter.format(
                    -1 * form.watch("metricDefaults.priorSettings.stddev") +
                      form.watch("metricDefaults.priorSettings.mean"),
                  )} and ${percentFormatter.format(
                    form.watch("metricDefaults.priorSettings.stddev") +
                      form.watch("metricDefaults.priorSettings.mean"),
                  )}`}
                </Box>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
