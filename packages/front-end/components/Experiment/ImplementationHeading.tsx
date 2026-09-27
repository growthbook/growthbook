import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Text, { TextProps } from "@/ui/Text";

/** Labels one kind of implementation on the Setup page: flags, redirects, visual changes. */
export default function ImplementationHeading({
  children,
  action,
  subtext,
  inList = false,
  mt = "4",
  mb = "2",
}: {
  children: ReactNode;
  // Right-aligned on the heading's line.
  action?: ReactNode;
  // A muted line under the label.
  subtext?: ReactNode;
  // In a list whose gap already spaces it: pulled up under that gap instead.
  inList?: boolean;
  mt?: TextProps["mt"];
  mb?: TextProps["mb"];
}) {
  const heading = (
    <Text as="div" weight="medium" color="text-low" textTransform="uppercase">
      {children}
    </Text>
  );
  const label = subtext ? (
    <Flex direction="column" gap="1">
      {heading}
      {subtext}
    </Flex>
  ) : (
    heading
  );
  return (
    <Flex
      // With a subtext, the action sits on its line, at the bottom.
      align={subtext ? "end" : "center"}
      justify="between"
      gap="3"
      mt={inList ? "2" : mt}
      mb={inList ? "-2" : mb}
    >
      {label}
      {action}
    </Flex>
  );
}
