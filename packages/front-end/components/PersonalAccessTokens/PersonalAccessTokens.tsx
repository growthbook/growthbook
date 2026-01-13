import React, { FC, useCallback, useMemo, useState } from "react";
import { FaKey } from "react-icons/fa";
import Link from "next/link";
import { ApiKeyInterface, SecretApiKey } from "shared/types/apikey";
import { ApiKeysTable } from "@/components/ApiKeysTable/ApiKeysTable";
import ApiKeysModal from "@/components/Settings/ApiKeysModal";
import { useAuth } from "@/services/auth";
import { groupApiKeysByType } from "@/services/secret-api-keys.utils";
import useApi from "@/hooks/useApi";

type PersonalAccessTokensProps = {
  accessTokens: ApiKeyInterface[];
  onDelete: (keyId: string | undefined) => () => Promise<void>;
  onReveal: (keyId: string | undefined) => () => Promise<string>;
  onCreate: () => void;
};

export const PersonalAccessTokens: FC<PersonalAccessTokensProps> = ({
  accessTokens,
  onDelete,
  onReveal,
  onCreate,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {open && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={onCreate}
          type="user"
        />
      )}

      <div className="mb-4">
        <h1>Personal Access Tokens</h1>
        <p className="text-gray">
          Personal Access Tokens have full read and write access to your
          account. Because of this, they must be kept secure and{" "}
          <strong>must not be exposed to others</strong>.
        </p>
        {accessTokens.length > 0 && (
          <ApiKeysTable
            onDelete={onDelete}
            keys={accessTokens}
            canCreateKeys
            canDeleteKeys
            onReveal={onReveal}
          />
        )}
        <button
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <FaKey /> Create New Personal Access Token
        </button>
      </div>

      <div className="mb-5">
        <div className="alert alert-info">
          Administrators can also create read-only keys for an organization on
          the <Link href="/settings/keys">API Keys</Link> page.
        </div>
      </div>
    </div>
  );
};

export const PersonalAccessTokensContainer = () => {
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");

  const userKeys = useMemo(() => {
    if (!data?.keys) return [];
    return groupApiKeysByType(data.keys).user;
  }, [data?.keys]);

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
    <PersonalAccessTokens
      onDelete={onDelete}
      accessTokens={userKeys}
      onCreate={mutate}
      onReveal={onReveal}
    />
  );
};
