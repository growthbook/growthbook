import React, { FC, useCallback, useMemo, useState } from "react";
import { FaKey } from "react-icons/fa";
import Link from "next/link";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
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
        <h1>个人访问令牌（Token）</h1>
        <p className="text-gray">
          个人访问令牌对您的账户拥有完全的读写访问权限。因此，必须确保其安全性，并且
          <strong>绝不能向他人泄露</strong>。
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
          <FaKey /> 创建新的个人Token
        </button>
      </div>

      <div className="mb-5">
        <div className="alert alert-info">
          管理员还可以在<Link href="/settings/keys">API密钥管理</Link>中为组织创建只读密钥。
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
    <PersonalAccessTokens
      onDelete={onDelete}
      accessTokens={userKeys}
      onCreate={mutate}
      onReveal={onReveal}
    />
  );
};
