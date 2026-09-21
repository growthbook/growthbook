import {
  getConnectionSDKCapabilities,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import React, { useState } from "react";
import { Box } from "@radix-ui/themes";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import { IncompatibleSDKsPopover } from "@/components/Features/SDKCapabilityWarning";
import UpgradeModal from "@/components/Settings/UpgradeModal";
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

/** True when every language on the Connection has a version with v2 support. */
function canSupportV2(conn: SDKConnectionInterface): boolean {
  const languages = conn.languages || [];
  if (!languages.length) return false;
  return languages.every(
    (lang) => !!getSDKCapabilityVersion(lang, "savedGroupReferencesV2"),
  );
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
    // A language with no version supporting the capability has nothing to
    // upgrade to, so there is nothing useful to say about it
    if (
      (!capabilities.includes("savedGroupReferencesV2") ||
        !conn.savedGroupReferencesEnabled) &&
      canSupportV2(conn)
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
  /**
   * Optional. Only for a caller that has to replace its own modal rather than
   * stack one on top. Everyone else gets the modal from here.
   */
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
  const [ownUpgradeModal, setOwnUpgradeModal] = useState(false);

  if (!hasLargeSavedGroupFeature) {
    return (
      <>
        {ownUpgradeModal && (
          <UpgradeModal
            close={() => setOwnUpgradeModal(false)}
            source="large-saved-groups"
            commercialFeature="large-saved-groups"
          />
        )}
        <Callout status="info" mb="4" size="sm">
          Performance improvements for Saved Groups are available with an
          Enterprise plan.{" "}
          <a
            role="button"
            onClick={openUpgradeModal ?? (() => setOwnUpgradeModal(true))}
          >
            Upgrade &gt;
          </a>
        </Callout>
      </>
    );
  }
  const isCondition = type === "condition";
  const incompatibleConnections = isCondition
    ? unsupportedConnectionsV2
    : unsupportedConnections;

  if (incompatibleConnections.length === 0) return null;

  // Two different causes land in the same list, and they need different advice.
  // A Connection with the setting off needs it turned on; one that has it on
  // and only lacks the capability needs an SDK upgrade.
  const needsSettingOn = incompatibleConnections.some(
    (conn) => !conn.savedGroupReferencesEnabled,
  );
  const needsUpgrade = incompatibleConnections.some(
    (conn) => conn.savedGroupReferencesEnabled,
  );

  const action =
    needsSettingOn && needsUpgrade
      ? 'Tip: upgrade your SDKs and enable "Pass Saved Groups by reference" to improve performance.'
      : needsUpgrade
        ? "Tip: upgrade your SDKs to improve performance."
        : 'Tip: enable "Pass Saved Groups by reference" on your SDK Connections to improve performance.';

  return (
    <Callout
      status="info"
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
          {action}
          {isCondition && needsUpgrade
            ? " Condition Groups need a newer SDK version than ID Lists do."
            : ""}
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
