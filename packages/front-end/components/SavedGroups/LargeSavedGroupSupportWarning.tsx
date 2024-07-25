import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "@back-end/types/sdk-connection";
import Link from "next/link";
import { SMALL_GROUP_SIZE_LIMIT } from "shared/util";
import React from "react";
import { PiInfoFill, PiWarningFill } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";

interface LargeSavedGroupSupport {
  hasLargeSavedGroupFeature: boolean;
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
  unversionedConnections: SDKConnectionInterface[];
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
  const unversionedConnections: SDKConnectionInterface[] = [];
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  (connections || []).forEach((conn) => {
    if (!conn.sdkVersion || conn.sdkVersion === "0.0.0") {
      unversionedConnections.push(conn);
      return;
    }
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
    unversionedConnections,
  };
}

type LargeSavedGroupSupportWarningProps = LargeSavedGroupSupport & {
  type: "saved_group_creation" | "targeting_rule" | "in_use_saved_group";
  openUpgradeModal: () => void;
  upgradeWarningToError?: boolean;
};

export default function LargeSavedGroupSupportWarning({
  type,
  openUpgradeModal,
  hasLargeSavedGroupFeature,
  supportedConnections,
  unsupportedConnections,
  unversionedConnections,
  upgradeWarningToError,
}: LargeSavedGroupSupportWarningProps) {
  if (!hasLargeSavedGroupFeature) {
    return (
      <div className="alert alert-info-gb-purple mt-2 p-3">
        <PiInfoFill /> You must have an Enterprise plan to create lists with
        more than {SMALL_GROUP_SIZE_LIMIT} items.{" "}
        <span className="underline cursor-pointer" onClick={openUpgradeModal}>
          Upgrade&gt;
        </span>
      </div>
    );
  }
  if (
    unsupportedConnections.length === 0 &&
    unversionedConnections.length === 0
  )
    return <></>;

  const supportCertainty =
    unsupportedConnections.length > 0 ? "don't" : "might not";

  const warningLevel = upgradeWarningToError ? "danger" : "warning";
  const Icon = upgradeWarningToError ? <PiWarningFill /> : <PiInfoFill />;

  const containerClassName =
    type === "targeting_rule"
      ? `text-${warningLevel}-muted`
      : `alert alert-${warningLevel} mt-2 p-3`;

  const copy =
    type === "in_use_saved_group"
      ? "This saved group is being used in SDK connections that don't support lists with more than 100 items. Update impacted SDKs or reduce the number of list items to resolve."
      : `${
          supportedConnections.length > 0 || unversionedConnections.length > 0
            ? "Some of your"
            : "Your"
        } SDK connections ${supportCertainty} support lists with more than ${SMALL_GROUP_SIZE_LIMIT} items.`;

  return (
    <div className={containerClassName}>
      {Icon} {copy}{" "}
      <Link className={`text-${warningLevel}-muted underline`} href="/sdks">
        View SDKs&gt;
      </Link>
    </div>
  );
}
