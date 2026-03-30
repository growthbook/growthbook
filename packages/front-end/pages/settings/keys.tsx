import { FC } from "react";
import { Box } from "@radix-ui/themes";
import ApiKeys from "@/components/Settings/ApiKeys";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";

const ApiKeysPage: FC = () => {
  const permissionsUtils = usePermissionsUtil();
  if (
    !permissionsUtils.canCreateApiKey() &&
    !permissionsUtils.canDeleteApiKey()
  ) {
    return (
      <Box className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </Box>
    );
  }

  return (
    <Box className="container-fluid pagecontents">
      <ApiKeys />
    </Box>
  );
};
export default ApiKeysPage;
