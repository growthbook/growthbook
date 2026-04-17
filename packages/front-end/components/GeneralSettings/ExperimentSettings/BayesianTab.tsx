import { hasFileConfig } from "@/services/env";
import BayesianPriorSettings from "@/components/Settings/BayesianPriorSettings";
import { StatsEngineSettingsForm } from "./StatsEngineSettings";
import ChanceToWinThresholdField from "./ChanceToWinThresholdField";

export default function BayesianTab({
  form,
}: {
  form: StatsEngineSettingsForm;
}) {
  const confidenceLevel = form.watch("confidenceLevel");
  return (
    <>
      <h4 className="mb-4 text-purple">Bayesian Settings</h4>

      <div className="form-group mb-2 mr-2 form-inline">
        <ChanceToWinThresholdField
          value={confidenceLevel}
          min={70}
          max={99}
          disabled={hasFileConfig()}
          helpTextAppend={<span className="ml-2">(95% is default)</span>}
          registerProps={form.register("confidenceLevel", {
            valueAsNumber: true,
            min: 50,
            max: 100,
          })}
        />
      </div>

      <BayesianPriorSettings />
    </>
  );
}
