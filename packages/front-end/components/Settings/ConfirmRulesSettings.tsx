import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ConfirmRule } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import ConfirmRulesField, { withoutEmptyRules } from "./ConfirmRulesField";

// Org-wide rules for person-bound tokens. Written only here, never over REST,
// so an agent can't turn them off.
export default function ConfirmRulesSettings() {
  const { settings, refreshOrganization } = useUser();
  const { apiCall } = useAuth();
  const canEdit = usePermissionsUtil().canManageOrgSettings();
  const [rules, setRules] = useState<ConfirmRule[]>(
    settings?.confirmRules ?? [],
  );

  if (!canEdit) return null;

  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="2">
        Agent Confirmations
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Personal access tokens and OAuth apps, like the MCP server, can&apos;t
        complete these actions until their person confirms them in GrowthBook.
        With no rules, nothing is held.
      </Text>
      <ConfirmRulesField value={rules} setValue={setRules} />
      <Flex justify="end" mt="3">
        <Button
          onClick={async () => {
            await apiCall("/organization", {
              method: "PUT",
              body: JSON.stringify({
                settings: { confirmRules: withoutEmptyRules(rules) },
              }),
            });
            await refreshOrganization();
          }}
        >
          Save
        </Button>
      </Flex>
    </Frame>
  );
}
