import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { SlackAccountLink } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
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
          Slack accounts linked to {email} in {organization.name}. Use the
          organization menu to manage links in another organization.
        </Text>
        <Callout status="info">
          To link or replace an account, send &quot;link account&quot; to
          GrowthBook in Slack. Open the private link and confirm the GrowthBook
          account and organization.
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
            <Flex
              key={`${link.slackTeamId}:${link.slackUserId}`}
              justify="between"
              align="center"
              gap="4"
              p="4"
              style={{ border: "1px solid var(--slate-a5)", borderRadius: 8 }}
            >
              <Box>
                <Text as="p" weight="semibold">
                  {link.teamName}
                </Text>
                <Text as="p" size="sm" color="text-mid">
                  Slack user {link.slackUserId}
                </Text>
              </Box>
              <Button
                variant="outline"
                onClick={() => {
                  if (orgId) setDisconnecting({ link, organizationId: orgId });
                }}
              >
                Disconnect
              </Button>
            </Flex>
          ))
        )}
      </Flex>
      {disconnecting && disconnecting.organizationId === orgId && (
        <ConfirmDialog
          title="Disconnect your Slack account?"
          content={`This removes your link in ${organization.name}. Approvals from this link will no longer work. Your other organization links stay connected.`}
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
