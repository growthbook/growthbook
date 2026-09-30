import React, { FC, useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { PiDotsThreeVertical } from "react-icons/pi";
import { date } from "shared/dates";
import { OAuthAccessPolicy } from "shared/types/organization";
import { getOAuthAccessPolicy } from "shared/util";
import { useAuth } from "@/services/auth";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import {
  ClientSecretModal,
  OAuthApp,
  OAuthAppCredentials,
  OAuthAppModal,
} from "@/components/Settings/OAuthAppModal";
import OAuthGrantsTable, {
  OrgOAuthGrant,
} from "@/components/Settings/OAuthGrantsTable";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

type OAuthAppsResponse = { oauthServerEnabled: boolean; apps: OAuthApp[] };

// `confirm` is the warning shown before saving; options without one save immediately.
const POLICY_OPTIONS: {
  value: OAuthAccessPolicy;
  label: string;
  description: string;
  confirm?: string;
}[] = [
  {
    value: "any",
    label: "Any application",
    description:
      "Members can authorize any OAuth application, such as MCP clients.",
  },
  {
    value: "org-apps",
    label: "Only this organization's OAuth apps",
    description:
      "Members can authorize only the apps registered below. Tokens held by other applications stop working.",
    confirm:
      "Tokens held by applications not registered below stop working immediately, including MCP clients. Switching back to Any application restores them.",
  },
  {
    value: "none",
    label: "No applications",
    description:
      "Every OAuth token stops working and members can't authorize new applications.",
    confirm:
      "Every OAuth token stops working immediately, including MCP clients. Members won't be able to authorize new applications. Switching the setting back restores the tokens.",
  },
];

// Org-registered OAuth apps plus the policy for which OAuth clients may act as members.
const OAuthAppsSettings: FC = () => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canManageApps = permissionsUtil.canManageOAuthApps();
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  // Downgraded orgs keep using their apps but can't create or change them.
  const hasFeature = hasCommercialFeature("oauth-apps");
  const planTooltip = hasFeature
    ? undefined
    : "OAuth apps require an Enterprise plan.";
  const policyDisabledReason = hasFileConfig()
    ? "Organization settings are managed by your config.yml file"
    : canManageOrgSettings
      ? undefined
      : "Only admins can change this setting";

  const { data, error, mutate } = useApi<OAuthAppsResponse>("/oauth-apps", {
    shouldRun: () => canManageApps,
  });
  const { data: grantsData, mutate: mutateGrants } = useApi<{
    grants: OrgOAuthGrant[];
  }>("/oauth-apps/grants", { shouldRun: () => canManageApps });
  // App counts and the grants table move together on revoke or delete.
  const refresh = () => {
    mutate();
    mutateGrants();
  };

  const [editing, setEditing] = useState<OAuthApp | "new" | null>(null);
  const [credentials, setCredentials] = useState<OAuthAppCredentials | null>(
    null,
  );
  const [pendingPolicy, setPendingPolicy] = useState<OAuthAccessPolicy | null>(
    null,
  );
  const [policyError, setPolicyError] = useState<string | null>(null);

  if (!canManageApps) return null;

  const policy = getOAuthAccessPolicy(settings);

  const savePolicy = async (oauthAccess: OAuthAccessPolicy) => {
    setPolicyError(null);
    try {
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({ settings: { oauthAccess } }),
      });
      await refreshOrganization();
    } catch (e) {
      setPolicyError(e.message);
    }
  };

  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="2">
        OAuth Apps
      </Heading>
      <Text as="p" color="text-mid" mb="4">
        Register an internal tool, such as your own MCP server, so it can act as
        each member who authorizes it. Its changes are attributed to that member
        and it never holds a personal access token.
      </Text>

      {data && !data.oauthServerEnabled && (
        <Callout status="warning" mb="4">
          The OAuth authorization server is turned off on this GrowthBook
          instance. Set <code>OAUTH_AS_ENABLED=1</code> on the API server before
          members can authorize apps.
        </Callout>
      )}

      <Text as="div" weight="semibold" mb="2">
        Which applications can act as members
      </Text>
      <RadioGroup
        mb="4"
        options={POLICY_OPTIONS.map((o) => ({
          ...o,
          disabled: !!policyDisabledReason,
          disabledReason: policyDisabledReason,
        }))}
        value={policy}
        setValue={(value) => {
          const option = POLICY_OPTIONS.find((o) => o.value === value);
          if (!option || option.value === policy) return;
          if (option.confirm) {
            setPendingPolicy(option.value);
          } else {
            void savePolicy(option.value);
          }
        }}
      />
      {policyError && (
        <HelperText status="error" mb="3">
          {policyError}
        </HelperText>
      )}

      {error && (
        <Callout status="error" mb="3">
          {error.message}
        </Callout>
      )}

      {data && data.apps.length > 0 && (
        <Table mb="3">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Client ID</TableColumnHeader>
              <TableColumnHeader>Redirect URIs</TableColumnHeader>
              <TableColumnHeader>Authorized members</TableColumnHeader>
              <TableColumnHeader>Created</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.apps.map((app) => (
              <TableRow key={app.clientId}>
                <TableCell>
                  {app.clientName}
                  {app.allowDelegation && (
                    <Badge ml="2" variant="soft" label="Delegation" />
                  )}
                </TableCell>
                <TableCell>
                  <ClickToCopy compact>{app.clientId}</ClickToCopy>
                </TableCell>
                <TableCell>
                  {app.redirectUris.map((uri) => (
                    <Text as="div" size="sm" overflowWrap="anywhere" key={uri}>
                      {uri}
                    </Text>
                  ))}
                </TableCell>
                <TableCell>{app.authorizedUsers}</TableCell>
                <TableCell>{date(app.dateCreated)}</TableCell>
                <TableCell>
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                        aria-label="OAuth app actions"
                      >
                        <PiDotsThreeVertical size={18} />
                      </IconButton>
                    }
                    menuPlacement="end"
                    variant="soft"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={!hasFeature}
                        tooltip={planTooltip}
                        onClick={() => setEditing(app)}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!hasFeature}
                        tooltip={planTooltip}
                        confirmation={{
                          submit: async () => {
                            const res = await apiCall<{
                              clientSecret: string;
                            }>(`/oauth-apps/${app.clientId}/secret`, {
                              method: "POST",
                            });
                            setCredentials({
                              clientId: app.clientId,
                              clientSecret: res.clientSecret,
                            });
                          },
                          confirmationTitle: "Rotate client secret",
                          cta: "Rotate",
                          getConfirmationContent: async () =>
                            `The current secret for "${app.clientName}" stops working immediately${app.allowDelegation ? ", and so do tokens it got by acting on behalf of members" : ""}. Members stay authorized, but the app can't get new tokens until it is updated with the new secret.`,
                        }}
                      >
                        Rotate secret
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          submit: async () => {
                            await apiCall(`/oauth-apps/${app.clientId}`, {
                              method: "DELETE",
                            });
                            refresh();
                          },
                          confirmationTitle: "Delete OAuth app",
                          cta: "Delete",
                          getConfirmationContent: async () =>
                            `Deleting "${app.clientName}" immediately signs it out for every member who authorized it (${app.authorizedUsers}). This can't be undone.`,
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data && data.apps.length === 0 && (
        <Text as="p" color="text-mid" mb="3">
          No OAuth apps registered yet.
        </Text>
      )}

      <PremiumTooltip commercialFeature="oauth-apps">
        <Button disabled={!hasFeature} onClick={() => setEditing("new")}>
          New OAuth app
        </Button>
      </PremiumTooltip>

      {grantsData && (
        <OAuthGrantsTable grants={grantsData.grants} onRevoked={refresh} />
      )}

      {editing && (
        <OAuthAppModal
          existing={editing === "new" ? null : editing}
          close={() => setEditing(null)}
          onSaved={(saved) => {
            if (saved) setCredentials(saved);
            mutate();
          }}
        />
      )}
      {credentials && (
        <ClientSecretModal
          {...credentials}
          close={() => setCredentials(null)}
        />
      )}
      {pendingPolicy && (
        <ConfirmDialog
          title="Restrict OAuth access?"
          content={
            POLICY_OPTIONS.find((o) => o.value === pendingPolicy)?.confirm
          }
          yesText="Restrict access"
          onConfirm={async () => {
            await savePolicy(pendingPolicy);
            setPendingPolicy(null);
          }}
          onCancel={() => setPendingPolicy(null)}
        />
      )}
    </Frame>
  );
};

export default OAuthAppsSettings;
