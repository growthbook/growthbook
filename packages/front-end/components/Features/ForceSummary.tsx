import { ReactNode } from "react";
import { FeatureInterface } from "shared/types/feature";
import { getConfigBackingKey, getFeatureBaseConfigKey } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Text from "@/ui/Text";
import ValueDisplay from "./ValueDisplay";
import { ActionsOverlay } from "./CornerActions";
import ConfigBackedSummary from "./ConfigBackedSummary";

export default function ForceSummary({
  value,
  feature,
  maxHeight,
  sparse = false,
  isDefault = false,
  environment,
  label = "SERVE",
  lineHeight,
  actionsOverlay,
  monochrome,
  fullWidth = false,
  extraActions,
}: {
  value: string;
  feature: FeatureInterface;
  maxHeight?: number;
  sparse?: boolean;
  // null for surfaces that already label the value.
  label?: string | null;
  // Denser type for a cramped surface; the default is ValueDisplay's own.
  lineHeight?: number;
  actionsOverlay?: ActionsOverlay;
  // A config-backed default is a pure config, so it never counts overrides.
  isDefault?: boolean;
  // Environment this value is shown for, so a config-backed value previews its
  // matching env flavor. Absent (e.g. all-environments view) = the base value.
  environment?: string;
  monochrome?: boolean;
  // Spans its container, so the copy and fullscreen buttons sit at its edge
  // rather than just past a short value.
  fullWidth?: boolean;
  // More buttons beside the value's copy and fullscreen.
  extraActions?: ReactNode;
}) {
  // Mirror the SDK compiler: a value resolves a config ONLY when the feature is
  // config-backed (baseConfig set). A stray `@config:` hand-typed into a plain
  // flag's value is stripped at serve time, so it must not be previewed as backed.
  const baseConfigKey = getFeatureBaseConfigKey(feature);
  const configKey =
    baseConfigKey !== null
      ? (getConfigBackingKey(value) ?? baseConfigKey)
      : null;
  if (configKey !== null) {
    return (
      <ConfigBackedSummary
        value={value}
        configKey={configKey}
        feature={feature}
        maxHeight={maxHeight}
        sparse={sparse}
        isDefault={isDefault}
        environment={environment}
        label={label}
        lineHeight={lineHeight}
        actionsOverlay={actionsOverlay}
      />
    );
  }

  return (
    <>
      <Flex direction="row" gap="2" width={fullWidth ? "100%" : undefined}>
        {label !== null && <Text weight="medium">{label}</Text>}
        <Box width="100%">
          <ValueDisplay
            value={value}
            type={feature.valueType}
            showFullscreenButton={true}
            sparse={sparse}
            defaultValue={feature.defaultValue}
            lineHeight={lineHeight}
            monochrome={monochrome}
            actionsOverlay={actionsOverlay}
            extraActions={extraActions}
            fullStyle={{
              maxHeight: maxHeight ?? 150,
              overflowY: "auto",
              maxWidth: "100%",
            }}
          />
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
