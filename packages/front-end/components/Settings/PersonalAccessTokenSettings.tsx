import React, { FC, useState } from "react";
import Heading from "@/ui/Heading";
import { useAuth } from "@/services/auth";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";

// Org-wide kill switch for user-minted API tokens. Enabling it blocks creation
// AND rejects existing tokens at authentication, so there is no separate
// "revoke everything" action to run.
const PersonalAccessTokenSettings: FC = () => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization } = useUser();
  const canManageOrgSettings = usePermissionsUtil().canManageOrgSettings();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokensDisabled = !!settings?.disablePersonalAccessTokens;

  const save = async (disablePersonalAccessTokens: boolean) => {
    setError(null);
    try {
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({ settings: { disablePersonalAccessTokens } }),
      });
      await refreshOrganization();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="3">
        Personal Access Tokens
      </Heading>
      <Checkbox
        label="Disable personal access tokens"
        description="Members can't create personal access tokens, and existing tokens stop working immediately. Also blocks OAuth access tokens used by MCP and agent integrations. The Visual Editor is unaffected."
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
            void save(false);
          }
        }}
      />
      {error && (
        <HelperText status="error" mt="2">
          {error}
        </HelperText>
      )}
      {confirming && (
        <ConfirmDialog
          title="Disable personal access tokens?"
          content="Every existing personal access token and OAuth access token in this organization will stop working immediately, and members won't be able to create new ones. Turning this setting back off restores them."
          yesText="Disable tokens"
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
