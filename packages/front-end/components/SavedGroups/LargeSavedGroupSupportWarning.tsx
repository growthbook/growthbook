import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "@back-end/types/sdk-connection";
import Link from "next/link";
import { SMALL_GROUP_SIZE_LIMIT } from "shared/util";
import React from "react";
import { PiInfoFill } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";

export function useLargeSavedGroupSupport(
  project?: string
): {
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
  unversionedConnections: SDKConnectionInterface[];
} {
  const { data: sdkConnectionData } = useSDKConnections();
  let connections = sdkConnectionData?.connections || [];
  connections = connections.filter(
    // TODO: check that projects array being empty does include all projects
    (conn) =>
      conn.projects.length === 0 || conn.projects.includes(project || "")
  );
  const supportedConnections: SDKConnectionInterface[] = [];
  const unsupportedConnections: SDKConnectionInterface[] = [];
  const unversionedConnections: SDKConnectionInterface[] = [];

  (connections || []).forEach((conn) => {
    if (!conn.sdkVersion || conn.sdkVersion === "0.0.0") {
      unversionedConnections.push(conn);
      return;
    }
    if (getConnectionSDKCapabilities(conn).includes("savedGroupReferences")) {
      supportedConnections.push(conn);
    } else {
      unsupportedConnections.push(conn);
    }
  });
  return {
    supportedConnections,
    unsupportedConnections,
    unversionedConnections,
  };
}

type LargeSavedGroupSupportWarningProps = {
  type: "saved_group_creation" | "targeting_rule";
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
  unversionedConnections: SDKConnectionInterface[];
};

export default function LargeSavedGroupSupportWarning({
  type,
  supportedConnections,
  unsupportedConnections,
  unversionedConnections,
}: LargeSavedGroupSupportWarningProps) {
  if (
    unsupportedConnections.length === 0 &&
    unversionedConnections.length === 0
  )
    return <></>;

  const supportCertainty =
    unsupportedConnections.length > 0 ? "don't" : "might not";

  const containerClassName =
    type === "saved_group_creation"
      ? "alert alert-warning mt-2 p-3"
      : "text-warning-muted";

  return (
    <div className={containerClassName}>
      <PiInfoFill />{" "}
      {supportedConnections.length > 0 || unversionedConnections.length > 0
        ? "Some of your"
        : "Your"}{" "}
      SDK connections {supportCertainty} support lists with more than{" "}
      {SMALL_GROUP_SIZE_LIMIT} items.{" "}
      <Link className="text-warning-muted underline" href="/sdks">
        View SDKs&gt;
      </Link>
    </div>
  );
}
