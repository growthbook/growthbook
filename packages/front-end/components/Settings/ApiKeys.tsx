import React, { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import SecretApiKeys from "./SecretApiKeys";
import ApiKeyExpirationPolicy from "./ApiKeyExpirationPolicy";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { settings } = useUser();
  const permissionsUtils = usePermissionsUtil();
  const canManageTokens =
    permissionsUtils.canManageOrgSettings() ||
    permissionsUtils.canDeleteApiKey();

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <SecretApiKeys keys={data.keys} mutate={mutate} />

      <ApiKeyExpirationPolicy
        kind="secret"
        keys={data.keys.filter((k) => k.secret && !k.userId)}
        mutate={mutate}
      />

      {(!settings?.disablePersonalAccessTokens || canManageTokens) && (
        <Callout status="info" mb="4">
          {!settings?.disablePersonalAccessTokens && (
            <>
              You can also create{" "}
              <Link href="/account/personal-access-tokens">
                Personal Access Tokens
              </Link>{" "}
              for your user account.{" "}
            </>
          )}
          {canManageTokens && (
            <>
              Organization-wide token settings live under{" "}
              <Link href="/settings/personal-access-tokens">
                Personal Access Tokens
              </Link>
              .
            </>
          )}
        </Callout>
      )}
    </>
  );
};

export default ApiKeys;
