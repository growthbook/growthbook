import { FeatureInterface } from "back-end/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/components/Radix/Badge";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function SafeRolloutSummary({
  value,
  coverage,
  feature,
  hashAttribute,
  guardrailMetrics,
  controlValue,
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
  guardrailMetrics: string[];
  controlValue: string;
}) {
  const type = feature.valueType;
  const coveragePercent = (coverage / 2) * 100;
  return (
    <Box>
      <div className="mb-3">
        <strong className="mr-2 font-weight-semibold">SAMPLE</strong> users by{" "}
        <span className="mr-1 border px-2 py-1 bg-light rounded">
          {hashAttribute}
        </span>
      </div>
      <Box className="mb-3">
        <Flex gap="3" align="center">
          <Box>
            <strong className="font-weight-semibold">SAFE ROLLOUT</strong>
          </Box>
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
                  width: (coverage / 2) * 100 + "%",
                  top: "0",
                  left: "0",
                  position: "absolute",
                  borderRadius: "10px 0 0 10px",
                  height: "10px",
                  backgroundColor: "var(--accent-9)",
                }}
              />
              <Box
                className="progress-bar"
                style={{
                  width: (coverage / 2) * 100 + "%",
                  top: "0",
                  left: `calc(${coveragePercent}%)`,
                  position: "absolute",
                  height: "10px",
                  backgroundColor: "var(--accent-7)",
                }}
              />
            </Box>
          </Box>
          <Box>
            <span className="mr-1 border px-2 py-1 bg-light rounded">
              {percentFormatter.format(coverage / 2)}
            </span>{" "}
            of users (+{percentFormatter.format(coverage / 2)} for comparison)
          </Box>
        </Flex>
      </Box>
      <Flex gap="3">
        <Box>
          <strong className="font-weight-semibold">SERVE</strong>
        </Box>
        <Box>
          <ValueDisplay value={value} type={type} />
        </Box>
      </Flex>
      <Flex gap="3" className="mt-3">
        <Box>
          <strong className="font-weight-semibold">COMPARE AGAINST</strong>
        </Box>
        <Box>
          <ValueDisplay value={controlValue} type="boolean" />
        </Box>
      </Flex>
      <Flex gap="3" className="mt-3">
        <Box>
          <strong className="font-weight-semibold">MONITOR</strong>
        </Box>
        <Box>
          <Badge color="gray" label={`${guardrailMetrics.length}`}></Badge>
          <span className="pl-2">metrics</span>
        </Box>
      </Flex>
      <ValidateValue value={value} feature={feature} />
    </Box>
  );
}
