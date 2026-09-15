import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import React from "react";
import { Box } from "@radix-ui/themes";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import { IncompatibleSDKsPopover } from "@/components/Features/SDKCapabilityWarning";
import Text from "@/ui/Text";

interface LargeSavedGroupSupport {
  hasLargeSavedGroupFeature: boolean;
  // Cannot pass ID Lists by reference
  unsupportedConnections: SDKConnectionInterface[];
  // Cannot pass Condition Groups by reference. A superset of the above, since
  // v2 support implies v1 support.
  unsupportedConnectionsV2: SDKConnectionInterface[];
  connections: SDKConnectionInterface[];
}

export function useLargeSavedGroupSupport(
  project?: string,
): LargeSavedGroupSupport {
  const { hasCommercialFeature } = useUser();
  const { data: sdkConnectionData } = useSDKConnections();
  let connections = sdkConnectionData?.connections || [];
  connections = connections.filter(
    (conn) =>
      conn.projects.length === 0 || conn.projects.includes(project || ""),
  );
  const unsupportedConnections: SDKConnectionInterface[] = [];
  const unsupportedConnectionsV2: SDKConnectionInterface[] = [];
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  (connections || []).forEach((conn) => {
    const capabilities = getConnectionSDKCapabilities(conn);
    if (
      !capabilities.includes("savedGroupReferences") ||
      !conn.savedGroupReferencesEnabled
    ) {
      unsupportedConnections.push(conn);
    }
    if (
      !capabilities.includes("savedGroupReferencesV2") ||
      !conn.savedGroupReferencesEnabled
    ) {
      unsupportedConnectionsV2.push(conn);
    }
  });
  return {
    hasLargeSavedGroupFeature,
    unsupportedConnections,
    unsupportedConnectionsV2,
    connections,
  };
}

type LargeSavedGroupSupportWarningProps = LargeSavedGroupSupport & {
  openUpgradeModal?: () => void;
  // Which kind of Saved Group is being edited. Condition Groups need
  // savedGroupReferencesV2; ID Lists only need savedGroupReferences.
  type?: "list" | "condition";
};

export default function LargeSavedGroupPerformanceWarning({
  openUpgradeModal,
  hasLargeSavedGroupFeature,
  unsupportedConnections,
  unsupportedConnectionsV2,
  connections,
  type = "list",
}: LargeSavedGroupSupportWarningProps) {
  if (!hasLargeSavedGroupFeature) {
    return (
      <Callout status="info" mb="4" size="sm">
        Performance improvements for Saved Groups are available with an
        Enterprise plan.
        {openUpgradeModal && (
          <>
            {" "}
            <a role="button" onClick={openUpgradeModal}>
              Upgrade &gt;
            </a>
          </>
        )}
      </Callout>
    );
  }
  const isCondition = type === "condition";
  const incompatibleConnections = isCondition
    ? unsupportedConnectionsV2
    : unsupportedConnections;

  if (incompatibleConnections.length === 0) return null;

  return (
    <Callout
      status="warning"
      mb="4"
      size="sm"
      dismissible={true}
      id={
        isCondition
          ? "large-saved-group-support-warning-condition"
          : "large-saved-group-support-warning"
      }
    >
      <Box as="span">
        <Text mr="2">
          {isCondition
            ? 'Enable "Pass Saved Groups by reference" on your SDK Connections to improve performance. Condition Groups need a newer SDK version than ID Lists do.'
            : 'Enable "Pass Saved Groups by reference" on your SDK Connections to improve performance.'}
        </Text>
        <IncompatibleSDKsPopover
          connections={connections}
          incompatibleConnections={incompatibleConnections}
          capability={
            isCondition ? "savedGroupReferencesV2" : "savedGroupReferences"
          }
        />
      </Box>
    </Callout>
  );
}
