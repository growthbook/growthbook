import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { SlackAccountLink } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";

export default function SlackAccountPage() {
  const { organization, email } = useUser();
  const { apiCall, orgId } = useAuth();
  const { data, error, mutate } = useApi<{ links: SlackAccountLink[] }>(
    "/integrations/slack/links",
  );
  const [disconnecting, setDisconnecting] = useState<{
    link: SlackAccountLink;
    organizationId: string;
  } | null>(null);
  return (
    <Box p="4" style={{ maxWidth: 800, margin: "0 auto" }}>
      <Flex direction="column" gap="4">
        <Heading as="h1" size="lg">
          My Slack Links
        </Heading>
        <Text as="p">
          Slack accounts linked to this account ({email}) in {organization.name}
          .
        </Text>
        <Callout status="info">
          To link or replace an account, send a new message to the GrowthBook
          bot in Slack.
        </Callout>
        {error ? (
          <Callout status="error">{error.message}</Callout>
        ) : !data ? (
          <LoadingSpinner />
        ) : data.links.length === 0 ? (
          <Text as="p">
            You have no Slack accounts linked in this organization.
          </Text>
        ) : (
          data.links.map((link) => (
            <Frame
              key={`${link.slackTeamId}:${link.slackUserId}`}
              mb="0"
              px="4"
              py="4"
            >
              <Flex justify="between" align="center" gap="4">
                <Box>
                  <Text as="p" weight="semibold">
                    {link.teamName}
                  </Text>
                  <Text as="p" size="sm" color="text-mid">
                    Slack user ID {link.slackUserId}
                  </Text>
                </Box>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (orgId)
                      setDisconnecting({ link, organizationId: orgId });
                  }}
                >
                  Disconnect
                </Button>
              </Flex>
            </Frame>
          ))
        )}
      </Flex>
      {disconnecting && disconnecting.organizationId === orgId && (
        <ConfirmDialog
          title="Disconnect your Slack account?"
          content={`This removes your link in ${organization.name}.`}
          yesText="Disconnect"
          onCancel={() => setDisconnecting(null)}
          onConfirm={async () => {
            const { slackTeamId, slackUserId, linkId } = disconnecting.link;
            await apiCall("/integrations/slack/links", {
              method: "DELETE",
              body: JSON.stringify({ slackTeamId, slackUserId, linkId }),
            });
            setDisconnecting(null);
            await mutate();
          }}
        />
      )}
    </Box>
  );
}
