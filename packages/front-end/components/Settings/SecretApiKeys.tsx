import React, { FC, useCallback, useMemo, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import ApiKeysModal from "./ApiKeysModal";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);

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

  return (
    <Box mb="4">
      {open && canCreateKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          personalAccessToken={false}
        />
      )}

      <Box>
        <Heading as="h1">Secret API Keys</Heading>
        <Box mb="3" style={{ color: "var(--gray-11)" }}>
          <p style={{ margin: 0 }}>
            Secret keys have access to your organization. They{" "}
            <strong>must not be exposed to users</strong>.
          </p>
        </Box>
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
              setOpen(true);
            }}
          >
            New Secret Key
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default SecretApiKeys;
