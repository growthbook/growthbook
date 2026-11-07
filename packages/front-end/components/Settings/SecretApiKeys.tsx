import React, { FC, ReactNode, useCallback, useMemo, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { useAuth } from "@/services/auth";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import { RotatedApiKey } from "@/components/ApiKeysTable/RotateApiKeyModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import HistoryTable from "@/components/HistoryTable";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { SettingsPageHeader } from "@/components/Layout/SettingsPage";
import ApiKeysModal from "./ApiKeysModal";

// `children` renders between the intro and the key list, for controls that
// constrain the keys (expiration policy) and so belong above them.
const SecretApiKeys: FC<{
  keys: ApiKeyInterface[];
  mutate: () => void;
  children?: ReactNode;
}> = ({ keys, mutate, children }) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKeyInterface | null>(null);
  const [copyFrom, setCopyFrom] = useState<ApiKeyInterface | null>(null);
  const [auditLog, setAuditLog] = useState<{
    keyId?: string;
    keyName?: string;
  } | null>(null);

  const permissionsUtils = usePermissionsUtil();
  const canCreateKeys = permissionsUtils.canCreateApiKey();
  const canEditKeys = permissionsUtils.canUpdateApiKey();
  const canDeleteKeys = permissionsUtils.canDeleteApiKey();
  const canViewAuditLog = permissionsUtils.canViewApiKeys();

  const organizationSecretKeys = useMemo(
    () => keys.filter((k) => k.secret && !k.userId),
    [keys],
  );

  const onReveal = useCallback(
    (keyId: string | undefined) => async (): Promise<string> => {
      if (!keyId) return "";

      const res = await apiCall<{ key: SecretApiKey }>(`/keys/reveal`, {
        method: "POST",
        body: JSON.stringify({
          id: keyId,
        }),
      });
      if (!res.key.key) {
        throw new Error("Could not load the secret key");
      }
      return res.key.key;
    },
    [apiCall],
  );

  const onDelete = useCallback(
    (keyId: string) => async () => {
      if (!keyId) return;

      await apiCall(`/keys`, {
        method: "DELETE",
        body: JSON.stringify({
          id: keyId,
        }),
      });
      mutate();
    },
    [mutate, apiCall],
  );

  const onToggleDisabled = useCallback(
    (keyId: string | undefined, disabled: boolean) => async () => {
      if (!keyId) return;
      await apiCall(`/keys/${keyId}/disabled`, {
        method: "PUT",
        body: JSON.stringify({ disabled }),
      });
      mutate();
    },
    [apiCall, mutate],
  );

  const onRotate = useCallback(
    async (keyId: string, gracePeriodHours: number) => {
      const res = await apiCall<RotatedApiKey>(`/keys/${keyId}/rotate`, {
        method: "POST",
        body: JSON.stringify({ gracePeriodHours }),
      });
      mutate();
      return res;
    },
    [apiCall, mutate],
  );

  const onRevokePrevious = useCallback(
    async (keyId: string) => {
      await apiCall(`/keys/${keyId}/previous-key`, { method: "DELETE" });
      mutate();
    },
    [apiCall, mutate],
  );

  return (
    <div className="mb-4">
      {open && canCreateKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          personalAccessToken={false}
        />
      )}

      {editingKey && canEditKeys && (
        <ApiKeysModal
          close={() => setEditingKey(null)}
          onCreate={() => {
            setEditingKey(null);
            mutate();
          }}
          personalAccessToken={false}
          existingKey={editingKey}
        />
      )}

      {copyFrom && canCreateKeys && (
        <ApiKeysModal
          close={() => setCopyFrom(null)}
          onCreate={mutate}
          personalAccessToken={false}
          copyFrom={copyFrom}
          onDeleteCopySource={
            canDeleteKeys ? onDelete(copyFrom.id || "") : undefined
          }
        />
      )}

      <div>
        <SettingsPageHeader
          title="Secret API Keys"
          description={
            <>
              Secret keys have access to your organization. They{" "}
              <strong>must not be exposed to users</strong>.
            </>
          }
          actions={
            canViewAuditLog && (
              <Link onClick={() => setAuditLog({})}>Audit logs</Link>
            )
          }
        />
        {children}
        {organizationSecretKeys.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={organizationSecretKeys}
            canDeleteKeys={canDeleteKeys}
            onReveal={onReveal}
            onToggleDisabled={
              canDeleteKeys || canEditKeys ? onToggleDisabled : undefined
            }
            onEdit={canEditKeys ? (key) => setEditingKey(key) : undefined}
            onCopy={canCreateKeys ? setCopyFrom : undefined}
            onRotate={onRotate}
            onRevokePrevious={onRevokePrevious}
            onShowAuditLog={
              canViewAuditLog
                ? (key) =>
                    setAuditLog({ keyId: key.id, keyName: key.description })
                : undefined
            }
          />
        )}
        {canCreateKeys && (
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            New Secret Key
          </Button>
        )}
      </div>

      {auditLog && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header={
            auditLog.keyId
              ? `Audit Log: ${auditLog.keyName || auditLog.keyId}`
              : "Secret API Key Audit Log"
          }
          close={() => setAuditLog(null)}
          size="lg"
        >
          <HistoryTable
            type="apiKey"
            id={auditLog.keyId}
            showName={!auditLog.keyId}
            showType={!auditLog.keyId}
          />
        </ModalStandard>
      )}
    </div>
  );
};

export default SecretApiKeys;
