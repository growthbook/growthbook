import { FeatureInterface } from "shared/types/feature";
import { getConfigBackingKey, getFeatureBaseConfigKey } from "shared/util";
// Pre-existing Radix Text usage (weight + a raw `style` color that @/ui/Text
// doesn't model); migrating it is an unrelated cleanup, not part of threading
// the env-flavor prop below.
// eslint-disable-next-line no-restricted-imports
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
import { AttributeBadge } from "./AttributeBadge";
import ConfigBackedSummary from "./ConfigBackedSummary";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function RolloutSummary({
  value,
  coverage,
  feature,
  hashAttribute,
  sparse = false,
  environment,
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
  monitored?: boolean;
  sparse?: boolean;
  // Environment this value is shown for, so a config-backed value previews its
  // matching env flavor. Absent (all-environments view) = the base value.
  environment?: string;
}) {
  const displayCoverage = coverage;
  const type = feature.valueType;
  // A config-backed feature's rule values always serve a config: an explicit ref
  // on this value, else the feature default's config (the base it overrides).
  const configKey =
    getConfigBackingKey(value) ?? getFeatureBaseConfigKey(feature);
  return (
    <Box>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SAMPLE</Text> by{" "}
        <AttributeBadge attributeId={hashAttribute} />
      </Flex>
      <Box className="mb-3">
        <Flex gap="3" align="center">
          <Text weight="medium">ROLLOUT</Text>
          <Box flexGrow="1" style={{ maxWidth: 250 }}>
            <Box
              className="progress d-none d-md-flex"
              style={{
                border: "0",
                backgroundColor: "inherit",
                height: "10px",
                position: "relative",
              }}
            >
              <Box
                style={{
                  border: "1px solid var(--slate-a5)",
                  borderRadius: "10px",
                  backgroundColor: "var(--slate-a3)",
                  height: "10px",
                  width: "100%",
                }}
              ></Box>
              <Box
                className="progress-bar"
                style={{
                  width: displayCoverage * 100 + "%",
                  top: "0",
                  left: "0",
                  position: "absolute",
                  borderRadius: "10px 0 0 10px",
                  height: "10px",
                  backgroundColor: "var(--accent-9)",
                }}
              />
            </Box>
          </Box>
          <Box>
            <Badge
              color="gray"
              mr="2"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {percentFormatter.format(displayCoverage)}
                </Text>
              }
            />
            of units
          </Box>
        </Flex>
      </Box>
      {configKey !== null ? (
        <ConfigBackedSummary
          value={value}
          configKey={configKey}
          feature={feature}
          sparse={sparse}
          environment={environment}
        />
      ) : (
        <>
          <Flex gap="3">
            <Box>
              <Text weight="medium">SERVE</Text>
            </Box>
            <Box flexGrow="1">
              <ValueDisplay
                value={value}
                type={type}
                showFullscreenButton={true}
                sparse={sparse}
                defaultValue={feature.defaultValue}
              />
            </Box>
          </Flex>
          <ValidateValue value={value} feature={feature} />
        </>
      )}
    </Box>
  );
}
