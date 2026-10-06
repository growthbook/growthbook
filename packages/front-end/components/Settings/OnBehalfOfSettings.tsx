import { FC, useState } from "react";
import Heading from "@/ui/Heading";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { hasFileConfig } from "@/services/env";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";

// Org-wide default for the per-key "Require X-On-Behalf-Of" setting. Only new
// org API keys pick it up; existing keys keep their own value.
const OnBehalfOfSettings: FC = () => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization } = useUser();
  const canManageOrgSettings = usePermissionsUtil().canManageOrgSettings();
  const [error, setError] = useState<string | null>(null);
  const requireByDefault = !!settings?.apiKeysRequireOnBehalfOf;
  const save = async (apiKeysRequireOnBehalfOf: boolean) => {
    setError(null);
    try {
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({ settings: { apiKeysRequireOnBehalfOf } }),
      });
      await refreshOrganization();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="3">
        X-On-Behalf-Of
      </Heading>
      <Checkbox
        label="New API keys require X-On-Behalf-Of"
        description="Requests made with an organization API key can name the member they act for in an X-On-Behalf-Of header. When required, the key rejects requests that leave it out. This only sets the default for new keys."
        value={requireByDefault}
        disabled={!canManageOrgSettings || hasFileConfig()}
        disabledMessage={
          hasFileConfig()
            ? "Organization settings are managed by your config.yml file"
            : "Only admins can change this setting"
        }
        setValue={(value) => {
          void save(value);
        }}
      />
      {error && (
        <HelperText status="error" mt="2">
          {error}
        </HelperText>
      )}
    </Frame>
  );
};

export default OnBehalfOfSettings;
