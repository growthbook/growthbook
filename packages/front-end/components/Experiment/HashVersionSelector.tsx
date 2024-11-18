import { ReactNode } from "react";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import RadioGroup from "@/components/Radix/RadioGroup";
import Callout from "@/components/Radix/Callout";

export function HashVersionTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <>
          V2版本修复了在使用类似命名的跟踪键时可能出现的偏差问题，但仅在以下软件开发工具包（SDK）及版本中受支持：
          <MinSDKVersionsList capability="bucketingV2" />
          不支持的SDK将自动回退到使用V1算法。
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
      <label>哈希算法</label>
      <RadioGroup
        options={[
          {
            label: "V2（首选）",
            value: "2",
            description: "修复了在使用类似命名的追踪KEY时可能出现的偏差问题",
            renderOnSelect: hasSDKWithNoBucketingV2 ? (
              <Callout status="warning" size="sm">
                您的一些SDK连接可能不支持V2哈希。请确保仅在与
                <HashVersionTooltip>
                  <span className="underline">兼容的SDK</span>
                </HashVersionTooltip>
                一起使用它。
              </Callout>
            ) : undefined,
          },
          { label: "V1（旧版）", value: "1" },
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
