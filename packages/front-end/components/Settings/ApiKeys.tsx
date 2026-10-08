import React, { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import SecretApiKeys from "./SecretApiKeys";
import OrganizationPoliciesCard from "./OrganizationPoliciesCard";
import OAuthAppsSettings from "./OAuthAppsSettings";

const ApiKeys: FC = () => {
  const permissionsUtils = usePermissionsUtil();
  // OAuth Apps has its own permission, so a viewer may be here without access to secret keys.
  const canManageKeys =
    permissionsUtils.canCreateApiKey() || permissionsUtils.canDeleteApiKey();
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys", {
    shouldRun: () => canManageKeys,
  });
  const { settings } = useUser();
  const canManageTokens =
    permissionsUtils.canManageOrgSettings() ||
    permissionsUtils.canDeleteApiKey();

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (canManageKeys && !data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      {data && (
        <SecretApiKeys keys={data.keys} mutate={mutate}>
          {permissionsUtils.canDeleteApiKey() && (
            <OrganizationPoliciesCard
              kind="secret"
              keys={data.keys.filter((k) => k.secret && !k.userId)}
              mutate={mutate}
            />
          )}
        </SecretApiKeys>
      )}

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
              <Link href="/settings/personal-access-tokens">Manage PATs</Link>.
            </>
          )}
        </Callout>
      )}

      <OAuthAppsSettings />
    </>
  );
};

export default ApiKeys;
