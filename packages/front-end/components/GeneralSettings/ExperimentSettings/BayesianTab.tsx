import Field from "@/components/Forms/Field";
import { hasFileConfig } from "@/services/env";
import { StatsEngineSettingsForm } from "./StatsEngineSettings";

export default function BayesianTab({
  highlightColor,
  warningMsg,
  form,
}: {
  highlightColor: string;
  warningMsg: string;
  form: StatsEngineSettingsForm;
}) {
  return (
    <>
      <h4 className="mb-4 text-purple">Bayesian Settings</h4>

      <div className="form-group mb-2 mr-2 form-inline">
        <Field
          label="Chance to win threshold"
          type="number"
          step="any"
          min="70"
          max="99"
          style={{
            width: "80px",
            borderColor: highlightColor,
            backgroundColor: highlightColor ? highlightColor + "15" : "",
          }}
          className={`ml-2`}
          containerClassName="mb-3"
          append="%"
          disabled={hasFileConfig()}
          helpText={
            <>
              <span className="ml-2">(95% is default)</span>
              <div
                className="ml-2"
                style={{
                  color: highlightColor,
                  flexBasis: "100%",
                }}
              >
                {warningMsg}
              </div>
            </>
          }
          {...form.register("confidenceLevel", {
            valueAsNumber: true,
            min: 50,
            max: 100,
          })}
        />
      </div>
    </>
  );
}
