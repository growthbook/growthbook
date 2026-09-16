import { NEW_ORG_DEFAULT_CONFIDENCE_LEVEL } from "shared/constants";
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
  // Round to one decimal so values like 0.975 display as 97.5 (not 98).
  const defaultConfidencePct =
    Math.round(NEW_ORG_DEFAULT_CONFIDENCE_LEVEL * 1000) / 10;
  return (
    <>
      <h4 className="mb-4 text-purple">Bayesian Settings</h4>

      <div className="form-group mb-2 mr-2 form-inline">
        <ChanceToWinThresholdField
          form={form}
          name="confidenceLevel"
          value={confidenceLevel}
          defaultValue={defaultConfidencePct}
          disabled={hasFileConfig()}
          helpTextAppend={
            <span className="ml-2">Default is {defaultConfidencePct}%.</span>
          }
          rules={{ valueAsNumber: true }}
        />
      </div>

      <BayesianPriorSettings />
    </>
  );
}
