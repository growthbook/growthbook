import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import Text from "@/ui/Text";

// Full-bleed amber strip for a Modal's `aboveFooterContent` slot: a warning
// message on the left, optional controls (confirm checkbox, action button) on
// the right.
export default function ModalWarningBanner({
  children,
  controls,
}: {
  children: ReactNode;
  controls?: ReactNode;
}) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="4"
      px="4"
      py="2"
      style={{
        background: "var(--amber-a3)",
        borderTop: "1px solid var(--amber-a5)",
        borderBottom: "1px solid var(--amber-a5)",
      }}
    >
      <Flex align="center" gap="2" style={{ color: "var(--amber-11)" }}>
        <PiWarningFill size={15} style={{ flexShrink: 0 }} />
        <Text as="div">{children}</Text>
      </Flex>
      {controls ? (
        <Flex align="center" gap="4" flexShrink="0">
          {controls}
        </Flex>
      ) : null}
    </Flex>
  );
}
