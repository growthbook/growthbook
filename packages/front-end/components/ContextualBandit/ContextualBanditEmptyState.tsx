import { Box, Flex } from "@radix-ui/themes";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { docUrl } from "@/components/DocLink";

export type ContextualBanditEmptyStateKind = "no-data-source" | "ready";

const FOOTNOTES: Record<
  ContextualBanditEmptyStateKind,
  MessageDescriptor | null
> = {
  "no-data-source": msg`User still needs to connect a Data Source to gain access to Contextual Bandits.`,
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
  const { i18n } = useLingui();
  const footnote = FOOTNOTES[kind];

  return (
    <Box mt="4">
      <Box p="60px" pb="70px" className="box text-center">
        <Flex direction="column" align="center" gap="8px">
          <Heading
            as="h2"
            size="xl"
            weight="medium"
            color="text-high"
            align="center"
          >
            <Trans>
              Automatically Personalize Experiences with Contextual Bandits
            </Trans>
          </Heading>
          <Text size="lg" color="text-mid" align="center">
            <Trans>
              Drive more traffic to variants that perform best for groups of
              users
            </Trans>
          </Text>

          <Flex justify="center" gap="5" pt="4">
            <LinkButton
              href={docUrl("contextualBandits")}
              external
              variant="outline"
            >
              <Trans>View docs</Trans>
            </LinkButton>

            {kind === "no-data-source" ? (
              <LinkButton href="/datasources">
                <Trans>Connect data source</Trans>
              </LinkButton>
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
                    <Trans>Create Contextual Bandit</Trans>
                  </Button>
                </PremiumTooltip>
              )
            )}
          </Flex>
        </Flex>
      </Box>

      {footnote && (
        <Text as="p" size="sm" color="text-low" mt="3" align="center">
          {i18n._(footnote)}
        </Text>
      )}
    </Box>
  );
}
