import { ReactNode } from "react";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";

export function HashVersionTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <>
          V2 fixes potential bias issues when using similarly named tracking
          keys, but is only supported in the following SDKs and versions:
          <MinSDKVersionsList capability="bucketingV2" />
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
    project,
  );

  return (
    <>
      <label>Hashing Algorithm</label>
      <RadioGroup
        options={[
          {
            label: "V2 (Preferred)",
            value: "2",
            description:
              "Fixes potential bias issues when using similarly named tracking keys",
            renderOnSelect: hasSDKWithNoBucketingV2 ? (
              <Callout status="warning" size="sm">
                Some of your SDK Connections may not support V2 hashing. Make
                sure you are only using it with{" "}
                <HashVersionTooltip>
                  <span className="underline">compatible SDKs</span>
                </HashVersionTooltip>
                .
              </Callout>
            ) : undefined,
          },
          { label: "V1 (Legacy)", value: "1" },
        ]}
        value={value + ""}
        setValue={(v) => {
          onChange((parseInt(v) || 2) as 1 | 2);
        }}
      />
    </>
  );
}

export function allConnectionsSupportBucketingV2(
  connections?: SDKConnectionInterface[],
  project?: string,
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
