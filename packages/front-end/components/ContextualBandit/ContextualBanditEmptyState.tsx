import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { docUrl } from "@/components/DocLink";

export type ContextualBanditEmptyStateKind =
  | "no-data-source"
  | "no-assignment-table"
  | "ready";

const FOOTNOTES: Record<ContextualBanditEmptyStateKind, string | null> = {
  "no-data-source":
    "User still needs to connect a Data Source to gain access to Contextual Bandits.",
  "no-assignment-table":
    "User still needs to create an Experiment Assignment Table with defined attributes to gain access to Contextual Bandits.",
  ready: null,
};

export default function ContextualBanditEmptyState({
  kind,
  canAdd,
  hasContextualBanditFeature,
  onCreate,
}: {
  kind: ContextualBanditEmptyStateKind;
  canAdd: boolean;
  hasContextualBanditFeature: boolean;
  onCreate: () => void;
}) {
  const footnote = FOOTNOTES[kind];

  return (
    <Box mt="4">
      <Box p="60px" pb="70px" className="box text-center">
        <Flex direction="column" align="center" gap="8px">
          <Heading
            as="h2"
            size="x-large"
            weight="medium"
            color="text-high"
            align="center"
          >
            Incorporate Personalization into Experiments with Contextual Bandits
          </Heading>
          <Text size="large" color="text-mid" align="center">
            Automatically guide traffic to better variants based on defined
            attributes
          </Text>

          <Flex justify="center" gap="5" pt="4">
            <LinkButton
              href={docUrl("contextualBandits")}
              external
              variant="outline"
            >
              View docs
            </LinkButton>

            {kind === "no-data-source" ? (
              <LinkButton href="/datasources">Connect data source</LinkButton>
            ) : kind === "no-assignment-table" ? (
              <LinkButton href="/datasources">Define attributes</LinkButton>
            ) : (
              canAdd && (
                <PremiumTooltip
                  tipPosition="left"
                  popperStyle={{ top: 15 }}
                  commercialFeature="contextual-bandits"
                >
                  <Button
                    onClick={onCreate}
                    disabled={!hasContextualBanditFeature}
                  >
                    Create Contextual Bandit
                  </Button>
                </PremiumTooltip>
              )
            )}
          </Flex>
        </Flex>
      </Box>

      {footnote && (
        <Text as="p" size="small" color="text-low" mt="3" align="center">
          {footnote}
        </Text>
      )}
    </Box>
  );
}
