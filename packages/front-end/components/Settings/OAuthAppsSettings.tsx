import React, { FC, useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { date } from "shared/dates";
import { OAuthAccessPolicy } from "shared/types/organization";
import { getOAuthAccessPolicy } from "shared/util";
import { OAuthAppProps } from "shared/validators";
import { useAuth } from "@/services/auth";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import OAuthGrantsTable, {
  OrgOAuthGrant,
} from "@/components/Settings/OAuthGrantsTable";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioGroup from "@/ui/RadioGroup";
import StringArrayField from "@/ui/StringArrayField";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
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

type OAuthApp = OAuthAppProps & {
  clientId: string;
  dateCreated: string;
  authorizedUsers: number;
};

type OAuthAppsResponse = { oauthServerEnabled: boolean; apps: OAuthApp[] };

const POLICY_OPTIONS: {
  value: OAuthAccessPolicy;
  label: string;
  description: string;
}[] = [
  {
    value: "any",
    label: "Any application",
    description:
      "Members can authorize any OAuth application, such as MCP clients and the GrowthBook CLI.",
  },
  {
    value: "org-apps",
    label: "Only this organization's OAuth apps",
    description:
      "Members can authorize only the apps registered below. Tokens held by other applications stop working.",
  },
  {
    value: "none",
    label: "No applications",
    description:
      "Every OAuth token stops working and members can't authorize new applications.",
  },
];

const OAuthAppModal: FC<{
  existing: OAuthApp | null;
  close: () => void;
  onSaved: (clientSecret: string | null, clientId: string) => void;
}> = ({ existing, close, onSaved }) => {
  const { apiCall } = useAuth();
  const [clientName, setClientName] = useState(existing?.clientName ?? "");
  const [redirectUris, setRedirectUris] = useState<string[]>(
    existing?.redirectUris ?? [],
  );
  const [clientUri, setClientUri] = useState(existing?.clientUri ?? "");

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      header={existing ? "Edit OAuth App" : "New OAuth App"}
      cta={existing ? "Save" : "Create"}
      ctaEnabled={!!clientName.trim() && redirectUris.length > 0}
      close={close}
      submit={async () => {
        const body = JSON.stringify({ clientName, redirectUris, clientUri });
        if (existing) {
          await apiCall(`/oauth-apps/${existing.clientId}`, {
            method: "PUT",
            body,
          });
          onSaved(null, existing.clientId);
        } else {
          const res = await apiCall<{
            app: { clientId: string };
            clientSecret: string;
          }>("/oauth-apps", { method: "POST", body });
          onSaved(res.clientSecret, res.app.clientId);
        }
      }}
    >
      <Flex direction="column" gap="4">
        <TextField
          label="Name"
          helpText="Shown to members on the authorization screen."
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Internal MCP server"
        />
        <StringArrayField
          label="Redirect URIs"
          helpText="Where authorization codes are sent. Must use https, except for localhost."
          value={redirectUris}
          onChange={setRedirectUris}
          delimiters={["Enter", "Tab", " "]}
          placeholder="https://mcp.example.com/oauth/callback"
        />
        <TextField
          label="Homepage URL (optional)"
          value={clientUri}
          onChange={(e) => setClientUri(e.target.value)}
          placeholder="https://mcp.example.com"
        />
      </Flex>
    </ModalStandard>
  );
};

const ClientSecretModal: FC<{
  clientId: string;
  clientSecret: string;
  close: () => void;
}> = ({ clientId, clientSecret, close }) => (
  <ModalStandard
    trackingEventModalType=""
    open={true}
    header="Client Credentials"
    closeCta="Done"
    close={close}
  >
    <Callout status="warning" mb="4">
      Copy the client secret now. You won&apos;t be able to see it again.
    </Callout>
    <Text as="div" weight="semibold" mb="1">
      Client ID
    </Text>
    <ClickToCopy className="mb-3">{clientId}</ClickToCopy>
    <Text as="div" weight="semibold" mb="1">
      Client secret
    </Text>
    <ClickToCopy>{clientSecret}</ClickToCopy>
  </ModalStandard>
);

// Org-registered OAuth apps plus the policy for which OAuth clients may act as members.
const OAuthAppsSettings: FC = () => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canManageApps = permissionsUtil.canCreateApiKey();
  const canDeleteApps = permissionsUtil.canDeleteApiKey();
  const canManageOrgSettings = permissionsUtil.canManageOrgSettings();
  const hasFeature = hasCommercialFeature("oauth-apps");

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
  const [credentials, setCredentials] = useState<{
    clientId: string;
    clientSecret: string;
  } | null>(null);
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
        options={POLICY_OPTIONS}
        value={policy}
        disabled={!canManageOrgSettings || hasFileConfig()}
        setValue={(value) => {
          const next = value as OAuthAccessPolicy;
          if (next === policy) return;
          if (next === "any") void savePolicy(next);
          else setPendingPolicy(next);
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
                <TableCell>{app.clientName}</TableCell>
                <TableCell>
                  <ClickToCopy compact>{app.clientId}</ClickToCopy>
                </TableCell>
                <TableCell>
                  {app.redirectUris.map((uri) => (
                    <Text as="div" size="sm" key={uri}>
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
                      >
                        <BsThreeDotsVertical size={18} />
                      </IconButton>
                    }
                    menuPlacement="end"
                    variant="soft"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => setEditing(app)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
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
                            `The current secret for "${app.clientName}" stops working immediately. Members stay authorized, but the app can't refresh tokens until it is updated with the new secret.`,
                        }}
                      >
                        Rotate secret
                      </DropdownMenuItem>
                      {canDeleteApps && (
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
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PremiumTooltip commercialFeature="oauth-apps">
        <Button disabled={!hasFeature} onClick={() => setEditing("new")}>
          New OAuth app
        </Button>
      </PremiumTooltip>

      {grantsData && (
        <OAuthGrantsTable
          grants={grantsData.grants}
          canRevoke={canDeleteApps}
          onRevoked={refresh}
        />
      )}

      {editing && (
        <OAuthAppModal
          existing={editing === "new" ? null : editing}
          close={() => setEditing(null)}
          onSaved={(clientSecret, clientId) => {
            if (clientSecret) setCredentials({ clientId, clientSecret });
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
            pendingPolicy === "none"
              ? "Every OAuth token stops working immediately, including MCP clients and the GrowthBook CLI. Members won't be able to authorize new applications."
              : "Tokens held by applications not registered below stop working immediately, including MCP clients and the GrowthBook CLI."
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
