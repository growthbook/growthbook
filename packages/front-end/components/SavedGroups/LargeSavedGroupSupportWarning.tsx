import { FaExclamationTriangle } from "react-icons/fa";
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

  (connections || []).forEach((conn) => {
    if (getConnectionSDKCapabilities(conn).includes("savedGroupReferences")) {
      supportedConnections.push(conn);
    } else {
      unsupportedConnections.push(conn);
    }
  });
  return { supportedConnections, unsupportedConnections };
}

type LargeSavedGroupSupportWarningProps = {
  type: "saved_group_creation" | "targeting_rule";
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
};

export default function LargeSavedGroupSupportWarning({
  type,
  supportedConnections,
  unsupportedConnections,
}: LargeSavedGroupSupportWarningProps) {
  if (unsupportedConnections.length === 0) return <></>;

  switch (type) {
    case "saved_group_creation":
      return (
        <div className="alert alert-warning mt-2 p-3">
          <PiInfoFill />{" "}
          {supportedConnections.length > 0 ? "Some of your" : "Your"} SDK
          connections don&apos;t support lists with more than{" "}
          {SMALL_GROUP_SIZE_LIMIT} items.{" "}
          <Link className="text-warning-muted underline" href="/sdks">
            View SDKs&gt;
          </Link>
        </div>
      );
    case "targeting_rule":
      return (
        <>
          {supportedConnections.length > 0 ? (
            <div className="alert alert-warning mt-2 p-3">
              <FaExclamationTriangle /> Some of your SDK connections don&apos;t
              support Large Saved Groups. This targeting rule will always
              evaluate users as <strong>not being in the group</strong> for the
              following SDK connections:
              {unsupportedConnections.map((conn) => (
                <React.Fragment key={conn.id}>
                  <br />
                  <Link
                    className="text-warning-muted underline"
                    href={`/sdks/${conn.id}`}
                  >
                    {conn.name}
                  </Link>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="alert alert-danger mt-2 p-3">
              <FaExclamationTriangle /> None the SDK connections for this
              targeting rule&apos;s project(s) support Large Saved Groups. Try
              updating your connections or use small saved groups only.
            </div>
          )}
        </>
      );
  }
}
