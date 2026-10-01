import React, { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import SecretApiKeys from "./SecretApiKeys";
import PersonalAccessTokenSettings from "./PersonalAccessTokenSettings";
import OAuthAppsSettings from "./OAuthAppsSettings";

const ApiKeys: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  // OAuth Apps has its own permission, so a viewer may be here without access to secret keys.
  const canManageKeys =
    permissionsUtil.canCreateApiKey() || permissionsUtil.canDeleteApiKey();
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys", {
    shouldRun: () => canManageKeys,
  });
  const { settings } = useUser();

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (canManageKeys && !data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      {data && <SecretApiKeys keys={data.keys} mutate={mutate} />}

      <PersonalAccessTokenSettings />

      {!settings?.disablePersonalAccessTokens && (
        <Callout status="info" mb="4">
          You can also create{" "}
          <Link href="/account/personal-access-tokens">
            Personal Access Tokens
          </Link>{" "}
          for your user account
        </Callout>
      )}

      <OAuthAppsSettings />
    </>
  );
};

export default ApiKeys;
