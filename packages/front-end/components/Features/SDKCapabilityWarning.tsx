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
import IncompatibleSDKsPopover from "./IncompatibleSDKsPopover";

interface BaseProps extends MarginProps {
  capability: SDKCapability;
  project?: string;
  connections?: SDKConnectionInterface[];
  icon?: ReactNode;
  size?: "sm" | "md";
}

interface CalloutProps extends BaseProps {
  as?: "callout";
  someMessage: ReactNode;
  noneMessage: ReactNode;
}

interface HelperTextProps extends BaseProps {
  as: "helperText";
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
  size = "sm",
  as: variant = "callout",
  ...rest
}: Props) {
  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = useMemo(
    () => connectionsProp ?? sdkConnectionsData?.connections ?? [],
    [connectionsProp, sdkConnectionsData?.connections],
  );

  const { hasSome, hasNone } = useMemo(() => {
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
      hasNone: supportingCount < filtered.length,
    };
  }, [connections, capability, project]);

  if (!hasNone) return null;

  const popover = (
    <IncompatibleSDKsPopover
      connections={connections}
      capability={capability}
      project={project}
    />
  );

  if (variant === "popover") return popover;

  const { someMessage, noneMessage, ...marginProps } = rest as Omit<
    CalloutProps | HelperTextProps,
    "as" | "capability" | "project" | "connections" | "icon" | "size"
  >;
  const status = hasSome ? "warning" : "error";
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
