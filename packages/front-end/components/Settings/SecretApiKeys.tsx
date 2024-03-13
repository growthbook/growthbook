import React, { FC, useCallback, useMemo, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import { FaKey } from "react-icons/fa";
import { useAuth } from "@front-end/services/auth";
import usePermissions from "@front-end/hooks/usePermissions";
import { ApiKeysTable } from "@front-end/components/ApiKeysTable/ApiKeysTable";
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

  const permissions = usePermissions();
  const canManageKeys = permissions.manageApiKeys;

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
        throw new Error("Could not load the secret key");
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
      {open && canManageKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          type={modalApiKeyType}
          secret={true}
        />
      )}

      <div>
        <h1>Secret API Keys</h1>
        <p className="text-gray">
          Secret keys have access to your organization. They{" "}
          <strong>must not be exposed to users</strong>.
        </p>
        {organizationSecretKeys.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={organizationSecretKeys}
            canManageKeys={canManageKeys}
            onReveal={onReveal}
          />
        )}
        {canManageKeys && (
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setModalApiKeyType("admin");
              setOpen(true);
            }}
          >
            <FaKey /> Create New Secret Key
          </button>
        )}
      </div>
    </div>
  );
};

export default SecretApiKeys;
