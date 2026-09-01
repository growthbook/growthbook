import React, { ReactElement, useState } from "react";
import {
  WebhookInterface,
  CreateSdkWebhookProps,
  UpdateSdkWebhookProps,
} from "shared/types/webhook";
import { FaCheck, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import { ago } from "shared/dates";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Revision, patchOpsToPartial } from "shared/enterprise";
import {
  sdkWebhookSnapshotValidator,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import EditSDKWebhooksModal, {
  CreateSDKWebhookModal,
} from "@/components/Settings/WebhooksModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
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

function toSnapshot(wh: WebhookInterface): SDKWebhookRevisionSnapshot {
  return sdkWebhookSnapshotValidator.parse(wh);
}

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
  const hasWebhooks = !!data?.webhooks?.length;
  const disableWebhookCreate =
    !canCreateWebhooks ||
    (hasWebhooks && !hasCommercialFeature("multiple-sdk-webhooks"));

  // Build the PUT URL to route a webhook change through the revision system.
  // If there's an existing open draft, append to it; otherwise create a new one.
  function buildRevisionUrl() {
    if (selectedRevision?.id) {
      return `/sdk-connections/${connection.id}?revisionId=${selectedRevision.id}`;
    }
    return `/sdk-connections/${connection.id}?forceCreateRevision=1`;
  }

  // Submit a sdkWebhooks array change through the revision system.
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

  // The base for a draft edit is the DRAFT's webhooks, not the live list. The
  // live list still shows `[]` while a draft adds its first webhook, so
  // rebuilding from it made each save replace the previous one — adding two
  // webhooks to a draft published only the second.
  const currentWebhookSnapshots = (): SDKWebhookRevisionSnapshot[] => {
    if (selectedRevision) {
      const proposed = patchOpsToPartial(
        selectedRevision.target.proposedChanges,
      ) as { sdkWebhooks?: SDKWebhookRevisionSnapshot[] };
      if (proposed.sdkWebhooks) return proposed.sdkWebhooks;
      const baseline = selectedRevision.target.snapshot as {
        sdkWebhooks?: SDKWebhookRevisionSnapshot[];
      };
      if (baseline?.sdkWebhooks) return baseline.sdkWebhooks;
    }
    return (data?.webhooks ?? []).map(toSnapshot);
  };

  // Override for CreateSDKWebhookModal when approvals are enabled.
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

  // Override for EditSDKWebhooksModal when approvals are enabled.
  const handleEditViaRevision = async (
    formData: UpdateSdkWebhookProps,
    id: string | undefined,
  ): Promise<void> => {
    const currentSnapshots = currentWebhookSnapshots();
    if (!id) {
      // No id — treat as a new webhook
      await handleCreateViaRevision(formData as CreateSdkWebhookProps);
      return;
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

  // Delete via revision — removes the webhook from the snapshot array.
  const handleDeleteViaRevision = async (webhookId: string): Promise<void> => {
    const currentSnapshots = currentWebhookSnapshots();
    await submitWebhookRevision(
      currentSnapshots.filter((s) => s.id !== webhookId),
    );
  };

  const renderTableRows = () => {
    // only render table if there is data to show
    return data?.webhooks?.map((webhook) => (
      <TableRow key={webhook.name}>
        <TableCell style={{ minWidth: 150 }}>
          <div>
            {webhook.name}
            {webhook.managedBy?.type ? (
              <div>
                <Badge
                  label={`Managed by ${capitalizeFirstLetter(
                    webhook.managedBy.type,
                  )}`}
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
          {webhook.managedBy?.type ? (
            <em className="text-muted">hidden</em>
          ) : (
            <code className="text-main small">{webhook.endpoint}</code>
          )}
        </TableCell>
        <TableCell>
          {webhook.managedBy?.type ? (
            <em className="text-muted">hidden</em>
          ) : (
            <span className="small">{webhook.httpMethod}</span>
          )}
        </TableCell>
        <TableCell>
          {webhook.managedBy?.type ? (
            <em className="text-muted">hidden</em>
          ) : (
            <span className="small">
              {payloadFormatLabels?.[webhook?.payloadFormat ?? "standard"]}
            </span>
          )}
        </TableCell>
        <TableCell>
          {webhook.signingKey && !webhook.managedBy?.type ? (
            <ClickToReveal
              valueWhenHidden="wk_abc123def456ghi789"
              getValue={async () => webhook.signingKey}
            />
          ) : (
            <em className="text-muted">hidden</em>
          )}
        </TableCell>
        <TableCell>
          {webhook.disabled ? (
            <Tooltip
              className="ml-1"
              innerClassName="pb-3"
              usePortal={true}
              body={
                <Callout key={webhook.id} status="error">
                  <div style={{ wordBreak: "break-all" }}>
                    Disabled after {webhook.consecutiveFailures} consecutive
                    failures.
                    {webhook.error ? (
                      <>
                        <br />
                        Last error: {webhook.error}
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
          ) : webhook.error ? (
            <Tooltip
              className="ml-1"
              innerClassName="pb-3"
              usePortal={true}
              body={
                <Callout key={webhook.id} status="error">
                  <div style={{ wordBreak: "break-all" }}>{webhook.error}</div>
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
          ) : webhook.lastSuccess ? (
            <Badge
              label={
                <>
                  <FaCheck className="mr-1" />
                  {ago(webhook.lastSuccess)}
                </>
              }
              color="green"
              variant="soft"
            />
          ) : (
            <Badge label="Never fired" color="gray" variant="soft" />
          )}
        </TableCell>
        <TableCell>
          {!webhook.managedBy?.type ? (
            <div className="col-auto mr-1">
              <MoreMenu useRadix={false}>
                {canUpdateWebhook ? (
                  <button
                    className="dropdown-item"
                    onClick={async () => {
                      await apiCall(`/sdk-webhooks/${webhook.id}/test`, {
                        method: "post",
                      });
                      mutate();
                    }}
                  >
                    Test
                  </button>
                ) : null}
                {canUpdateWebhook ? (
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditWebhookData(webhook);
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                {canDeleteWebhook ? (
                  <DeleteButton
                    useRadix={false}
                    className="dropdown-item"
                    displayName="SDK Connection"
                    text="Delete"
                    useIcon={false}
                    onClick={async () => {
                      if (approvalRequired) {
                        await handleDeleteViaRevision(webhook.id);
                      } else {
                        await apiCall(`/sdk-webhooks/${webhook.id}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }
                    }}
                  />
                ) : null}
              </MoreMenu>
            </div>
          ) : null}
        </TableCell>
      </TableRow>
    ));
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
  const isEmpty = data?.webhooks?.length === 0;
  return (
    <div className="gb-sdk-connections-webhooks mb-5">
      <h2 className="mb-2">SDK Webhooks</h2>
      {editWebhookData && (
        <EditSDKWebhooksModal
          close={() => setEditWebhookData(null)}
          onSave={mutate}
          current={editWebhookData}
          sdkConnectionId={connection.id}
          onOverrideSubmit={
            approvalRequired ? handleEditViaRevision : undefined
          }
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
            approvalRequired ? handleCreateViaRevision : undefined
          }
        />
      )}
      {!isEmpty && renderTable()}
      {renderAddWebhookButton()}
    </div>
  );
}
