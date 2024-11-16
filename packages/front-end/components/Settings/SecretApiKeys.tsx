import React, { FC, useCallback, useMemo, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import { useAuth } from "@/services/auth";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";
import ApiKeysModal from "./ApiKeysModal";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [modalApiKeyType, setModalApiKeyType] = useState<
    "readonly" | "admin" | "user" | undefined
  >();

  const permissionsUtils = usePermissionsUtil();
  const canCreateKeys = permissionsUtils.canCreateApiKey();
  const canDeleteKeys = permissionsUtils.canDeleteApiKey();

  const organizationSecretKeys = useMemo(
    () => keys.filter((k) => k.secret && !k.userId),
    [keys]
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
        throw new Error("无法加载密钥");
      }
      return res.key.key;
    },
    [apiCall]
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
    [mutate, apiCall]
  );

  return (
    <div className="mb-4">
      {open && canCreateKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          type={modalApiKeyType}
        />
      )}

      <div>
        <h1>API密钥</h1>
        <p className="text-gray">
          密钥可访问您的组织信息。{" "} <strong>绝不能暴露给用户</strong>。
        </p>
        {organizationSecretKeys.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={organizationSecretKeys}
            canCreateKeys={canCreateKeys}
            canDeleteKeys={canDeleteKeys}
            onReveal={onReveal}
          />
        )}
        {canCreateKeys && (
          <Button
            onClick={() => {
              setModalApiKeyType("admin");
              setOpen(true);
            }}
          >
            创建新的密钥
          </Button>
        )}
      </div>
    </div>
  );
};

export default SecretApiKeys;
