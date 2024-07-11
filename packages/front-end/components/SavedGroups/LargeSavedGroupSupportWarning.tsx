import { FaExclamationTriangle } from "react-icons/fa";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "@back-end/types/sdk-connection";
import Link from "next/link";
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
    if (
      getConnectionSDKCapabilities(conn).includes("savedGroupReferences") &&
      conn.savedGroupReferencesEnabled
    ) {
      supportedConnections.push(conn);
    } else {
      unsupportedConnections.push(conn);
    }
  });
  return { supportedConnections, unsupportedConnections };
}

type LargeSavedGroupWarningType = "saved_group_creation" | "targeting_rule";

export default function LargeSavedGroupSupportWarning({
  type,
  supportedConnections,
  unsupportedConnections,
}: {
  type: LargeSavedGroupWarningType;
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
}) {
  if (unsupportedConnections.length === 0) return <></>;

  switch (type) {
    case "saved_group_creation":
      return (
        <>
          {supportedConnections.length > 0 ? (
            <div className="alert alert-warning mt-2 p-3">
              <FaExclamationTriangle /> Some of your SDK connections don&apos;t
              support Large Saved Groups. This group won&apos;t be referencable
              in features or experiments used in those SDK connections.
            </div>
          ) : (
            <div className="alert alert-danger mt-2 p-3">
              <FaExclamationTriangle /> None of your SDK connections support
              Large Saved Groups. Try updating your connections and enabling the
              feature, or use manual value entry instead
            </div>
          )}
        </>
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
              <ul>
                {unsupportedConnections.map((conn) => (
                  <li key={conn.id}>
                    {<Link href={`/sdks/${conn.id}`}>{conn.id}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="alert alert-danger mt-2 p-3">
              <FaExclamationTriangle /> None the SDK connections for this
              targeting rule&apos;s project(s) support Large Saved Groups. Try
              updating your connections and enabling the feature, or use legacy
              saved groups only.
            </div>
          )}
        </>
      );
  }
}
