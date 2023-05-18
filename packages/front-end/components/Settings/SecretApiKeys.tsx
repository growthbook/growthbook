import React, { FC, useCallback, useMemo, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import { FaKey } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { groupApiKeysByType } from "@/services/secret-api-keys.utils";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import ApiKeysModal from "./ApiKeysModal";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [modalApiKeyType, setModalApiKeyType] = useState<string | undefined>();

  const permissions = usePermissions();
  const canManageKeys = permissions.manageApiKeys;

  const groupedKeys = useMemo(() => {
    return groupApiKeysByType(keys);
  }, [keys]);

  const secretKeys = groupedKeys.secret;
  const readOnlyKeys = groupedKeys.readonly;

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
    <div className="mb-5">
      {open && canManageKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          type={modalApiKeyType}
          secret={true}
        />
      )}

      {/* region Secret API keys */}
      <div className="mb-5">
        <h1>Secret API Keys</h1>
        <p>
          Secret keys have full read and write access to your organization.
          Because of this, they must be kept secure and{" "}
          <strong>must not be exposed to users</strong>.
        </p>
        {secretKeys.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={secretKeys}
            canManageKeys={canManageKeys}
            onReveal={onReveal}
          />
        )}
        {canManageKeys && (
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              // Secret API keys have no type
              setModalApiKeyType(undefined);
              setOpen(true);
            }}
          >
            <FaKey /> Create New Secret Key
          </button>
        )}
      </div>
      {/* endregion Secret API keys */}

      {/* region Read-only API keys */}
      <div className="mb-5">
        <h1>Read-only API Keys</h1>
        <p>Read-only API keys have read access to resources.</p>
        {readOnlyKeys.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={readOnlyKeys}
            canManageKeys={true}
            onReveal={onReveal}
          />
        )}
        {canManageKeys && (
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setModalApiKeyType("read-only");
              setOpen(true);
            }}
          >
            <FaKey /> Create New Read-only Key
          </button>
        )}
      </div>
      {/* endregion Read-only API keys */}
    </div>
  );
};

export default SecretApiKeys;
