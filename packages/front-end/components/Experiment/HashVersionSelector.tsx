import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import { ReactNode } from "react";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import useSDKConnections from "@front-end/hooks/useSDKConnections";
import SelectField from "@front-end/components/Forms/SelectField";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

export function NewBucketingSDKList() {
  return (
    <ul>
      <li>JavaScript &gt;= 0.23.0</li>
      <li>React &gt;= 0.12.0</li>
      <li>PHP &gt;= 1.2.0</li>
      <li>Ruby &gt;= 1.0.0</li>
      <li>Python &gt;= 1.0.0</li>
      <li>Java &gt;= 0.6.0</li>
      <li>Go &gt;= 0.1.4</li>
      <li>Kotlin - no support yet</li>
      <li>Swift - no support yet</li>
      <li>Flutter - no support yet</li>
      <li>C# - no support yet</li>
    </ul>
  );
}

export function HashVersionTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <>
          V2 fixes potential bias issues when using similarly named tracking
          keys, but is only supported in the following SDKs and versions:
          <NewBucketingSDKList />
          Unsupported SDKs will fall back to using the V1 algorithm
          automatically.
        </>
      }
    >
      {children}
    </Tooltip>
  );
}

export default function HashVersionSelector({
  value,
  onChange,
  project,
}: {
  value: 1 | 2;
  onChange: (value: 1 | 2) => void;
  project?: string;
}) {
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project
  );

  return (
    <>
      <SelectField
        label="Hashing Algorithm"
        options={[
          { label: "V1 (Legacy)", value: "1" },
          { label: "V2", value: "2" },
        ]}
        value={value + ""}
        onChange={(v) => {
          onChange((parseInt(v) || 2) as 1 | 2);
        }}
        helpText={
          <>
            V2 fixes potential bias issues when using similarly named tracking
            keys, but is only supported in{" "}
            <HashVersionTooltip>
              <span className="text-primary">
                some SDK versions <FaQuestionCircle />
              </span>
            </HashVersionTooltip>
            .
          </>
        }
      />

      {hasSDKWithNoBucketingV2 && (
        <div className="mt-2 alert alert-warning">
          <FaExclamationTriangle className="mr-1" />
          Some of your SDK Connections may not support V2 hashing. While V2
          hashing is preferred, please ensure you are only using it with
          compatible SDKs.
        </div>
      )}
    </>
  );
}

export function allConnectionsSupportBucketingV2(
  connections?: SDKConnectionInterface[],
  project?: string
) {
  if (!connections?.length) {
    // Don't warn if they haven't set up their SDK Connections yet
    return true;
  }
  return getConnectionsSDKCapabilities({
    connections: connections ?? [],
    mustMatchAllConnections: true,
    project,
  }).includes("bucketingV2");
}
