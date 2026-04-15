import React, { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import track from "@/services/track";
import OptInModal from "@/components/License/OptInModal";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";

interface AIChatGatingScreenProps {
  hasAISuggestions: boolean;
  canManageOrgSettings: boolean;
}

export default function AIChatGatingScreen({
  hasAISuggestions,
  canManageOrgSettings,
}: AIChatGatingScreenProps) {
  const [showOptIn, setShowOptIn] = useState(false);

  useEffect(() => {
    const reason = !hasAISuggestions
      ? "no-feature"
      : canManageOrgSettings
        ? "ai-disabled-admin"
        : "ai-disabled";
    track("AI Chat Gating Screen Viewed", { reason });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Flex style={{ height: "80vh" }} align="center" justify="center">
      {showOptIn && (
        <OptInModal agreement="ai" onClose={() => setShowOptIn(false)} />
      )}
      <Flex align="center" justify="center" direction="column" gap="3" p="6">
        <BsStars size={28} />
        {!hasAISuggestions ? (
          <Text align="center" color="text-mid">
            Your current plan does not include AI Chat.
          </Text>
        ) : canManageOrgSettings ? (
          <>
            <Text align="center" color="text-mid">
              Enable AI for your organization to use AI Chat here and across
              GrowthBook.
            </Text>
            <Flex gap="2" direction="column" pt="4">
              <Button color="violet" onClick={() => setShowOptIn(true)}>
                Enable AI
              </Button>
              <LinkButton href="/settings/#ai" variant="ghost" color="violet">
                Open General Settings
              </LinkButton>
            </Flex>
          </>
        ) : (
          <Text align="center" color="text-mid">
            AI Chat is not enabled for your organization. Ask an org admin to
            enable AI in General Settings.
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
