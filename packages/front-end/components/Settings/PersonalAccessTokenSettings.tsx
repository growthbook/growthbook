import React, { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { Box } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";
import ApiKeyExpirationPolicy from "./ApiKeyExpirationPolicy";

// Org-wide kill switch for user-minted API tokens. Enabling it blocks creation
// AND rejects existing tokens at authentication, so there is no separate
// "revoke everything" action to run.
const PersonalAccessTokenSettings: FC = () => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  // Same key as the member table, so SWR shares the request and a save refreshes both.
  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>(
    "/keys/personal-access-tokens",
    { shouldRun: () => permissionsUtil.canDeleteApiKey() },
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokensDisabled = !!settings?.disablePersonalAccessTokens;

  // Throws so the confirm dialog can keep itself open and show the failure.
  const save = async (disablePersonalAccessTokens: boolean) => {
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({ settings: { disablePersonalAccessTokens } }),
    });
    await refreshOrganization();
  };

  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="3">
        Organization Policies
      </Heading>
      <Checkbox
        label="Disable personal access tokens"
        description="Blocks new personal access tokens and stops existing ones working — including OAuth tokens and the Visual Editor."
        value={tokensDisabled}
        disabled={!canManageOrgSettings || hasFileConfig()}
        disabledMessage={
          hasFileConfig()
            ? "Organization settings are managed by your config.yml file"
            : "Only admins can change this setting"
        }
        setValue={(value) => {
          if (value) {
            setConfirming(true);
          } else {
            setError(null);
            save(false).catch((e) => setError(e.message));
          }
        }}
      />
      {error && (
        <HelperText status="error" mt="2">
          {error}
        </HelperText>
      )}
      {permissionsUtil.canDeleteApiKey() && (
        <Box mt="4">
          <ApiKeyExpirationPolicy
            kind="pat"
            keys={data?.keys ?? []}
            mutate={mutate}
          />
        </Box>
      )}
      {confirming && (
        <ConfirmDialog
          title="Disable personal access tokens?"
          content="Every token that acts as a user stops working immediately: personal access tokens, OAuth access tokens, and the Visual Editor. Members won't be able to create new ones. Turning this setting back off restores them."
          yesText="Disable tokens"
          color="red"
          onConfirm={async () => {
            await save(true);
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Frame>
  );
};

export default PersonalAccessTokenSettings;
