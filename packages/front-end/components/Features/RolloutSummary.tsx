import { FeatureInterface } from "back-end/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
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
}: {
  value: string;
  coverage: number;
  feature: FeatureInterface;
  hashAttribute: string;
}) {
  const type = feature.valueType;
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
            <strong className="font-weight-semibold">ROLLOUT</strong>
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
                  width: coverage * 100 + "%",
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
            <span className="mr-1 border px-2 py-1 bg-light rounded">
              {percentFormatter.format(coverage)}
            </span>{" "}
            of users
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
      <ValidateValue value={value} feature={feature} />
    </Box>
  );
}
