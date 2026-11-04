import { FeatureInterface } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { coveragePercentFormatter } from "@/services/utils";
import { AttributeBadge } from "./AttributeBadge";
import { PlainEntityBadge } from "./EntityBadge";
import ForceSummary from "./ForceSummary";

export default function RolloutSummary({
  value,
  coverage,
  feature,
  hashAttribute,
  fallbackAttribute,
  sparse = false,
  environment,
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
  fallbackAttribute?: string;
  monitored?: boolean;
  sparse?: boolean;
  // Environment this value is shown for, so a config-backed value previews its
  // matching env flavor. Absent (all-environments view) = the base value.
  environment?: string;
}) {
  const displayCoverage = coverage;
  return (
    <Box>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SAMPLE</Text> by{" "}
        <AttributeBadge attributeId={hashAttribute} />
        {fallbackAttribute ? (
          <>
            falling back to <AttributeBadge attributeId={fallbackAttribute} />
          </>
        ) : null}
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
          <Flex align="center" gap="2">
            <PlainEntityBadge
              label={coveragePercentFormatter.format(displayCoverage)}
            />
            of units
          </Flex>
        </Flex>
      </Box>
      <ForceSummary
        value={value}
        feature={feature}
        sparse={sparse}
        environment={environment}
      />
    </Box>
  );
}
