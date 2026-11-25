import { Box, Flex, Grid } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { i18n } = useLingui();
  return (
    <Grid columns={{ initial: "1", md: "2" }} gap="4">
      {RANKERS.map(({ role, label }, i) => {
        const ranker = variations[role];
        const configError = getRankerConfigError(ranker.config, jsonSchema);
        const rankerKey = ranker.key;
        return (
          <RankerCard
            key={role}
            index={i}
            name={ranker.name || ranker.key || i18n._(label)}
          >
            <Flex direction="column" gap="2">
              <Text size="sm">
                <code>
                  <Trans>ID: {rankerKey}</Trans>
                </code>
              </Text>
              {ranker.description ? (
                <Text>{ranker.description}</Text>
              ) : (
                <Text color="text-disabled">
                  <Trans>No description</Trans>
                </Text>
              )}
              <Box mt="1">
                <Box mb="1">
                  <Text weight="semibold">
                    <Trans>Config (JSON)</Trans>
                  </Text>
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
