import React, { ReactElement, useState } from "react";
import {
  WebhookInterface,
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
} from "shared/types/webhook";
import { FaCheck, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import { IconButton } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Revision, patchOpsToPartial } from "shared/enterprise";
import {
  sdkWebhookSnapshotValidator,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import { PiDotsThreeVertical } from "react-icons/pi";
import isEqual from "lodash/isEqual";
import useApi from "@/hooks/useApi";
import EditSDKWebhooksModal, {
  CreateSDKWebhookModal,
} from "@/components/Settings/WebhooksModal";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import Callout from "@/ui/Callout";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { isDraftRevision } from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";

const payloadFormatLabels: Record<string, string | ReactElement> = {
  standard: "Standard",
  "standard-no-payload": (
    <>
      Standard
      <br />
      (no SDK Payload)
    </>
  ),
  sdkPayload: "SDK Payload only",
  edgeConfig: "Vercel Edge Config (stringified payload)",
  edgeConfigUnescaped: "Vercel Edge Config",
  none: "none",
};

// `httpMethod` is optional on rows predating it but required by the snapshot
// schema; default it the way the server does instead of throwing.
function toSnapshot(wh: WebhookInterface): SDKWebhookRevisionSnapshot {
  return sdkWebhookSnapshotValidator.parse({
    ...wh,
    httpMethod: wh.httpMethod ?? "POST",
  });
}

// A row is the snapshot being shown (the draft's when one is selected) plus
// the live webhook it corresponds to, which carries runtime-only fields.
type WebhookRow = {
  snapshot: SDKWebhookRevisionSnapshot;
  live?: WebhookInterface;
  staged: "added" | "changed" | null;
};

export default function SdkWebhooks({
  connection,
  approvalRequired,
  onRevisionCreated,
  selectedRevision,
}: {
  connection: SDKConnectionInterface;
  approvalRequired?: boolean;
  onRevisionCreated?: (revision: Revision) => void;
  selectedRevision?: Revision | null;
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

  const canCreateWebhooks = permissionsUtil.canCreateSDKWebhook(connection);
  const canUpdateWebhook = permissionsUtil.canUpdateSDKWebhook(connection);
  const canDeleteWebhook = permissionsUtil.canDeleteSDKWebhook(connection);

  // Merged/discarded revisions can be viewed but never written to.
  const selectedDraft = isDraftRevision(selectedRevision)
    ? selectedRevision
    : null;
  // Changes go through the revision system when review is required or when
  // the user is working inside a draft; writing straight to live would
  // silently diverge from the draft they are looking at.
  const useRevisionFlow = !!approvalRequired || !!selectedDraft;

  const liveWebhooks = data?.webhooks ?? [];
  const liveById = new Map(liveWebhooks.map((wh) => [wh.id, wh]));

  // The draft's effective webhook list: its own proposed list, else the
  // baseline it was created from.
  const draftWebhookSnapshots = ((): SDKWebhookRevisionSnapshot[] | null => {
    if (!selectedDraft) return null;
    const proposed = patchOpsToPartial(
      selectedDraft.target.proposedChanges,
    ) as { sdkWebhooks?: SDKWebhookRevisionSnapshot[] };
    if (proposed.sdkWebhooks) return proposed.sdkWebhooks;
    const baseline = selectedDraft.target.snapshot as {
      sdkWebhooks?: SDKWebhookRevisionSnapshot[];
    };
    return baseline?.sdkWebhooks ?? [];
  })();

  const rows: WebhookRow[] = draftWebhookSnapshots
    ? draftWebhookSnapshots.map((snapshot) => {
        const live = liveById.get(snapshot.id);
        return {
          snapshot,
          live,
          staged: !live
            ? "added"
            : isEqual(snapshot, toSnapshot(live))
              ? null
              : "changed",
        };
      })
    : liveWebhooks.map((live) => ({
        snapshot: toSnapshot(live),
        live,
        staged: null,
      }));

  const hasWebhooks = rows.length > 0;
  const disableWebhookCreate =
    !canCreateWebhooks ||
    (hasWebhooks && !hasCommercialFeature("multiple-sdk-webhooks"));

  // Append to the selected draft, otherwise create a new one.
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

  // The base for a draft edit is the DRAFT's list, which is also what the
  // table renders, so every row the user can act on exists in it.
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
    };
    await submitWebhookRevision([...currentSnapshots, newSnapshot]);
  };

  const handleEditViaRevision = async (
    formData: UpdateSdkWebhookProps,
    id: string | undefined,
  ): Promise<void> => {
    const currentSnapshots = currentWebhookSnapshots();
    if (!id) {
      await handleCreateViaRevision(formData as CreateSdkWebhookProps);
      return;
    }
    if (!currentSnapshots.some((s) => s.id === id)) {
      throw new Error(
        "This webhook is not part of the selected draft, so the edit cannot be staged there. Switch to the live version or another draft and try again.",
      );
    }
    const updated = currentSnapshots.map((s) =>
      s.id === id
        ? {
            ...s,
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
          }
        : s,
    );
    await submitWebhookRevision(updated);
  };

  const handleDeleteViaRevision = async (webhookId: string): Promise<void> => {
    const currentSnapshots = currentWebhookSnapshots();
    await submitWebhookRevision(
      currentSnapshots.filter((s) => s.id !== webhookId),
    );
  };

  const renderStatus = (live: WebhookInterface | undefined) => {
    if (!live) {
      return <Badge label="Never fired" color="gray" variant="soft" />;
    }
    if (live.disabled) {
      return (
        <Tooltip
          className="ml-1"
          innerClassName="pb-3"
          usePortal={true}
          body={
            <Callout key={live.id} status="error">
              <div style={{ wordBreak: "break-all" }}>
                Disabled after {live.consecutiveFailures} consecutive failures.
                {live.error ? (
                  <>
                    <br />
                    Last error: {live.error}
                  </>
                ) : null}
              </div>
            </Callout>
          }
        >
          <Badge
            label={
              <>
                <FaExclamationTriangle className="mr-1" />
                Disabled
              </>
            }
            color="red"
            variant="soft"
          />
        </Tooltip>
      );
    }
    if (live.error) {
      return (
        <Tooltip
          className="ml-1"
          innerClassName="pb-3"
          usePortal={true}
          body={
            <Callout key={live.id} status="error">
              <div style={{ wordBreak: "break-all" }}>{live.error}</div>
            </Callout>
          }
        >
          <Badge
            label={
              <>
                <FaExclamationTriangle className="mr-1" />
                Error
              </>
            }
            color="red"
            variant="soft"
          />
        </Tooltip>
      );
    }
    if (live.lastSuccess) {
      return (
        <Badge
          label={
            <>
              <FaCheck className="mr-1" />
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
      return (
        <TableRow key={snapshot.id}>
          <TableCell style={{ minWidth: 150 }}>
            <div>
              {snapshot.name}
              {managedBy ? (
                <div>
                  <Badge
                    label={`Managed by ${capitalizeFirstLetter(managedBy)}`}
                  />
                </div>
              ) : null}
              {staged ? (
                <div>
                  <Badge
                    label={
                      staged === "added" ? "Added in draft" : "Changed in draft"
                    }
                    color="violet"
                    variant="soft"
                  />
                </div>
              ) : null}
            </div>
          </TableCell>
          <TableCell
            style={{
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {managedBy ? (
              <em className="text-muted">hidden</em>
            ) : (
              <code className="text-main small">{snapshot.endpoint}</code>
            )}
          </TableCell>
          <TableCell>
            {managedBy ? (
              <em className="text-muted">hidden</em>
            ) : (
              <span className="small">{snapshot.httpMethod}</span>
            )}
          </TableCell>
          <TableCell>
            {managedBy ? (
              <em className="text-muted">hidden</em>
            ) : (
              <span className="small">
                {payloadFormatLabels?.[snapshot.payloadFormat ?? "standard"]}
              </span>
            )}
          </TableCell>
          <TableCell>
            {live?.signingKey && !managedBy ? (
              <ClickToReveal
                valueWhenHidden="wk_abc123def456ghi789"
                getValue={async () => live.signingKey}
              />
            ) : (
              <em className="text-muted">hidden</em>
            )}
          </TableCell>
          <TableCell>{renderStatus(live)}</TableCell>
          <TableCell>
            {!managedBy ? (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                  >
                    <PiDotsThreeVertical size={16} />
                  </IconButton>
                }
                menuPlacement="end"
              >
                {canUpdateWebhook && live ? (
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
                {canUpdateWebhook ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setEditWebhookData({
                        id: snapshot.id,
                        name: snapshot.name,
                        endpoint: snapshot.endpoint,
                        httpMethod: snapshot.httpMethod,
                        headers: snapshot.headers,
                        payloadFormat: snapshot.payloadFormat,
                        payloadKey: snapshot.payloadKey,
                      })
                    }
                  >
                    Edit
                  </DropdownMenuItem>
                ) : null}
                {canDeleteWebhook ? (
                  <DropdownMenuItem
                    color="red"
                    confirmation={{
                      confirmationTitle: "Delete SDK Webhook",
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
  const renderAddWebhookButton = () => (
    <>
      <div className="text-muted mb-3">
        Refer to the{" "}
        <DocLink useRadix={false} docSection="sdkWebhooks">
          documentation
        </DocLink>{" "}
        for setup instructions
      </div>
      {canCreateWebhooks ? (
        <div className="d-flex align-items-center">
          <Tooltip
            body={
              disableWebhookCreate
                ? "You can only have one webhook per SDK Connection in the free plan"
                : ""
            }
          >
            <Button
              disabled={disableWebhookCreate}
              onClick={() => setCreateWebhookModalOpen(true)}
            >
              Add Webhook
            </Button>
          </Tooltip>
          <Tooltip
            body={
              <div style={{ lineHeight: 1.5 }}>
                <p className="mb-0">
                  <strong>SDK Webhooks</strong> will automatically notify any
                  changes affecting this SDK. For instance, modifying a feature
                  or AB test will prompt the webhook to fire.
                </p>
              </div>
            }
          >
            <span className="text-muted ml-2" style={{ fontSize: "0.75rem" }}>
              What is this? <FaInfoCircle />
            </span>
          </Tooltip>
        </div>
      ) : null}
    </>
  );

  const renderTable = () => {
    return (
      <div className="mb-2">
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Webhook</TableColumnHeader>
              <TableColumnHeader>Endpoint</TableColumnHeader>
              <TableColumnHeader>Method</TableColumnHeader>
              <TableColumnHeader style={{ width: 130 }}>
                Format
              </TableColumnHeader>
              <TableColumnHeader>Shared Secret</TableColumnHeader>
              <TableColumnHeader style={{ width: 125 }}>
                Last Success
              </TableColumnHeader>
              <TableColumnHeader style={{ width: 35 }} />
            </TableRow>
          </TableHeader>
          <TableBody>{renderTableRows()}</TableBody>
        </Table>
      </div>
    );
  };
  return (
    <div className="gb-sdk-connections-webhooks mb-5">
      <h2 className="mb-2">SDK Webhooks</h2>
      {selectedDraft && (
        <Callout status="info" mb="3">
          Showing the webhooks as staged in this draft. Changes here are added
          to the draft and apply when it is published.
        </Callout>
      )}
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
      {hasWebhooks && renderTable()}
      {renderAddWebhookButton()}
    </div>
  );
}
