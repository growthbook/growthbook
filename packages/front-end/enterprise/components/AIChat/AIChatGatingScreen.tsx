import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
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
