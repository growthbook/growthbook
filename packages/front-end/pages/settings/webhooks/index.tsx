import React, { FC, useState } from "react";
import { datetime } from "shared/dates";
import { Box, IconButton } from "@radix-ui/themes";
import { PiArrowUpRight, PiDotsThreeVertical, PiPlus } from "react-icons/pi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EventWebHookListContainer } from "@/components/EventWebHooks/EventWebHookList/EventWebHookList";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import SettingsPage, {
  SettingsNoAccess,
  SettingsPageHeader,
} from "@/components/Layout/SettingsPage";
import { DocLink } from "@/components/DocLink";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";

const WebhooksPage: FC = () => {
  const permissionsUtil = usePermissionsUtil();

  const canManageWebhooks = permissionsUtil.canManageSomeEventWebhooks();
  const canManageSecrets = permissionsUtil.canManageWebhookSecrets();

  const { apiCall } = useAuth();

  const { webhookSecrets, mutateDefinitions } = useDefinitions();

  const [editSecretId, setEditSecretId] = useState<string | null>(null);

  const queryParams = new URLSearchParams(window.location.search);
  const [newSecretOpen, setNewSecretOpen] = useState<boolean>(
    queryParams.has("newSecret") || false,
  );

  if (!canManageWebhooks) {
    return <SettingsNoAccess title="Webhooks" />;
  }

  return (
    <SettingsPage
      title="Event Webhooks"
      description={
        <>
          Monitor specific events globally across features and experiments.{" "}
          <DocLink docSection="eventWebhooks">
            View documentation <PiArrowUpRight />
          </DocLink>
        </>
      }
    >
      <Box mt="6">
        <EventWebHookListContainer />
      </Box>

      <Box mt="7">
        <SettingsPageHeader
          as="h2"
          title="Webhook Secrets"
          description={
            <>
              Use secrets in webhook endpoints or headers with Handlebars
              syntax, e.g. <code>{"{{ MY_SECRET }}"}</code>
            </>
          }
          actions={
            canManageSecrets && (
              <Button
                variant="outline"
                icon={<PiPlus />}
                onClick={() => setNewSecretOpen(true)}
              >
                Add secret
              </Button>
            )
          }
        />
        {!canManageSecrets && (
          <Callout status="info" mb="3">
            Webhook secrets are shared by every webhook, so managing them
            requires access that is not limited by environment or Project.
          </Callout>
        )}
        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Key</TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader>Allowed origins</TableColumnHeader>
              <TableColumnHeader>Created</TableColumnHeader>
              <TableColumnHeader>Updated</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhookSecrets.map((secret) => (
              <TableRow key={secret.id}>
                <TableCell>
                  <ClickToCopy>{secret.key}</ClickToCopy>
                </TableCell>
                <TableCell>{secret.description}</TableCell>
                <TableCell>
                  {secret.allowedOrigins?.length ? (
                    secret.allowedOrigins.join(", ")
                  ) : (
                    <em>Any</em>
                  )}
                </TableCell>
                <TableCell>{datetime(secret.dateCreated)}</TableCell>
                <TableCell>{datetime(secret.dateUpdated)}</TableCell>
                <TableCell>
                  {canManageSecrets && (
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          aria-label="Webhook secret actions"
                        >
                          <PiDotsThreeVertical size={18} />
                        </IconButton>
                      }
                      menuPlacement="end"
                    >
                      <DropdownMenuItem
                        onClick={() => setEditSecretId(secret.id)}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          confirmationTitle: "Delete Webhook Secret",
                          cta: "Delete secret",
                          ctaColor: "red",
                          submit: async () => {
                            await apiCall<void>(
                              `/webhook-secrets/${secret.id}`,
                              {
                                method: "DELETE",
                              },
                            );
                            await mutateDefinitions();
                          },
                        }}
                      >
                        Delete secret
                      </DropdownMenuItem>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!webhookSecrets.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Box py="6">
                    <Text as="p" align="center" weight="semibold" mb="1">
                      No webhook secrets
                    </Text>
                    <Text as="p" align="center" color="text-mid">
                      Add a secret to reference it in webhook endpoints or
                      headers.
                    </Text>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      {newSecretOpen && canManageSecrets && (
        <WebhookSecretModal
          close={() => {
            setNewSecretOpen(false);
          }}
        />
      )}
      {editSecretId && (
        <WebhookSecretModal
          existingId={editSecretId}
          close={() => {
            setEditSecretId(null);
          }}
        />
      )}
    </SettingsPage>
  );
};
export default WebhooksPage;
