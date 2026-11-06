import { FC } from "react";
import ApiKeys from "@/components/Settings/ApiKeys";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SettingsPage, {
  SettingsNoAccess,
} from "@/components/Layout/SettingsPage";

const ApiKeysPage: FC = () => {
  const permissionsUtils = usePermissionsUtil();
  if (!permissionsUtils.canViewApiKeys()) {
    return <SettingsNoAccess title="API Keys" />;
  }

  return (
    <SettingsPage title="API Keys" hideHeader>
      <ApiKeys />
    </SettingsPage>
  );
};
export default ApiKeysPage;
