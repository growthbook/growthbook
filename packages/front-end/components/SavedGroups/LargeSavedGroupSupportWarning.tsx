import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import React from "react";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import Link from "@/components/Radix/Link";
import Callout from "@/components/Radix/Callout";

interface LargeSavedGroupSupport {
  hasLargeSavedGroupFeature: boolean;
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
  const unsupportedConnections: SDKConnectionInterface[] = [];
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  (connections || []).forEach((conn) => {
    if (
      !getConnectionSDKCapabilities(conn).includes("savedGroupReferences") ||
      !conn.savedGroupReferencesEnabled
    ) {
      unsupportedConnections.push(conn);
    }
  });
  return {
    hasLargeSavedGroupFeature,
    unsupportedConnections,
  };
}

type LargeSavedGroupSupportWarningProps = LargeSavedGroupSupport & {
  openUpgradeModal?: () => void;
};

export default function LargeSavedGroupPerformanceWarning({
  openUpgradeModal,
  hasLargeSavedGroupFeature,
  unsupportedConnections,
}: LargeSavedGroupSupportWarningProps) {
  if (!hasLargeSavedGroupFeature) {
    return (
      <Callout status="info">
        Performance improvements for Saved Groups are available with an
        Enterprise plan.
        {openUpgradeModal && (
          <>
            {" "}
            <Link onClick={openUpgradeModal}>Upgrade &gt;</Link>
          </>
        )}
      </Callout>
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
