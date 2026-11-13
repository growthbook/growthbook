import { PiCheck, PiCopy } from "react-icons/pi";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

type Props = {
  compact?: boolean;
  children?: string;
  className?: string;
  valueToCopy?: string;
  iconPosition?: "left" | "right";
};

export default function ClickToCopy({
  compact,
  children,
  className = "",
  valueToCopy,
  iconPosition = "left",
}: Props) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });
  const iconRight = iconPosition === "right";
  const copyButton = copySupported ? (
    <Tooltip content="Copy to clipboard">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          if (valueToCopy) {
            performCopy(valueToCopy);
          } else if (children) {
            performCopy(children);
          }
        }}
        aria-label="Copy to clipboard"
        style={{
          display: "inline-flex",
          padding: 0,
          border: 0,
          background: "none",
          color: "var(--gray-11)",
          fontSize: compact ? ".95rem" : "1rem",
          cursor: "pointer",
          ...(iconRight ? { marginLeft: 6 } : {}),
        }}
      >
        {copySuccess ? <PiCheck /> : <PiCopy />}
      </button>
    </Tooltip>
  ) : null;
  return (
    <Flex align="center" position="relative" className={className}>
      {!iconRight ? copyButton : null}
      {children ? (
        <Box
          as="span"
          ml={iconRight ? undefined : compact ? "2px" : "2"}
          style={compact ? { lineHeight: 1.1, fontSize: ".7rem" } : undefined}
        >
          <Text
            mono
            size={compact ? "inherit" : "sm"}
            color="text-high"
            overflowWrap="anywhere"
          >
            {children}
          </Text>
        </Box>
      ) : null}
      {iconRight ? copyButton : null}

      <VisuallyHidden role="status">
        {copySuccess ? "Copied" : ""}
      </VisuallyHidden>
      {copySuccess ? (
        <SimpleTooltip position="left">Copied to clipboard!</SimpleTooltip>
      ) : null}
    </Flex>
  );
}
