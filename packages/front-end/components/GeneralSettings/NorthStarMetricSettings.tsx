import { useFormContext } from "react-hook-form";
import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function NorthStarMetricSettings() {
  const { watch, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();
  return (
    <>
      <SettingsGroup
        id="north-star"
        title="North Star"
        description="Shown on the home page alongside experiments that use these metrics as goals."
        keywords="north star home page kpi goals"
      >
        <SettingsField name="northStar.metricIds" label="Metrics">
          <MetricsSelector
            selected={watch("northStar.metricIds") ?? []}
            onChange={(metricIds) => setValue("northStar.metricIds", metricIds)}
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
    </>
  );
}
