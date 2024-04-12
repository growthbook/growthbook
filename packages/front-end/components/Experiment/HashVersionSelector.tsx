import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import { ReactNode } from "react";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import useSDKConnections from "@/hooks/useSDKConnections";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MinSDKVersions from "@/components/Features/MinSDKVersions";

export function HashVersionTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <>
          V2 fixes potential bias issues when using similarly named tracking
          keys, but is only supported in the following SDKs and versions:
          <MinSDKVersions capability="bucketingV2" />
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
