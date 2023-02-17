import Link from "next/link";
import React, { FC } from "react";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa";
import { EventWebHooksPage } from "@/components/EventWebHooks/EventWebHooksPage";
import usePermissions from "../../../hooks/usePermissions";

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

      <div className="mt-3">
        <EventWebHooksPage />
      </div>

      <div className="alert alert-info mt-5">
        Looking for SDK Webhooks? They have moved to the new{" "}
        <Link href="/sdks">
          <a>
            Features <FaAngleRight /> SDKs
          </a>
        </Link>{" "}
        tab. Also, make sure to check out the new{" "}
        <strong>SDK Connections</strong>, which makes it easier to sync feature
        changes from GrowthBook to your SDKs.
      </div>
    </div>
  );
};
export default WebhooksPage;
