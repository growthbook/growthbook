import { useMemo } from "react";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  SDKCapability,
  getConnectionSDKCapabilities,
} from "shared/sdk-versioning";
import { Popover } from "@/ui/Popover";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";

export default function IncompatibleSDKsPopover({
  connections,
  incompatibleConnections: incompatibleProp,
  capability,
  project,
}: {
  connections: SDKConnectionInterface[];
  incompatibleConnections?: SDKConnectionInterface[];
  capability: SDKCapability;
  project?: string;
}) {
  const incompatible = useMemo(() => {
    if (incompatibleProp) return incompatibleProp;
    const filtered =
      project !== undefined
        ? connections.filter(
            (c) =>
              c.projects?.includes(project) || (c.projects ?? []).length === 0,
          )
        : connections;
    return filtered.filter(
      (c) => !getConnectionSDKCapabilities(c).includes(capability),
    );
  }, [incompatibleProp, connections, capability, project]);

  if (!incompatible.length) return null;

  const formatLanguage = (c: SDKConnectionInterface) => {
    const lang = c.languages?.[0];
    const label = lang ? (languageMapping[lang]?.label ?? lang) : "Unknown";
    return c.sdkVersion ? `${label} v${c.sdkVersion}` : label;
  };

  return (
    <Popover
      trigger={<Link ml="2">Show SDKs</Link>}
      content={
        <div>
          <Text weight="semibold" size="small" mb="2" as="div">
            Incompatible SDKs:
          </Text>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {incompatible.map((c) => (
              <li key={c.id}>
                <Link href={`/sdks/${c.id}`} target="_blank" size="2">
                  {c.name || c.id}
                </Link>{" "}
                <Text size="small" color="text-mid">
                  — {formatLanguage(c)}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}
