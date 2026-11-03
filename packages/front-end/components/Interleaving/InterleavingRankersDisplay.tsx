import { Box, Flex, Grid } from "@radix-ui/themes";
import type { ApiInterleavingInterface } from "shared/validators";
import Code from "@/components/SyntaxHighlighting/Code";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { getRankerConfigError } from "./InterleavingVariationsInput";
import RankerCard, { RANKERS } from "./RankerCard";

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
          <RankerCard
            key={role}
            index={i}
            name={ranker.name || ranker.key || label}
          >
            <Flex direction="column" gap="2">
              <Text size="sm">
                <code>ID: {ranker.key}</code>
              </Text>
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
          </RankerCard>
        );
      })}
    </Grid>
  );
}
