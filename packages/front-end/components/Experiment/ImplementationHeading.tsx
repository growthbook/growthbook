import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

/** Labels one kind of implementation on the Setup page: flags, redirects, visual changes. */
export default function ImplementationHeading({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      // Pulled up under the gap of the list it sits in.
      mt="2"
      mb="-2"
    >
      <Text as="div" weight="medium" color="text-low" textTransform="uppercase">
        {children}
      </Text>
    </Flex>
  );
}
