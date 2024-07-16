import { FaExclamationTriangle } from "react-icons/fa";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "@back-end/types/sdk-connection";
import Link from "next/link";
import { LEGACY_GROUP_SIZE_LIMIT } from "shared/util";
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

interface LargeSavedGroupSupportWarningPropsWithConnections {
  type: "saved_group_creation" | "targeting_rule";
  supportedConnections: SDKConnectionInterface[];
  unsupportedConnections: SDKConnectionInterface[];
}

interface LargeSavedGroupSupportWarningPropsWithoutConnections {
  type: "sdk_connection";
}

type LargeSavedGroupSupportWarningProps =
  | LargeSavedGroupSupportWarningPropsWithConnections
  | LargeSavedGroupSupportWarningPropsWithoutConnections;

export default function LargeSavedGroupSupportWarning(
  props: LargeSavedGroupSupportWarningProps
) {
  if (props.type === "sdk_connection") {
    return (
      <div className="alert alert-danger mt-2 p-3">
        <FaExclamationTriangle /> Some of the projects selected for this SDK
        Connection reference Large Saved Groups. You must select a language and
        version which supports the Large Saved Groups feature and enable it via
        the toggle below.
        <br />
        <strong>
          If you proceed, those saved groups will be treated as empty by this
          SDK Connection
        </strong>
      </div>
    );
  }

  if (props.unsupportedConnections.length === 0) return <></>;

  switch (props.type) {
    case "saved_group_creation":
      return (
        <>
          {props.supportedConnections.length > 0 ? (
            <div className="alert alert-warning mt-2 p-3">
              <FaExclamationTriangle /> Some of your SDK connections don&apos;t
              support saved groups with over {LEGACY_GROUP_SIZE_LIMIT} members.
              If this group is too large it won&apos;t be referencable in
              features or experiments used in those SDK connections.
            </div>
          ) : (
            <div className="alert alert-danger mt-2 p-3">
              <FaExclamationTriangle /> None of your SDK connections support
              saved groups with over {LEGACY_GROUP_SIZE_LIMIT} members. If you
              exceed this limit you won&apos;t be able to save your changes.
              <br></br>
              Try updating your{" "}
              <Link className="text-error-muted underline" href="/sdks">
                sdk connections
              </Link>{" "}
              and enabling the &quot;Large Saved Groups&quot; feature first.
            </div>
          )}
        </>
      );
    case "targeting_rule":
      return (
        <>
          {props.supportedConnections.length > 0 ? (
            <div className="alert alert-warning mt-2 p-3">
              <FaExclamationTriangle /> Some of your SDK connections don&apos;t
              support Large Saved Groups. This targeting rule will always
              evaluate users as <strong>not being in the group</strong> for the
              following SDK connections:
              <ul>
                {props.unsupportedConnections.map((conn) => (
                  <Link
                    className="text-warning-muted underline"
                    key={conn.id}
                    href={`/sdks/${conn.id}`}
                  >
                    {conn.id}
                  </Link>
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
