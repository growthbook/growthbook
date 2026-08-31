import { FC } from "react";
import PersonalAccessTokenSettings from "@/components/Settings/PersonalAccessTokenSettings";
import MemberPersonalAccessTokens from "@/components/Settings/MemberPersonalAccessTokens";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

const ManagePersonalAccessTokensPage: FC = () => {
  const permissionsUtils = usePermissionsUtil();
  if (
    !permissionsUtils.canManageOrgSettings() &&
    !permissionsUtils.canDeleteApiKey()
  ) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <h1>Personal Access Tokens</h1>
      <Text as="p" color="text-mid" mb="4">
        Personal access tokens act as the member who created them and carry
        their full permissions. Manage who can create them and revoke any that
        are compromised.
      </Text>

      <PersonalAccessTokenSettings />
      <MemberPersonalAccessTokens />

      <Callout status="info" mb="4">
        Create tokens for your own account on the{" "}
        <Link href="/account/personal-access-tokens">
          Personal Access Tokens
        </Link>{" "}
        page, or manage organization-wide keys under{" "}
        <Link href="/settings/keys">API Keys</Link>.
      </Callout>
    </div>
  );
};
export default ManagePersonalAccessTokensPage;
