import { Flex, Text, TextProps } from "@radix-ui/themes";
import { ReactElement } from "react";
import {
  PiCheckCircleFill,
  PiInfoFill,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { Responsive } from "@radix-ui/themes/dist/cjs/props";

export type Status = "info" | "warning" | "error" | "success";
export type RadixColor = TextProps["color"];
export type Size = "sm" | "md";

export function getRadixColor(status: Status): TextProps["color"] {
  switch (status) {
    case "info":
      return "violet";
    case "warning":
      return "amber";
    case "error":
      return "red";
    case "success":
      return "green";
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
    case "info":
      return <PiInfoFill size={getIconSize(size)} />;
    case "warning":
      return <PiWarningFill size={getIconSize(size)} />;
    case "error":
      return <PiWarningOctagonFill size={getIconSize(size)} />;
    case "success":
      return <PiCheckCircleFill size={getIconSize(size)} />;
  }
}

export default function HelperText({
  children,
  status,
  size = "md",
  ...otherProps
}: {
  children: string | string[];
  status: Status;
  size?: "sm" | "md";
} & MarginProps) {
  return (
    <Text color={getRadixColor(status)} size={getRadixSize(size)}>
      <Flex gap="1" {...otherProps}>
        <div style={{ flex: "0 0 auto", position: "relative", top: -1.5 }}>
          <RadixStatusIcon status={status} size={size} />
        </div>
        {children}
      </Flex>
    </Text>
  );
}
