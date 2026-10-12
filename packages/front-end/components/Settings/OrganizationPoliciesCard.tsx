import { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { hasFileConfig } from "@/services/env";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
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

const PoliciesModal: FC<{
  kind: Kind;
  canDisable: boolean;
  canExpire: boolean;
  close: () => void;
}> = ({ kind, canDisable, canExpire, close }) => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization } = useUser();
  const wasDisabled = !!settings?.disablePersonalAccessTokens;
  const [disable, setDisable] = useState(wasDisabled);
  const saved = settings?.[settingField(kind)] ?? null;
  const [lifetime, setLifetime] = useState<string | null>(
    saved === null ? null : String(saved),
  );
  const { value: maxDays, invalid } = parseLifetimeDraft(lifetime);

  return (
    <ModalStandard
      open
      trackingEventModalType=""
      header="Edit Organization Policies"
      close={close}
      cta="Save"
      ctaEnabled={!invalid}
      submit={async () => {
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
      }}
    >
      {kind === "pat" && (
        <>
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
              Every token that acts as a user stops working as soon as you save:
              personal access tokens, OAuth access tokens, and the Visual
              Editor. Turning this back off restores them.
            </Callout>
          )}
        </>
      )}
      {canExpire && (
        <Flex direction="column" mt={kind === "pat" ? "4" : "0"}>
          <ExpirationPolicyField
            kind={kind}
            draft={lifetime}
            setDraft={setLifetime}
          />
        </Flex>
      )}
    </ModalStandard>
  );
};

/**
 * Read-only summary with an Edit button that opens every control in one modal,
 * the same shape as a Project's access settings.
 */
const OrganizationPoliciesCard: FC<{
  kind: Kind;
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ kind, keys, mutate }) => {
  const { settings } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  const canDisable = kind === "pat" && canManageOrgSettings;
  // Key managers see the policy and can apply it to keys; changing it is also
  // an org setting, which is what saving it checks.
  const canSeeExpiry = permissionsUtil.canDeleteApiKey();
  const canExpire = canSeeExpiry && canManageOrgSettings;
  const [editing, setEditing] = useState(false);
  const locked = hasFileConfig();

  return (
    <Frame mb="4">
      <Flex align="center" justify="between" gap="3" mb="3">
        <Heading as="h3" size="md" mb="0">
          Organization Policies
        </Heading>
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
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          </span>
        </Tooltip>
      </Flex>
      <Flex direction="column" gap="1">
        {kind === "pat" && (
          <Metadata
            label="Disable personal access tokens"
            value={settings?.disablePersonalAccessTokens ? "On" : "Off"}
          />
        )}
        {canSeeExpiry && (
          <ApiKeyExpirationPolicy kind={kind} keys={keys} mutate={mutate} />
        )}
      </Flex>
      {editing && (
        <PoliciesModal
          kind={kind}
          canDisable={canDisable}
          canExpire={canExpire}
          close={() => setEditing(false)}
        />
      )}
    </Frame>
  );
};

export default OrganizationPoliciesCard;
