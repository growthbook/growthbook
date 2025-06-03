import React, { useMemo } from "react";
import { DashboardSettings } from "back-end/src/enterprise/validators/dashboard-instance";
import { Flex } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";

interface Props {
  isEditing: boolean;
  settings: DashboardSettings;
  updateSettings: (newSettings: DashboardSettings) => void;
}
export default function DashboardSettingsHeader({
  isEditing,
  settings,
  updateSettings,
}: Props) {
  const { metrics, factMetrics, dimensions } = useDefinitions();
  const factMetricOptions = useMemo(
    () => factMetrics.map(({ id, name }) => ({ label: name, value: id })),
    [factMetrics]
  );
  const legacyMetricOptions = useMemo(
    () => metrics.map(({ id, name }) => ({ label: name, value: id })),
    [metrics]
  );
  const dimensionOptions = useMemo(
    () => dimensions.map(({ id, name }) => ({ label: name, value: id })),
    [dimensions]
  );

  return (
    <Flex align="center" gap="1">
      <SelectField
        disabled={!isEditing}
        label="Default Metric"
        value={settings.defaultMetricId}
        options={[
          { label: "Fact Metrics", options: factMetricOptions },
          { label: "Legacy Metrics", options: legacyMetricOptions },
        ]}
        onChange={(mid) =>
          updateSettings({ ...settings, defaultMetricId: mid })
        }
      />
      <SelectField
        disabled={!isEditing}
        label="Default Dimension"
        value={settings.defaultDimensionId}
        options={dimensionOptions}
        onChange={(did) =>
          updateSettings({ ...settings, defaultDimensionId: did })
        }
      />
    </Flex>
  );
}
