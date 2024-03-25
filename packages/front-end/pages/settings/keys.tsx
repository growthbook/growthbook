import { FC } from "react";
import ApiKeys from "@front-end/components/Settings/ApiKeys";
import usePermissions from "@front-end/hooks/usePermissions";

const ApiKeysPage: FC = () => {
  const permissions = usePermissions();
  if (!permissions.manageApiKeys) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <ApiKeys />
    </div>
  );
};
export default ApiKeysPage;
