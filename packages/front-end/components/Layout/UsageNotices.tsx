import { FaExclamationTriangle } from "react-icons/fa";
import { useState } from "react";
import Link from "next/link";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UpgradeModal from "@/components/Settings/UpgradeModal";

export default function UsageNotices() {
  const permissionsUtil = usePermissionsUtil();
  const { usage } = useUser();
  const [upgradeModal, setUpgradeModal] = useState(false);

  const usageSpan = permissionsUtil.canViewUsage() ? (
    <Link href="/settings/usage">cdn usage</Link>
  ) : (
    <span>cdn usage</span>
  );

  let message: JSX.Element | undefined;
  if (usage?.cdn.status === "approaching") {
    message = (
      <Tooltip
        body={
          <>
            You are approaching your {usageSpan} limit.{" "}
            <a href="#" onClick={() => setUpgradeModal(true)}>
              Upgrade your plan
            </a>{" "}
            to avoid disruption.
          </>
        }
      >
        <div className="alert alert-warning py-1 px-2 mb-0 d-none d-md-block mr-1">
          <FaExclamationTriangle /> CDN usage limit approaching
        </div>
      </Tooltip>
    );
  } else if (usage?.cdn.status === "over") {
    message = (
      <Tooltip
        body={
          <>
            You have exceeded your {usageSpan} limit.{" "}
            <a href="#" onClick={() => setUpgradeModal(true)}>
              Upgrade your plan
            </a>{" "}
            to avoid disruption.
          </>
        }
      >
        <div className="alert alert-danger py-1 px-2 mb-0 d-none d-md-block mr-1">
          <FaExclamationTriangle /> CDN usage limit exceeded
        </div>
      </Tooltip>
    );
  }

  if (!message) {
    return null;
  } else {
    return (
      <div>
        {upgradeModal && (
          <UpgradeModal
            close={() => setUpgradeModal(false)}
            reason="To removed cdn usage limits,"
            source={
              usage?.cdn.status === "approaching"
                ? "usage-approaching"
                : "usage-exceeded"
            }
            commercialFeature="unlimited-cdn-usage"
          />
        )}
        {message}
      </div>
    );
  }
}
