import React, { FC, useCallback, useMemo, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { useAuth } from "@/services/auth";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import ApiKeysModal from "./ApiKeysModal";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [editKey, setEditKey] = useState<ApiKeyInterface | null>(null);

  const permissionsUtils = usePermissionsUtil();
  const canCreateKeys = permissionsUtils.canCreateApiKey();
  const canUpdateKeys = permissionsUtils.canUpdateApiKey();
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
      {((open && canCreateKeys) || (editKey && canUpdateKeys)) && (
        <ApiKeysModal
          close={() => {
            setOpen(false);
            setEditKey(null);
          }}
          onCreate={mutate}
          personalAccessToken={false}
          existingKey={editKey ?? undefined}
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
            canCreateKeys={canCreateKeys}
            canDeleteKeys={canDeleteKeys}
            onReveal={onReveal}
            onToggleDisabled={canDeleteKeys ? onToggleDisabled : undefined}
            onEdit={canUpdateKeys ? setEditKey : undefined}
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
    </div>
  );
};

export default SecretApiKeys;
