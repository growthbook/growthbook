import { ReactNode, useMemo } from "react";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  SDKCapability,
  getConnectionSDKCapabilities,
} from "shared/sdk-versioning";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import useSDKConnections from "@/hooks/useSDKConnections";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { Popover } from "@/ui/Popover";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";

export function IncompatibleSDKsPopover({
  connections,
  incompatibleConnections: incompatibleProp,
  capability,
  project,
  triggerText = "Show SDKs",
}: {
  connections: SDKConnectionInterface[];
  incompatibleConnections?: SDKConnectionInterface[];
  capability: SDKCapability;
  project?: string;
  triggerText?: string;
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
      trigger={<Link ml="2">{triggerText}</Link>}
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

interface BaseProps extends MarginProps {
  capability: SDKCapability;
  project?: string;
  connections?: SDKConnectionInterface[];
  icon?: ReactNode;
  popoverTriggerText?: string;
}

interface CalloutProps extends BaseProps {
  as?: "callout";
  status?: "info" | "warning" | "error";
  size?: "small" | "medium";
  someMessage: ReactNode;
  noneMessage: ReactNode;
}

interface HelperTextProps extends BaseProps {
  as: "helperText";
  status?: "info" | "warning" | "error";
  size?: "small" | "medium";
  someMessage: ReactNode;
  noneMessage: ReactNode;
}

interface PopoverProps extends BaseProps {
  as: "popover";
  someMessage?: never;
  noneMessage?: never;
}

type Props = CalloutProps | HelperTextProps | PopoverProps;

export default function SDKCapabilityWarning({
  capability,
  project,
  connections: connectionsProp,
  icon,
  popoverTriggerText,
  as: variant = "callout",
  ...rest
}: Props) {
  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = useMemo(
    () => connectionsProp ?? sdkConnectionsData?.connections ?? [],
    [connectionsProp, sdkConnectionsData?.connections],
  );

  const { hasSome, hasSomeIncompatible } = useMemo(() => {
    const filtered =
      project !== undefined
        ? connections.filter(
            (c) =>
              c.projects?.includes(project) || (c.projects ?? []).length === 0,
          )
        : connections;

    const supportingCount = filtered.filter((c) =>
      getConnectionSDKCapabilities(c).includes(capability),
    ).length;

    return {
      hasSome: supportingCount > 0,
      hasSomeIncompatible: supportingCount < filtered.length,
    };
  }, [connections, capability, project]);

  if (!hasSomeIncompatible) return null;

  const popover = (
    <IncompatibleSDKsPopover
      connections={connections}
      capability={capability}
      project={project}
      triggerText={popoverTriggerText}
    />
  );

  if (variant === "popover") return popover;

  const {
    someMessage,
    noneMessage,
    status: statusProp,
    size: sizeProp = "small",
    ...marginProps
  } = rest as Omit<
    CalloutProps | HelperTextProps,
    | "as"
    | "capability"
    | "project"
    | "connections"
    | "icon"
    | "popoverTriggerText"
  >;
  const status = statusProp ?? (hasSome ? "warning" : "error");
  const size = sizeProp === "small" ? "sm" : "md";
  const content = (
    <span>
      {hasSome ? someMessage : noneMessage}
      {popover}
    </span>
  );

  if (variant === "helperText") {
    return (
      <HelperText status={status} size={size} icon={icon} {...marginProps}>
        {content}
      </HelperText>
    );
  }

  return (
    <Callout status={status} size={size} icon={icon} {...marginProps}>
      {content}
    </Callout>
  );
}
