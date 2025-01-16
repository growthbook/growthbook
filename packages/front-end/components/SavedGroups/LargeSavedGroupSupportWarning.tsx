import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import React from "react";
import { PiInfoFill } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import Link from "../Radix/Link";
import Callout from "../Radix/Callout";

interface LargeSavedGroupSupport {
  hasLargeSavedGroupFeature: boolean;
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
}

export function useLargeSavedGroupSupport(
  project?: string
): LargeSavedGroupSupport {
  const { hasCommercialFeature } = useUser();
  const { data: sdkConnectionData } = useSDKConnections();
  let connections = sdkConnectionData?.connections || [];
  connections = connections.filter(
    (conn) =>
      conn.projects.length === 0 || conn.projects.includes(project || "")
  );
  const supportedConnections: SDKConnectionInterface[] = [];
  const unsupportedConnections: SDKConnectionInterface[] = [];
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  (connections || []).forEach((conn) => {
    if (
      getConnectionSDKCapabilities(conn).includes("savedGroupReferences") &&
      conn.savedGroupReferencesEnabled
    ) {
      supportedConnections.push(conn);
    } else {
      unsupportedConnections.push(conn);
    }
  });
  return {
    hasLargeSavedGroupFeature,
    supportedConnections,
    unsupportedConnections,
  };
}

type LargeSavedGroupSupportWarningProps = LargeSavedGroupSupport & {
  style: "banner" | "text";
  openUpgradeModal?: () => void;
};

export default function LargeSavedGroupPerformanceWarning({
  openUpgradeModal,
  hasLargeSavedGroupFeature,
  unsupportedConnections,
}: LargeSavedGroupSupportWarningProps) {
  if (!hasLargeSavedGroupFeature) {
    return (
      <div className="alert alert-info-gb-purple mt-2 p-3">
        <PiInfoFill /> Performance improvements for Saved Groups are available
        with an Enterprise plan.
        {openUpgradeModal && (
          <>
            {" "}
            <span
              className="underline cursor-pointer"
              onClick={openUpgradeModal}
            >
              Upgrade &gt;
            </span>
          </>
        )}
      </div>
    );
  }
  if (unsupportedConnections.length === 0) return <></>;

  return (
    <Callout status="warning" mb="3">
      Enable &quot;Pass Saved Groups by reference&quot; to improve SDK
      performance. <Link href="/sdks">View SDKs</Link>
    </Callout>
  );
}
