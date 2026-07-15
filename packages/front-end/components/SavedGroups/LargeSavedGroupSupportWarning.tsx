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
  unsupportedConnections: SDKConnectionInterface[];
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
    connections,
  };
}

type LargeSavedGroupSupportWarningProps = LargeSavedGroupSupport & {
  openUpgradeModal?: () => void;
};

export default function LargeSavedGroupPerformanceWarning({
  openUpgradeModal,
  hasLargeSavedGroupFeature,
  unsupportedConnections,
  connections,
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
  if (unsupportedConnections.length === 0) return null;

  return (
    <Callout
      status="warning"
      mb="4"
      size="sm"
      dismissible={true}
      id="large-saved-group-support-warning"
    >
      <Box as="span">
        <Text mr="2">
          Enable &quot;Pass Saved Groups by reference&quot; on your SDK
          Connections to improve performance.
        </Text>
        <IncompatibleSDKsPopover
          connections={connections}
          incompatibleConnections={unsupportedConnections}
          capability="savedGroupReferences"
        />
      </Box>
    </Callout>
  );
}
