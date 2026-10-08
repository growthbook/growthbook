import React, { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import OrganizationPoliciesCard from "./OrganizationPoliciesCard";

// Org-wide kill switch for user-minted API tokens, plus their expiration
// policy. The kill switch blocks creation AND rejects existing tokens at
// authentication, so there is no separate "revoke everything" action to run.
const PersonalAccessTokenSettings: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  // Same key as the member table, so SWR shares the request and a save refreshes both.
  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>(
    "/keys/personal-access-tokens",
    { shouldRun: () => permissionsUtil.canDeleteApiKey() },
  );

  return (
    <OrganizationPoliciesCard
      kind="pat"
      keys={data?.keys ?? []}
      mutate={mutate}
    />
  );
};

export default PersonalAccessTokenSettings;
