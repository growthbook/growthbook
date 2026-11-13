import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCheck,
  PiPlusBold,
  PiWarningFill,
  PiWebhooksLogo,
} from "react-icons/pi";
import {
  WebhookInterface,
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
} from "shared/types/webhook";
import { ago } from "shared/dates";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Revision, patchOpsToPartial } from "shared/enterprise";
import {
  parseSdkWebhookSnapshot,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import isEqual from "lodash/isEqual";
import useApi from "@/hooks/useApi";
import EditSDKWebhooksModal, {
  CreateSDKWebhookModal,
} from "@/components/Settings/WebhooksModal";
import { useAuth } from "@/services/auth";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import EmptyStateMessage from "@/components/EmptyStateMessage";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { isDraftRevision } from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";
import { DraftChangeMark } from "@/components/Features/DraftChangesPopover";
import SectionFrame from "@/components/SectionFrame";
import WebhookErrorDetails from "./WebhookErrorDetails";

// As the webhook editor names them; the review diff shows them too.
export const PAYLOAD_FORMAT_LABELS: Record<string, string> = {
  standard: "Standard",
  "standard-no-payload": "Standard (no SDK Payload)",
  sdkPayload: "SDK Payload only",
  edgeConfig: "Vercel Edge Config (stringified payload)",
  edgeConfigUnescaped: "Vercel Edge Config",
  none: "None",
};

// Rows predating `httpMethod` default to POST, and a default timeout is
// omitted, both as the server snapshots them.
function toSnapshot(
  wh: WebhookInterface | SDKWebhookRevisionSnapshot,
): SDKWebhookRevisionSnapshot {
  return parseSdkWebhookSnapshot({
    ...wh,
    httpMethod: wh.httpMethod ?? "POST",
  });
}

type WebhookRow = {
  snapshot: SDKWebhookRevisionSnapshot;
  live?: WebhookInterface;
  staged: "added" | "edited" | "removed" | null;
};

export default function SdkWebhooks({
  connection,
  approvalRequired,
  onRevisionCreated,
  selectedRevision,
  liveRevisionId = null,
}: {
  connection: SDKConnectionInterface;
  approvalRequired?: boolean;
  onRevisionCreated?: (revision: Revision) => void;
  selectedRevision?: Revision | null;
  liveRevisionId?: string | null;
}) {
  const { data, mutate } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/sdk-connections/${connection.id}/webhooks`,
  );

  const [createWebhookModalOpen, setCreateWebhookModalOpen] = useState(false);

  const [editWebhookData, setEditWebhookData] =
    useState<null | Partial<WebhookInterface>>(null);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const canTestWebhook = permissionsUtil.canUpdateSDKWebhook(connection);

  const selectedDraft = isDraftRevision(selectedRevision)
    ? selectedRevision
    : null;
  // An earlier revision shows what it published or proposed, read-only.
  const pastRevision =
    selectedRevision && !selectedDraft && selectedRevision.id !== liveRevisionId
      ? selectedRevision
      : null;
  const viewedRevision = selectedDraft ?? pastRevision;
  // Writing straight to live while viewing a draft would diverge from it.
  const useRevisionFlow = !!approvalRequired || !!selectedDraft;
  // A draft change is a connection change too.
  const canEditDraft =
    !useRevisionFlow || permissionsUtil.canUpdateSDKConnection(connection, {});
  const canCreateWebhooks =
    canEditDraft && permissionsUtil.canCreateSDKWebhook(connection);
  const canUpdateWebhook = canEditDraft && canTestWebhook;
  const canDeleteWebhook =
    canEditDraft && permissionsUtil.canDeleteSDKWebhook(connection);

  const liveWebhooks = data?.webhooks ?? [];
  const liveById = new Map(liveWebhooks.map((wh) => [wh.id, wh]));

  const baselineWebhooks =
    (
      viewedRevision?.target.snapshot as
        | { sdkWebhooks?: SDKWebhookRevisionSnapshot[] }
        | undefined
    )?.sdkWebhooks ?? [];

  const draftWebhookSnapshots = ((): SDKWebhookRevisionSnapshot[] | null => {
    if (!viewedRevision) return null;
    const proposed = patchOpsToPartial(
      viewedRevision.target.proposedChanges,
    ) as { sdkWebhooks?: SDKWebhookRevisionSnapshot[] };
    return (proposed.sdkWebhooks ?? baselineWebhooks).map(toSnapshot);
  })();

  // What the draft started from: a live webhook it lacks was removed by it
  // only if it was there to begin with. One added to live since is kept.
  const draftBaseIds = new Set(baselineWebhooks.map((wh) => wh.id));

  const draftIds = new Set(draftWebhookSnapshots?.map((wh) => wh.id));

  const rows: WebhookRow[] = pastRevision
    ? (draftWebhookSnapshots ?? []).map((snapshot) => ({
        snapshot,
        staged: null,
      }))
    : draftWebhookSnapshots
      ? [
          ...draftWebhookSnapshots.map((snapshot): WebhookRow => {
            const live = liveById.get(snapshot.id);
            return {
              snapshot,
              live,
              staged: !live
                ? "added"
                : isEqual(snapshot, toSnapshot(live))
                  ? null
                  : "edited",
            };
          }),
          // Live webhooks the draft deletes stay in view until it publishes.
          ...liveWebhooks
            .filter((live) => !draftIds.has(live.id))
            .map(
              (live): WebhookRow => ({
                snapshot: toSnapshot(live),
                live,
                staged: draftBaseIds.has(live.id) ? "removed" : null,
              }),
            ),
        ]
      : liveWebhooks.map((live) => ({
          snapshot: toSnapshot(live),
          live,
          staged: null,
        }));

  const hasWebhooks = rows.length > 0;
  // One the draft removes no longer counts toward the plan's limit.
  const keepsWebhook = rows.some((row) => row.staged !== "removed");
  const disableWebhookCreate =
    !!pastRevision ||
    (keepsWebhook && !hasCommercialFeature("multiple-sdk-webhooks"));

  function buildRevisionUrl() {
    if (selectedDraft) {
      return `/sdk-connections/${connection.id}?revisionId=${selectedDraft.id}`;
    }
    return `/sdk-connections/${connection.id}?forceCreateRevision=1`;
  }

  async function submitWebhookRevision(
    newSnapshots: SDKWebhookRevisionSnapshot[],
  ) {
    const res = await apiCall<{
      status: number;
      requiresApproval?: boolean;
      revision?: Revision;
    }>(buildRevisionUrl(), {
      method: "PUT",
      body: JSON.stringify({ sdkWebhooks: newSnapshots }),
    });
    if (res?.revision) {
      onRevisionCreated?.(res.revision);
    }
    await mutate();
  }

  const currentWebhookSnapshots = (): SDKWebhookRevisionSnapshot[] =>
    draftWebhookSnapshots ?? liveWebhooks.map(toSnapshot);

  const handleCreateViaRevision = async (
    formData: CreateSdkWebhookProps,
  ): Promise<void> => {
    const currentSnapshots = currentWebhookSnapshots();
    const tempId = `temp_${Date.now()}`;
    const newSnapshot: SDKWebhookRevisionSnapshot = {
      id: tempId,
      name: formData.name,
      endpoint: formData.endpoint,
      httpMethod: formData.httpMethod ?? "POST",
      ...(formData.headers !== undefined && { headers: formData.headers }),
      ...(formData.payloadFormat !== undefined && {
        payloadFormat: formData.payloadFormat,
      }),
      ...(formData.payloadKey !== undefined && {
        payloadKey: formData.payloadKey,
      }),
      ...((formData.timeoutSeconds ?? null) !== null && {
        timeoutSeconds: formData.timeoutSeconds,
      }),
    };
    await submitWebhookRevision([...currentSnapshots, newSnapshot]);
  };

  const handleEditViaRevision = async (
    formData: UpdateSdkWebhookProps,
    id: string | undefined,
  ): Promise<void> => {
    const currentSnapshots = currentWebhookSnapshots();
    if (!currentSnapshots.some((s) => s.id === id)) {
      throw new Error(
        "This webhook is not part of the selected draft, so the edit cannot be staged there. Switch to the live version or another draft and try again.",
      );
    }
    const updated = currentSnapshots.map((s) => {
      if (s.id !== id) return s;
      // A blank timeout (null) clears it back to the default.
      const { timeoutSeconds: currentTimeout, ...rest } = s;
      const timeoutSeconds =
        formData.timeoutSeconds === undefined
          ? currentTimeout
          : formData.timeoutSeconds;
      return {
        ...rest,
        name: formData.name ?? s.name,
        endpoint: formData.endpoint ?? s.endpoint,
        httpMethod: formData.httpMethod ?? s.httpMethod,
        ...(formData.headers !== undefined && {
          headers: formData.headers,
        }),
        ...(formData.payloadFormat !== undefined && {
          payloadFormat: formData.payloadFormat,
        }),
        ...(formData.payloadKey !== undefined && {
          payloadKey: formData.payloadKey,
        }),
        ...((timeoutSeconds ?? null) !== null && { timeoutSeconds }),
      };
    });
    await submitWebhookRevision(updated);
  };

  const handleDeleteViaRevision = async (webhookId: string): Promise<void> => {
    await submitWebhookRevision(
      currentWebhookSnapshots().filter((s) => s.id !== webhookId),
    );
  };

  const renderStatus = (live: WebhookInterface | undefined) => {
    if (!live) {
      return <Badge label="Never fired" color="gray" variant="soft" />;
    }
    if (live.disabled || live.error) {
      return (
        <Popover
          openOnHover
          side="bottom"
          contentStyle={{ maxWidth: 420 }}
          trigger={
            <Badge
              label={
                <>
                  <PiWarningFill />
                  {live.disabled ? "Disabled" : "Error"}
                </>
              }
              color="red"
              variant="soft"
              style={{ cursor: "default" }}
            />
          }
          content={
            <Flex direction="column" gap="2">
              {live.disabled ? (
                <Text weight="semibold">
                  Disabled after {live.consecutiveFailures} consecutive
                  failures.
                </Text>
              ) : null}
              {live.error ? <WebhookErrorDetails error={live.error} /> : null}
            </Flex>
          }
        />
      );
    }
    if (live.lastSuccess) {
      return (
        <Badge
          label={
            <>
              <PiCheck />
              {ago(live.lastSuccess)}
            </>
          }
          color="green"
          variant="soft"
        />
      );
    }
    return <Badge label="Never fired" color="gray" variant="soft" />;
  };

  const renderTableRows = () => {
    return rows.map(({ snapshot, live, staged }) => {
      const managedBy = live?.managedBy?.type;
      // Only what the draft holds can change in it; Test reaches live either way.
      const notInDraftReason =
        !draftWebhookSnapshots || draftIds.has(snapshot.id)
          ? undefined
          : staged === "removed"
            ? "Removed in this draft."
            : "Added after this draft was created. Switch to the live version to change it.";
      const hidden = (
        <Text color="text-mid" fontStyle="italic">
          hidden
        </Text>
      );
      return (
        <TableRow key={snapshot.id} align="start">
          <TableCell minWidth="150px">
            <Flex direction="column" align="start" gap="1">
              <Flex align="center" gap="2" wrap="wrap">
                <Text color={staged === "removed" ? "text-mid" : undefined}>
                  {snapshot.name}
                </Text>
                {staged ? <DraftChangeMark change={staged} spelled /> : null}
              </Flex>
              {managedBy ? (
                <Badge
                  label={`Managed by ${capitalizeFirstLetter(managedBy)}`}
                />
              ) : null}
            </Flex>
          </TableCell>
          <TableCell>
            {managedBy ? (
              hidden
            ) : (
              <Text size="sm" mono overflowWrap="anywhere">
                {snapshot.endpoint}
              </Text>
            )}
          </TableCell>
          <TableCell>
            {managedBy ? hidden : <Text size="sm">{snapshot.httpMethod}</Text>}
          </TableCell>
          <TableCell>
            {managedBy ? (
              hidden
            ) : (
              <Text size="sm">
                {PAYLOAD_FORMAT_LABELS[snapshot.payloadFormat ?? "standard"]}
              </Text>
            )}
          </TableCell>
          <TableCell>
            {live?.signingKey && !managedBy ? (
              <ClickToReveal
                valueWhenHidden="wk_abc123def456ghi789"
                getValue={async () => live.signingKey}
              />
            ) : (
              hidden
            )}
          </TableCell>
          <TableCell>{renderStatus(live)}</TableCell>
          <TableCell>
            {!pastRevision &&
            ((live && canTestWebhook) ||
              (!managedBy && (canUpdateWebhook || canDeleteWebhook))) ? (
              <DropdownMenu
                trigger={
                  <MoreMenuTrigger
                    label="Webhook actions"
                    // Centred on the row's first line of text: (28 - 20) / 2.
                    style={{ marginBlock: -4 }}
                  />
                }
                menuPlacement="end"
              >
                {live && canTestWebhook ? (
                  <DropdownMenuItem
                    onClick={async () => {
                      await apiCall(`/sdk-webhooks/${live.id}/test`, {
                        method: "post",
                      });
                      mutate();
                    }}
                  >
                    Test
                  </DropdownMenuItem>
                ) : null}
                {!managedBy && canUpdateWebhook ? (
                  <DropdownMenuItem
                    disabled={!!notInDraftReason}
                    tooltip={notInDraftReason}
                    onClick={() =>
                      setEditWebhookData({
                        id: snapshot.id,
                        name: snapshot.name,
                        endpoint: snapshot.endpoint,
                        httpMethod: snapshot.httpMethod,
                        headers: snapshot.headers,
                        payloadFormat: snapshot.payloadFormat,
                        payloadKey: snapshot.payloadKey,
                        timeoutSeconds: snapshot.timeoutSeconds ?? null,
                      })
                    }
                  >
                    Edit
                  </DropdownMenuItem>
                ) : null}
                {!managedBy && canDeleteWebhook ? (
                  <DropdownMenuItem
                    disabled={!!notInDraftReason}
                    tooltip={notInDraftReason}
                    color="red"
                    confirmation={{
                      confirmationTitle: "Delete SDK Webhook",
                      // In a draft it's only removed once the draft publishes.
                      getConfirmationContent: useRevisionFlow
                        ? async () =>
                            "This is saved to a draft. The webhook keeps firing until the draft is published."
                        : undefined,
                      cta: "Delete",
                      ctaColor: "red",
                      submit: async () => {
                        if (useRevisionFlow) {
                          await handleDeleteViaRevision(snapshot.id);
                        } else {
                          await apiCall(`/sdk-webhooks/${snapshot.id}`, {
                            method: "DELETE",
                          });
                          mutate();
                        }
                      },
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenu>
            ) : null}
          </TableCell>
        </TableRow>
      );
    });
  };

  return (
    <>
      <SectionFrame
        title="SDK Webhooks"
        actions={
          canCreateWebhooks ? (
            <Tooltip
              content={
                pastRevision
                  ? "Switch to live or a draft to change webhooks."
                  : "You can only have one webhook per SDK Connection in the free plan"
              }
              enabled={disableWebhookCreate}
            >
              <Button
                disabled={disableWebhookCreate}
                onClick={() => setCreateWebhookModalOpen(true)}
                icon={<PiPlusBold />}
              >
                Add webhook
              </Button>
            </Tooltip>
          ) : null
        }
      >
        {hasWebhooks ? (
          <Table
            variant="ghost"
            scrollX
            stickyLastColumn
            style={{ minWidth: 900 }}
          >
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Webhook</TableColumnHeader>
                <TableColumnHeader>Endpoint</TableColumnHeader>
                <TableColumnHeader>Method</TableColumnHeader>
                <TableColumnHeader width="130px">Format</TableColumnHeader>
                <TableColumnHeader>Shared secret</TableColumnHeader>
                <TableColumnHeader width="125px">
                  Last success
                </TableColumnHeader>
                <TableColumnHeader width="35px" />
              </TableRow>
            </TableHeader>
            <TableBody>{renderTableRows()}</TableBody>
          </Table>
        ) : (
          <Box py="6">
            <EmptyStateMessage
              icon={<PiWebhooksLogo size={20} />}
              title={
                pastRevision
                  ? "No webhooks in this revision"
                  : "No webhooks yet"
              }
              description={
                <>
                  Webhooks fire on any change affecting this SDK Connection,
                  such as editing a feature or experiment.{" "}
                  <DocLink docSection="sdkWebhooks">Learn more</DocLink>
                </>
              }
            />
          </Box>
        )}
      </SectionFrame>
      {editWebhookData && (
        <EditSDKWebhooksModal
          close={() => setEditWebhookData(null)}
          onSave={mutate}
          current={editWebhookData}
          sdkConnectionId={connection.id}
          onOverrideSubmit={useRevisionFlow ? handleEditViaRevision : undefined}
        />
      )}
      {createWebhookModalOpen && (
        <CreateSDKWebhookModal
          close={() => setCreateWebhookModalOpen(false)}
          onSave={mutate}
          sdkConnectionId={connection.id}
          sdkConnectionKey={connection.key}
          language={connection.languages?.[0]}
          onOverrideCreate={
            useRevisionFlow ? handleCreateViaRevision : undefined
          }
        />
      )}
    </>
  );
}
