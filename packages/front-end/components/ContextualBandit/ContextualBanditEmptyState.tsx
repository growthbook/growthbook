import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { docUrl } from "@/components/DocLink";

export type ContextualBanditEmptyStateKind = "no-data-source" | "ready";

const FOOTNOTES: Record<ContextualBanditEmptyStateKind, string | null> = {
  "no-data-source":
    "User still needs to connect a Data Source to gain access to Contextual Bandits.",
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
            Automatically Personalize Experiences with Contextual Bandits
          </Heading>
          <Text size="large" color="text-mid" align="center">
            Drive more traffic to variants that perform best for groups of users
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
