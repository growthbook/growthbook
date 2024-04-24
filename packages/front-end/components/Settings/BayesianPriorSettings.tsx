import { useFormContext } from "react-hook-form";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { DEFAULT_INFORMATIVE_PRIOR_STDDEV } from "shared/constants";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function BayesianPriorSettings({defaultMean, defaultStdDev}: {defaultMean?: number, defaultStdDev?: number}) {
    const form = useFormContext();
    return ( <div className="form-group mb-0 mr-2">
              <div className={"d-flex"}>
                <label className="mr-1" htmlFor="toggle-informativePrior">
                  Use informative prior
                </label>
                <Toggle
                  id={"toggle-informativePrior"}
                  value={form.watch("informativePrior")}
                  setValue={(value) => {
                    form.setValue("informativePrior", value);
                  }}
                  disabled={hasFileConfig()}
                />
              </div>
              {form.watch("informativePrior") ? (<>
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
                  {...form.register("informativePriorMean", {
                    valueAsNumber: true,
                    },
                )}
                /></div><div className="col">
                  <Field
                    label="Prior Standard Deviation"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    min="0"
                    required
                    helpText={`Default: ${defaultStdDev ?? DEFAULT_INFORMATIVE_PRIOR_STDDEV}`}
                    disabled={hasFileConfig()}
                    {...form.register("informativePriorStdDev", {
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
                    {`Your prior beliefs are that the average lift is ${percentFormatter.format(form.watch("informativePriorMean"))}, and that ~68% of experiment lifts lie between ${percentFormatter.format(
                        -1 * form.watch("informativePriorStdDev") + form.watch("informativePriorMean")
                      )} and ${percentFormatter.format(
                        form.watch("informativePriorStdDev") + form.watch("informativePriorMean")
                      )}`}
                    </small></div>
              </>) : null}
            </div>
    );
}
