import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

/** A value such as a hash, ID or storage path, in monospace with a copy button. */
export default function CopyableValue({ value }: { value: string }) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1200,
  });
  return (
    <Flex align="start" gap="1">
      <Box minWidth="0">
        <Text mono overflowWrap="anywhere">
          {value}
        </Text>
      </Box>
      {copySupported && (
        <Tooltip content={copySuccess ? "Copied" : "Copy"}>
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            size="1"
            aria-label="Copy"
            onClick={(e) => {
              // Inside clickable rows, so don't let the click through
              e.stopPropagation();
              performCopy(value);
            }}
          >
            {copySuccess ? <PiCheck /> : <PiCopy />}
          </IconButton>
        </Tooltip>
      )}
    </Flex>
  );
}
