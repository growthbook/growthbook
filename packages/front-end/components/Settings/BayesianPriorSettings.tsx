import { useFormContext } from "react-hook-form";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function BayesianPriorSettings({
  defaultMean,
  defaultStdDev,
}: {
  defaultMean?: number;
  defaultStdDev?: number;
}) {
  const form = useFormContext();
  return (
    <div className="form-group mb-0 mr-2">
      <div className={"d-flex"}>
        <label className="mr-1" htmlFor="toggle-properPrior">
          Use informative prior
        </label>
        <Toggle
          id={"toggle-properPrior"}
          value={form.watch("properPrior")}
          setValue={(value) => {
            form.setValue("properPrior", value);
          }}
          disabled={hasFileConfig()}
        />
      </div>
      {form.watch("properPrior") ? (
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
                {...form.register("properPriorMean", {
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
                {...form.register("properPriorStdDev", {
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
              {`Your prior beliefs are that the average lift is ${percentFormatter.format(
                form.watch("properPriorMean")
              )}, and that ~68% of experiment lifts lie between ${percentFormatter.format(
                -1 * form.watch("properPriorStdDev") +
                  form.watch("properPriorMean")
              )} and ${percentFormatter.format(
                form.watch("properPriorStdDev") + form.watch("properPriorMean")
              )}`}
            </small>
          </div>
        </>
      ) : null}
    </div>
  );
}
