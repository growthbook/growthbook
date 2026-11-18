import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { usingSSO } from "@/services/env";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

export default function RequireMfaToggle({ mutate }: { mutate: () => void }) {
  const { organization, hasCommercialFeature } = useUser();
  const enabled = !!organization?.requireMFA;
  // Still allowed to turn it off after a downgrade
  const canEnable = hasCommercialFeature("require-mfa");
  const { apiCall } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <Box px="4" py="3">
      <Flex gap="1">
        <Switch
          id="requireMFA"
          value={enabled}
          disabled={saving || (!enabled && !canEnable)}
          label={
            <PremiumTooltip commercialFeature="require-mfa">
              Require multi-factor authentication (MFA)
            </PremiumTooltip>
          }
          onChange={async (on) => {
            setError("");
            setSaving(true);
            try {
              await apiCall(`/organization/require-mfa`, {
                method: "PUT",
                body: JSON.stringify({ requireMFA: on }),
              });
              mutate();
            } catch (e) {
              setError(e.message);
            }
            setSaving(false);
          }}
        />
        <Tooltip
          body={
            usingSSO()
              ? "Members must sign in through an identity provider that reports MFA. Others are blocked until they sign in again with MFA."
              : "Members must log in with a code from an authenticator app. Others are asked to set up MFA before they can continue."
          }
        />
      </Flex>
      {error && (
        <Callout status="error" size="sm" mt="3">
          {error}
        </Callout>
      )}
    </Box>
  );
}
