import { FC } from "react";
import PersonalAccessTokenSettings from "@/components/Settings/PersonalAccessTokenSettings";
import MemberPersonalAccessTokens from "@/components/Settings/MemberPersonalAccessTokens";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import SettingsPage, {
  SettingsNoAccess,
} from "@/components/Layout/SettingsPage";

const ManagePersonalAccessTokensPage: FC = () => {
  const permissionsUtils = usePermissionsUtil();
  if (
    !permissionsUtils.canManageOrgSettings() &&
    !permissionsUtils.canManagePersonalAccessTokens()
  ) {
    return <SettingsNoAccess title="Manage PATs" />;
  }

  return (
    <SettingsPage
      title="Manage PATs"
      description="Personal access tokens act as the member who created them and carry their full permissions. Manage who can create them and how long they last, and disable any that are compromised."
    >
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
    </SettingsPage>
  );
};
export default ManagePersonalAccessTokensPage;
