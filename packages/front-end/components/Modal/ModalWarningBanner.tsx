import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import { getRadixColor, RadixStatusIcon } from "@/ui/HelperText";

// Full-bleed strip for a Modal's `aboveFooterContent` slot: a message on the
// left, optional controls (an action button, then the "Acknowledge" checkbox
// that gates the CTA) on the right. Amber for warnings, violet for info.
export default function ModalWarningBanner({
  children,
  status = "warning",
  controls,
  acknowledged,
  setAcknowledged,
}: {
  children: ReactNode;
  status?: "warning" | "info";
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
  // The same colors and icons Callout and HelperText use for a status.
  const color = getRadixColor(status);
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
        background: `var(--${color}-a3)`,
        borderTop: `1px solid var(--${color}-a5)`,
        borderBottom: `1px solid var(--${color}-a5)`,
      }}
    >
      <Flex align="center" gap="2" style={{ color: `var(--${color}-11)` }}>
        <Flex flexShrink="0">
          <RadixStatusIcon status={status} size="md" />
        </Flex>
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
