import { Box, Flex, Grid } from "@radix-ui/themes";
import type { ApiInterleavingInterface } from "shared/validators";
import Code from "@/components/SyntaxHighlighting/Code";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { getRankerConfigError } from "./InterleavingVariationsInput";

const RANKERS = [
  { role: "control", label: "Control" },
  { role: "treatment", label: "Treatment" },
] as const;

// Read-only twin of InterleavingVariationsInput, sharing its card shell so the
// overview and the edit modal stay visually continuous.
export default function InterleavingRankersDisplay({
  variations,
  jsonSchema,
}: {
  variations: ApiInterleavingInterface["variations"];
  jsonSchema: ApiInterleavingInterface["jsonSchema"];
}) {
  return (
    <Grid columns={{ initial: "1", md: "2" }} gap="4">
      {RANKERS.map(({ role, label }, i) => {
        const ranker = variations[role];
        const configError = getRankerConfigError(ranker.config, jsonSchema);
        return (
          <Box
            key={role}
            p="5"
            pb="3"
            className="appbox mb-0 position-relative variation"
          >
            <Box
              className={`variation variation${i} with-variation-color`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                height: "6px",
              }}
            />
            <Box mb="3">
              <VariationLabel
                number={i}
                name={ranker.name || ranker.key || label}
                size="lg"
              />
            </Box>
            <Flex direction="column" gap="2">
              <code className="small">ID: {ranker.key}</code>
              {ranker.description ? (
                <Text>{ranker.description}</Text>
              ) : (
                <Text color="text-disabled">No description</Text>
              )}
              <Box mt="1">
                <Box mb="1">
                  <Text weight="semibold">Config (JSON)</Text>
                </Box>
                <Code
                  language="json"
                  code={ranker.config}
                  expandable
                  collapsedLines={4}
                />
                {configError && (
                  <HelperText status="error" mt="1">
                    {configError}
                  </HelperText>
                )}
              </Box>
            </Flex>
          </Box>
        );
      })}
    </Grid>
  );
}
