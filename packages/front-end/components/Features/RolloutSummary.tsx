import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Text } from "@radix-ui/themes";
import ValidateValue from "@/components/Features/ValidateValue";
import Badge from "@/ui/Badge";
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
            <Badge
              color="gray"
              mr="2"
              label={
                <Text style={{ color: "var(--slate-12)" }}>
                  {percentFormatter.format(coverage)}
                </Text>
              }
            />
            of units
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
