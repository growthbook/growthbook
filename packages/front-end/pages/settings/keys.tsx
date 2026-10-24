import { FC } from "react";
import ApiKeys from "@/components/Settings/ApiKeys";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import SettingsPage from "@/components/Layout/SettingsPage";

const ApiKeysPage: FC = () => {
  const permissionsUtils = usePermissionsUtil();
  if (!permissionsUtils.canViewApiKeys()) {
    return (
      <SettingsPage title="API Keys">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="API Keys" hideHeader>
      <ApiKeys />
    </SettingsPage>
  );
};
export default ApiKeysPage;
