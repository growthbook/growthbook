import React, { FC, useCallback, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { useAuth } from "@/services/auth";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import HistoryTable from "@/components/HistoryTable";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ApiKeysModal from "./ApiKeysModal";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKeyInterface | null>(null);
  const [auditLog, setAuditLog] = useState<{
    keyId?: string;
    keyName?: string;
  } | null>(null);

  const permissionsUtils = usePermissionsUtil();
  const canCreateKeys = permissionsUtils.canCreateApiKey();
  const canDeleteKeys = permissionsUtils.canDeleteApiKey();

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

  return (
    <div className="mb-4">
      {open && canCreateKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          personalAccessToken={false}
        />
      )}

      {editingKey && canCreateKeys && (
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

      <div>
        <Flex align="center" justify="between">
          <h1>Secret API Keys</h1>
          {canCreateKeys && (
            <Link onClick={() => setAuditLog({})}>Audit logs</Link>
          )}
        </Flex>
        <p className="text-gray">
          Secret keys have access to your organization. They{" "}
          <strong>must not be exposed to users</strong>.
        </p>
        {organizationSecretKeys.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={organizationSecretKeys}
            canCreateKeys={canCreateKeys}
            canDeleteKeys={canDeleteKeys}
            onReveal={onReveal}
            onToggleDisabled={canDeleteKeys ? onToggleDisabled : undefined}
            onEdit={canCreateKeys ? (key) => setEditingKey(key) : undefined}
            onShowAuditLog={
              canCreateKeys
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
