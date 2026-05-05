import { DEFAULT_CONFIDENCE_LEVEL } from "shared/constants";
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
          form={form}
          name="confidenceLevel"
          value={confidenceLevel}
          defaultValue={Math.round(DEFAULT_CONFIDENCE_LEVEL * 100)}
          disabled={hasFileConfig()}
          helpTextAppend={
            <span className="ml-2">
              ({Math.round(DEFAULT_CONFIDENCE_LEVEL * 100)}% is default)
            </span>
          }
          rules={{ valueAsNumber: true }}
        />
      </div>

      <BayesianPriorSettings />
    </>
  );
}
