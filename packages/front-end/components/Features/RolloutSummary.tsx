import { useEffect, useState } from "react";
import { FeatureInterface, RampSchedule } from "shared/types/feature";
import { getCurrentRampCoverage } from "shared/util";
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
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
  rampSchedule,
  rampStartedAt,
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
  rampSchedule?: RampSchedule;
  rampStartedAt?: string;
}) {
  const type = feature.valueType;

  // When a ramp is active, compute expected coverage client-side from
  // wall-clock. Re-evaluate periodically so the bar advances live.
  // This is *expected* progress — actual SDK payload lags by up to one cron
  // tick + cache TTL.
  const [now, setNow] = useState(() => new Date());
  const rampCoverage = getCurrentRampCoverage(rampSchedule, rampStartedAt, now);
  const ramping = rampCoverage !== null;
  const effectiveCoverage = rampCoverage ?? coverage;

  useEffect(() => {
    if (!ramping || rampCoverage === 1) return;
    const id = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(id);
  }, [ramping, rampCoverage]);
  return (
    <Box>
      <Flex direction="row" gap="2" mb="3">
        <Text weight="medium">SAMPLE</Text> by{" "}
        <Badge
          color="gray"
          label={
            <Text style={{ color: "var(--slate-12)" }}>{hashAttribute}</Text>
          }
        />
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
                  width: effectiveCoverage * 100 + "%",
                  top: "0",
                  left: "0",
                  position: "absolute",
                  borderRadius: "10px 0 0 10px",
                  height: "10px",
                  backgroundColor: "var(--accent-9)",
                  transition: ramping ? "width 300ms ease-out" : undefined,
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
                  {percentFormatter.format(effectiveCoverage)}
                </Text>
              }
            />
            of units
            {ramping && (
              <Tooltip
                body="Expected coverage based on the ramp schedule and wall-clock time. Actual SDK payload may lag by up to one cron tick + cache TTL."
                tipMinWidth="240px"
              >
                <Badge
                  color={rampCoverage === 1 ? "green" : "violet"}
                  ml="2"
                  label={rampCoverage === 1 ? "ramp complete" : "ramping"}
                />
              </Tooltip>
            )}
          </Box>
        </Flex>
      </Box>
      <Flex gap="3">
        <Box>
          <Text weight="medium">SERVE</Text>
        </Box>
        <Box flexGrow="1">
          <ValueDisplay value={value} type={type} showFullscreenButton={true} />
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </Box>
  );
}
