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
import {
  Revision,
  isScheduledPublishLockActive,
  patchOpsToPartial,
} from "shared/enterprise";
import {
  parseSdkWebhookSnapshot,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import isEqual from "lodash/isEqual";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import useApi from "@/hooks/useApi";
import EditSDKWebhooksModal, {
  CreateSDKWebhookModal,
} from "@/components/Settings/WebhooksModal";
import { useAuth } from "@/services/auth";
import { ApiCallError } from "@/services/apiCallError";
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
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import {
  isDraftRevision,
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";
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
  liveRevisionId = null,
  refresh,
  ...revisionProps
}: {
  connection: SDKConnectionInterface;
  liveRevisionId?: string | null;
  // Reloads the connection and its revisions after a change lands.
  refresh: () => Promise<unknown>;
} & SdkConnectionRevisionProps) {
  const {
    selectedRevision,
    openRevisions = [],
    allRevisions = [],
  } = revisionProps;
  const { data, mutate } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/sdk-connections/${connection.id}/webhooks`,
  );

  const [createWebhookModalOpen, setCreateWebhookModalOpen] = useState(false);

  const [editWebhookData, setEditWebhookData] =
    useState<null | Partial<WebhookInterface>>(null);
  const [deleteWebhook, setDeleteWebhook] =
    useState<SDKWebhookRevisionSnapshot | null>(null);
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
  // Every webhook change is a change to the connection, saved to a draft or
  // published as one of its revisions.
  const canEditDraft = permissionsUtil.canUpdateSDKConnection(connection, {});
  const canCreateWebhooks =
    canEditDraft && permissionsUtil.canCreateSDKWebhook(connection);
  // A draft locked for its scheduled publish takes no edits, as the server
  // refuses them.
  const lockedDraft =
    !!selectedDraft &&
    isScheduledPublishLockActive(selectedDraft) &&
    !!selectedDraft.scheduledPublishLockEdits;
  const canUpdateWebhook = canEditDraft && canTestWebhook && !lockedDraft;
  const canDeleteWebhook =
    canEditDraft &&
    !lockedDraft &&
    permissionsUtil.canDeleteSDKWebhook(connection);

  const liveWebhooks = data?.webhooks ?? [];
  const liveById = new Map(liveWebhooks.map((wh) => [wh.id, wh]));

  const baselineWebhooks =
    (
      viewedRevision?.target.snapshot as
        | { sdkWebhooks?: SDKWebhookRevisionSnapshot[] }
        | undefined
    )?.sdkWebhooks ?? [];

  // A revision's webhooks: the ones it proposes, else the ones it started from.
  const webhooksOf = (revision: Revision): SDKWebhookRevisionSnapshot[] => {
    type Held = { sdkWebhooks?: SDKWebhookRevisionSnapshot[] };
    const proposed = patchOpsToPartial(revision.target.proposedChanges) as Held;
    const started = (revision.target.snapshot as Held).sdkWebhooks ?? [];
    return (proposed.sdkWebhooks ?? started).map(toSnapshot);
  };
  const draftWebhookSnapshots = viewedRevision
    ? webhooksOf(viewedRevision)
    : null;

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
    lockedDraft ||
    (keepsWebhook && !hasCommercialFeature("multiple-sdk-webhooks"));

  const flow = useSdkConnectionRevisionFlow({
    connection,
    mutate: () => Promise.all([mutate(), refresh()]),
    proposedScope: {
      projects: connection.projects,
      environment: connection.environment,
    },
    ...revisionProps,
  });
  // Chosen in each modal: an open draft, a new one, or publishing now.
  const destination = (
    <RevisionDraftSelectorForChanges
      entityId={connection.id}
      openRevisions={openRevisions}
      allRevisions={allRevisions}
      mode={flow.mode}
      setMode={flow.setMode}
      selectedDraftId={flow.selectedDraftId}
      setSelectedDraftId={flow.setSelectedDraftId}
      canAutoPublish={flow.canAutoPublish}
      approvalRequired={flow.approvalRequired}
    />
  );
  const draftCta = flow.mode === "publish" ? undefined : "Save to draft";

  // `from` is the list the change was made to. The server refuses the save
  // if a webhook was added or removed since, which this list would undo.
  const submitWebhookRevision = async (
    newSnapshots: SDKWebhookRevisionSnapshot[],
    from: SDKWebhookRevisionSnapshot[],
  ) => {
    try {
      await flow.save(
        { sdkWebhooks: newSnapshots },
        { sdkWebhookIds: from.map((wh) => wh.id) },
      );
    } catch (e) {
      // Reloaded, so trying again starts from what's there now.
      if (e instanceof ApiCallError && e.code === "changes_conflict") {
        await Promise.all([mutate(), refresh()]);
      }
      throw e;
    }
  };

  // The webhooks the change is made to: the chosen draft's, or live's.
  const currentWebhookSnapshots = (): SDKWebhookRevisionSnapshot[] => {
    const target =
      flow.mode === "existing"
        ? openRevisions.find((r) => r.id === flow.selectedDraftId)
        : null;
    return target ? webhooksOf(target) : liveWebhooks.map(toSnapshot);
  };
  // A webhook can be changed only where it exists: one a draft added isn't
  // on live, and one added to live since isn't in an older draft.
  const snapshotsWith = (id: string | undefined) => {
    const snapshots = currentWebhookSnapshots();
    if (!snapshots.some((s) => s.id === id)) {
      throw new Error(
        "This webhook isn't in the version you're saving to. Pick another one above.",
      );
    }
    return snapshots;
  };

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
    await submitWebhookRevision(
      [...currentSnapshots, newSnapshot],
      currentSnapshots,
    );
  };

  const handleEditViaRevision = async (
    formData: UpdateSdkWebhookProps,
    id: string | undefined,
  ): Promise<void> => {
    const from = snapshotsWith(id);
    const updated = from.map((s) => {
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
    await submitWebhookRevision(updated, from);
  };

  const handleDeleteViaRevision = async (webhookId: string): Promise<void> => {
    const from = snapshotsWith(webhookId);
    await submitWebhookRevision(
      from.filter((s) => s.id !== webhookId),
      from,
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
      // History rows have no live row and snapshots drop `managedBy`, so take
      // it from the live webhook, or from the connection when it's managed.
      const managedBy = pastRevision
        ? (liveById.get(snapshot.id)?.managedBy?.type ??
          connection.managedBy?.type)
        : live?.managedBy?.type;
      // Only what the draft holds can change in it; Test reaches live either way.
      const notInDraftReason =
        !draftWebhookSnapshots || draftIds.has(snapshot.id)
          ? undefined
          : staged === "removed"
            ? "Removed in this draft."
            : "Added after this draft was created. Switch to the live version to change it.";
      // Headers are withheld from someone who can't edit every connection
      // the webhook fires for, and an edit would save over them.
      const editBlockedReason =
        notInDraftReason ??
        (live?.signingKey === ""
          ? "This webhook also fires for SDK Connections you can't edit. Someone with access to all of them can change it."
          : undefined);
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
                variant="soft"
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
                    disabled={!!editBlockedReason}
                    tooltip={editBlockedReason}
                    onClick={() => {
                      flow.reset();
                      setEditWebhookData({
                        id: snapshot.id,
                        name: snapshot.name,
                        endpoint: snapshot.endpoint,
                        httpMethod: snapshot.httpMethod,
                        headers: snapshot.headers,
                        payloadFormat: snapshot.payloadFormat,
                        payloadKey: snapshot.payloadKey,
                        timeoutSeconds: snapshot.timeoutSeconds ?? null,
                      });
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                ) : null}
                {!managedBy && canDeleteWebhook ? (
                  <DropdownMenuItem
                    disabled={!!notInDraftReason}
                    tooltip={notInDraftReason}
                    color="red"
                    onClick={() => {
                      flow.reset();
                      setDeleteWebhook(snapshot);
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
                  : lockedDraft
                    ? SCHEDULE_EDIT_LOCK_REASON
                    : "You can only have one webhook per SDK Connection in the free plan"
              }
              enabled={disableWebhookCreate}
            >
              <Button
                disabled={disableWebhookCreate}
                onClick={() => {
                  flow.reset();
                  setCreateWebhookModalOpen(true);
                }}
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
          onOverrideSubmit={handleEditViaRevision}
          destination={destination}
          cta={draftCta}
        />
      )}
      {createWebhookModalOpen && (
        <CreateSDKWebhookModal
          close={() => setCreateWebhookModalOpen(false)}
          onSave={mutate}
          sdkConnectionId={connection.id}
          sdkConnectionKey={connection.key}
          language={connection.languages?.[0]}
          onOverrideCreate={handleCreateViaRevision}
          destination={destination}
          cta={draftCta}
        />
      )}
      {deleteWebhook && (
        <ModalStandard
          open={true}
          trackingEventModalType=""
          header="Delete SDK Webhook"
          size="md"
          close={() => setDeleteWebhook(null)}
          cta={draftCta ?? "Delete"}
          ctaColor={flow.mode === "publish" ? "red" : "violet"}
          submit={() => handleDeleteViaRevision(deleteWebhook.id)}
        >
          <Flex direction="column" gap="4">
            {destination}
            <Text>
              {flow.mode === "publish"
                ? `"${deleteWebhook.name}" stops firing as soon as it's deleted.`
                : `"${deleteWebhook.name}" keeps firing until the draft is published.`}
            </Text>
          </Flex>
        </ModalStandard>
      )}
    </>
  );
}
