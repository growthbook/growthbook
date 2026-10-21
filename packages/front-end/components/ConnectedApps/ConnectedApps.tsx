import React, { FC, useCallback, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ago, datetime } from "shared/dates";
import { OAuthTokenPermissions } from "shared/validators";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import {
  describeGrant,
  PRESET_LABELS,
} from "@/components/Settings/apiKeyPermissions";
import { presetDescriptions } from "@/components/Settings/PermissionsField";
import { RoleRulesSummary } from "@/components/Settings/Team/RoleRulesSummary";

interface ConnectedApp {
  clientId: string;
  clientName: string;
  clientUri?: string;
  scopes: string[];
  permissions: OAuthTokenPermissions | null;
  firstAuthorizedAt: string;
  lastUsedAt: string;
}

type ConnectedAppsProps = {
  apps: ConnectedApp[];
  onRevoke: (clientId: string) => Promise<void>;
};

export const ConnectedApps: FC<ConnectedAppsProps> = ({ apps, onRevoke }) => {
  const [pendingRevoke, setPendingRevoke] = useState<ConnectedApp | null>(null);

  if (apps.length === 0) return null;

  return (
    <Box mb="4">
      <Heading as="h2" size="xl" mb="2">
        Connected Apps
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Third-party applications you have authorized to access GrowthBook on
        your behalf in this organization. Revoking access signs the app out and
        invalidates its tokens immediately.
      </Text>
      <Table variant="surface" mb="3">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Application</TableColumnHeader>
            <TableColumnHeader>Permissions</TableColumnHeader>
            <TableColumnHeader>Scopes</TableColumnHeader>
            <TableColumnHeader>Last used</TableColumnHeader>
            <TableColumnHeader style={{ width: 100 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((app) => (
            <TableRow key={app.clientId}>
              <TableCell>{app.clientName}</TableCell>
              <TableCell>
                <GrantPermissions permissions={app.permissions} />
              </TableCell>
              <TableCell>
                {app.scopes.length > 0 ? (
                  app.scopes.map((s) => (
                    <Badge key={s} mr="1" variant="soft" label={s} />
                  ))
                ) : (
                  <Text color="text-low">—</Text>
                )}
              </TableCell>
              <TableCell>
                <Tooltip content={datetime(app.lastUsedAt)}>
                  <span>{ago(app.lastUsedAt)}</span>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Button
                  color="red"
                  variant="outline"
                  onClick={() => setPendingRevoke(app)}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pendingRevoke && (
        <ConfirmDialog
          title={`Revoke access for ${pendingRevoke.clientName}?`}
          content="This app will be signed out and its access and refresh tokens will stop working immediately. It can request access again by going through authorization."
          yesText="Revoke"
          color="red"
          onConfirm={async () => {
            const target = pendingRevoke;
            await onRevoke(target.clientId);
            setPendingRevoke(null);
          }}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </Box>
  );
};

function GrantPermissions({
  permissions,
}: {
  permissions: OAuthTokenPermissions | null;
}) {
  const { preset, scope, confirmations } = describeGrant(permissions);
  // Named like the consent page's choices, and described the same way.
  if (preset) {
    return (
      <Tooltip content={presetDescriptions("pat")[preset]}>
        <span>{PRESET_LABELS[preset]}</span>
      </Tooltip>
    );
  }
  return (
    <Flex direction="column" gap="1">
      <span>Custom</span>
      {scope && <RoleRulesSummary value={scope} />}
      {confirmations && (
        <Text size="sm" color="text-mid">
          Some actions wait for you to confirm.
        </Text>
      )}
    </Flex>
  );
}

export const ConnectedAppsContainer = () => {
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{ connectedApps: ConnectedApp[] }>(
    "/oauth/connected-apps",
  );

  const onRevoke = useCallback(
    async (clientId: string) => {
      await apiCall(`/oauth/connected-apps/revoke`, {
        method: "POST",
        body: JSON.stringify({ clientId }),
      });
      mutate();
    },
    [apiCall, mutate],
  );

  return <ConnectedApps apps={data?.connectedApps ?? []} onRevoke={onRevoke} />;
};
