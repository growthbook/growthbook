import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { parseIntWithDefault } from "shared/util";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";

export default function HashVersionSelector({
  value,
  onChange,
  project,
}: {
  value: 1 | 2;
  onChange: (value: 1 | 2) => void;
  project?: string;
}) {
  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <Text as="label" weight="semibold">
        Hashing Algorithm
      </Text>
      <RadioGroup
        options={[
          {
            label: "V2 (Preferred)",
            value: "2",
            description:
              "Fixes potential bias issues when using similarly named tracking keys",
            renderOnSelect: (
              <SDKCapabilityWarning
                capability="bucketingV2"
                project={project}
                someMessage="Some of your SDK Connections may not support V2 hashing."
                noneMessage="None of your SDK Connections support V2 hashing."
              />
            ),
          },
          { label: "V1 (Legacy)", value: "1" },
        ]}
        value={value + ""}
        setValue={(v) => {
          onChange(parseIntWithDefault(v, 2) as 1 | 2);
        }}
      />
    </div>
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
