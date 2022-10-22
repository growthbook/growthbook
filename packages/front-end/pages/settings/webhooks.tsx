import Link from "next/link";
import { FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import Webhooks from "../../components/Settings/Webhooks";
import usePermissions from "../../hooks/usePermissions";

const WebhooksPage: FC = () => {
  const permissions = usePermissions();

  if (!permissions.manageWebhooks) {
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
      <h1>Webhooks</h1>
      <Webhooks />
    </div>
  );
};
export default WebhooksPage;
