import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { ConnectSettingsForm } from "@/components/GeneralSettings/ConnectSettingsForm";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function NorthStarMetricSettings() {
  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <SettingsGroup
          id="north-star"
          title="North Star"
          description="Shown on the home page alongside experiments that use these metrics as goals."
          keywords="north star home page kpi goals"
        >
          <SettingsField name="northStar.metricIds" label="Metrics">
            <MetricsSelector
              selected={watch("northStar.metricIds") ?? []}
              onChange={(metricIds) =>
                setValue("northStar.metricIds", metricIds)
              }
              includeFacts={true}
              includeGroups={false}
              excludeQuantiles={true}
              noManual={true}
            />
          </SettingsField>
          <SettingsField
            name="northStar.title"
            htmlFor="settings-northStar-title"
            label="Title"
          >
            <Field
              id="settings-northStar-title"
              size="md"
              containerClassName="mb-0"
              value={watch("northStar.title")}
              onChange={(e) => {
                setValue("northStar.title", e.target.value);
              }}
            />
          </SettingsField>
        </SettingsGroup>
      )}
    </ConnectSettingsForm>
  );
}
