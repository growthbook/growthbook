import { Flex, Text, TextProps } from "@radix-ui/themes";
import { ReactElement } from "react";
import {
  PiCheckCircleFill,
  PiInfoFill,
  PiWarningFill,
  PiWarningOctagonFill,
} from "react-icons/pi";

export type Status = "info" | "warning" | "error" | "success";

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

export function RadixStatusIcon({ status }: { status: Status }): ReactElement {
  switch (status) {
    case "info":
      return <PiInfoFill />;
    case "warning":
      return <PiWarningFill />;
    case "error":
      return <PiWarningOctagonFill />;
    case "success":
      return <PiCheckCircleFill />;
  }
}

export default function HelperText({
  children,
  status,
}: {
  children: string;
  status: Status;
}) {
  return (
    <Text color={getRadixColor(status)}>
      <Flex align="center" gap="1">
        <RadixStatusIcon status={status} /> {children}
      </Flex>
    </Text>
  );
}
