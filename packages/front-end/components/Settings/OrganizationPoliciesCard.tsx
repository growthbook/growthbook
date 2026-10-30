import { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { hasFileConfig } from "@/services/env";
import HelperText from "@/ui/HelperText";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import ApiKeyExpirationPolicy, {
  ExpirationPolicyField,
  Kind,
  parseLifetimeDraft,
  settingField,
} from "./ApiKeyExpirationPolicy";

const OrganizationPoliciesCard: FC<{
  kind: Kind;
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ kind, keys, mutate }) => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  const canDisable = kind === "pat" && canManageOrgSettings;
  // Anyone who can see these keys sees the policy; changing it is an org
  // setting, which is what saving it checks.
  const canSeeExpiry =
    kind === "pat"
      ? permissionsUtil.canManagePersonalAccessTokens()
      : permissionsUtil.canViewApiKeys();
  const canExpire = canSeeExpiry && canManageOrgSettings;
  const locked = hasFileConfig();

  const wasDisabled = !!settings?.disablePersonalAccessTokens;
  const saved = settings?.[settingField(kind)] ?? null;
  const [editing, setEditing] = useState(false);
  const [disable, setDisable] = useState(wasDisabled);
  const [lifetime, setLifetime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const { value: maxDays, invalid } = parseLifetimeDraft(lifetime);

  const startEditing = () => {
    setDisable(wasDisabled);
    setLifetime(saved === null ? null : String(saved));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const changed = disable !== wasDisabled || maxDays !== saved;
    if (changed) {
      // Only what this member may change, so the other half isn't rewritten.
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            ...(canDisable && { disablePersonalAccessTokens: disable }),
            ...(canExpire && { [settingField(kind)]: maxDays }),
          },
        }),
      });
      await refreshOrganization();
    }
    setEditing(false);
  };

  return (
    <Frame mb="4" py="5" px="5">
      <Flex align="center" justify="between" gap="3" mb="3">
        <Heading as="h3" size="md" mb="0">
          Organization Policies
        </Heading>
        {editing ? (
          <Flex gap="3" align="center">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={invalid}
              setError={setError}
              onClick={async () => {
                if (disable && !wasDisabled) {
                  setConfirmDisable(true);
                  return;
                }
                await save();
              }}
            >
              Save
            </Button>
          </Flex>
        ) : (
          <Tooltip
            content={
              locked
                ? "Organization settings are managed by your config.yml file"
                : "Changing these policies requires permission to manage organization settings"
            }
            enabled={locked || (!canDisable && !canExpire)}
          >
            <span>
              <Button
                variant="ghost"
                disabled={locked || (!canDisable && !canExpire)}
                onClick={startEditing}
              >
                Edit
              </Button>
            </span>
          </Tooltip>
        )}
      </Flex>
      {editing ? (
        <Flex direction="column" gap="4">
          {kind === "pat" && (
            <Box>
              <Checkbox
                label="Disable personal access tokens"
                description="Blocks new personal access tokens and stops existing ones working, including OAuth tokens and the Visual Editor."
                value={disable}
                setValue={setDisable}
                disabled={!canDisable}
                disabledMessage="Only admins can change this setting"
              />
              {disable && !wasDisabled && (
                <Callout status="error" mt="3">
                  Every token that acts as a user stops working as soon as you
                  save: personal access tokens, OAuth access tokens, and the
                  Visual Editor. Turning this back off restores them.
                </Callout>
              )}
            </Box>
          )}
          {canExpire && (
            <Box>
              <ExpirationPolicyField
                kind={kind}
                draft={lifetime}
                setDraft={setLifetime}
              />
            </Box>
          )}
          {error && <HelperText status="error">{error}</HelperText>}
        </Flex>
      ) : (
        <Flex direction="column" gap="1">
          {kind === "pat" && (
            <Metadata
              label="Disable personal access tokens"
              value={wasDisabled ? "On" : "Off"}
            />
          )}
          {canSeeExpiry && (
            <ApiKeyExpirationPolicy kind={kind} keys={keys} mutate={mutate} />
          )}
        </Flex>
      )}
      {confirmDisable && (
        <ConfirmDialog
          title="Disable personal access tokens?"
          content="Every token that acts as a user stops working: personal access tokens, OAuth access tokens, and the Visual Editor. Turning this back off restores them."
          yesText="Disable tokens"
          color="red"
          onConfirm={async () => {
            await save();
            setConfirmDisable(false);
          }}
          onCancel={() => setConfirmDisable(false)}
        />
      )}
    </Frame>
  );
};

export default OrganizationPoliciesCard;
