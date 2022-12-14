import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import ApiKeys from "@/components/Settings/ApiKeys";
import usePermissions from "@/hooks/usePermissions";

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
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <ApiKeys />
    </div>
  );
};
export default ApiKeysPage;
