import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";

// Full-bleed amber strip for a Modal's `aboveFooterContent` slot: a warning
// message on the left, optional controls (an action button, then the
// "Acknowledge" checkbox that gates the CTA) on the right.
export default function ModalWarningBanner({
  children,
  controls,
  acknowledged,
  setAcknowledged,
}: {
  children: ReactNode;
  controls?: ReactNode;
  // With both, an "Acknowledge" checkbox follows the controls.
  acknowledged?: boolean;
  setAcknowledged?: (value: boolean) => void;
}) {
  const acknowledge =
    acknowledged !== undefined && setAcknowledged ? (
      <Box style={{ color: "var(--violet-11)" }}>
        <Checkbox
          value={acknowledged}
          setValue={setAcknowledged}
          label="Acknowledge"
          weight="medium"
          align="center"
        />
      </Box>
    ) : null;
  return (
    <Flex
      role="status"
      align="center"
      justify="between"
      gap="4"
      py="2"
      style={{
        // A host can widen the side inset to match its body padding.
        paddingInline: "var(--modal-warning-banner-inset, var(--space-4))",
        background: "var(--amber-a3)",
        borderTop: "1px solid var(--amber-a5)",
        borderBottom: "1px solid var(--amber-a5)",
      }}
    >
      <Flex align="center" gap="2" style={{ color: "var(--amber-11)" }}>
        <PiWarningFill size={15} style={{ flexShrink: 0 }} />
        <Text as="div">{children}</Text>
      </Flex>
      {controls || acknowledge ? (
        <Flex align="center" gap="4" flexShrink="0">
          {controls}
          {acknowledge}
        </Flex>
      ) : null}
    </Flex>
  );
}
