import { Flex, Text, TextProps } from "@radix-ui/themes";
import { forwardRef, ReactElement, ReactNode } from "react";
import {
  PiCheckCircleFill,
  PiInfoFill,
  PiLightbulb,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";

// "attention" is an orange severity tier between "warning" (amber) and "error"
// (red). It defaults to the error octagon icon and gets role="alert", but is
// recolored orange, for banners that should stand out more than a warning without
// reading as a hard error. Used by the rule-conflict "unreachable" banner and the
// rule approval-notes banner.
export type Status =
  | "wizard"
  | "info"
  | "warning"
  | "error"
  | "success"
  | "attention";
export type RadixColor = TextProps["color"];
export type Size = "sm" | "md";

export function getRadixColor(status: Status): TextProps["color"] {
  switch (status) {
    case "wizard":
      return "violet";
    case "info":
      return "violet";
    case "warning":
      return "amber";
    case "error":
      return "red";
    case "success":
      return "green";
    case "attention":
      return "orange";
  }
}

export function getRadixSize(size: Size): Responsive<"1" | "2"> {
  switch (size) {
    case "sm":
      return "1";
    case "md":
      return "2";
  }
}

function getIconSize(size: Size) {
  switch (size) {
    case "sm":
      return 13;
    case "md":
      return 15;
  }
}

export function RadixStatusIcon({
  status,
  size,
}: {
  status: Status;
  size: Size;
}): ReactElement {
  switch (status) {
    case "wizard":
      return <PiLightbulb size={getIconSize(size)} />;
    case "info":
      return <PiInfoFill size={getIconSize(size)} />;
    case "warning":
      return <PiWarningFill size={getIconSize(size)} />;
    case "error":
      return <PiWarningOctagonFill size={getIconSize(size)} />;
    case "success":
      return <PiCheckCircleFill size={getIconSize(size)} />;
    // Shares the error octagon: attention is error-shaped severity, only the
    // color differs (and callers can override the icon, e.g. a spinner).
    case "attention":
      return <PiWarningOctagonFill size={getIconSize(size)} />;
  }
}

export default forwardRef<
  HTMLDivElement,
  {
    children: string | string[] | ReactNode;
    status: Status;
    size?: "sm" | "md";
    icon?: ReactNode | null;
  } & MarginProps
>(function HelperText(
  { children, status, size = "md", icon, ...otherProps },
  ref,
) {
  const renderedIcon = (() => {
    if (icon === null) return null;
    if (icon !== undefined) return icon;
    return <RadixStatusIcon status={status} size={size} />;
  })();

  return (
    <Text color={getRadixColor(status)} size={getRadixSize(size)}>
      <Flex gap="1" {...otherProps} ref={ref}>
        {renderedIcon && (
          <div style={{ flex: "0 0 auto", position: "relative", top: -1.5 }}>
            {renderedIcon}
          </div>
        )}
        {children}
      </Flex>
    </Text>
  );
});
