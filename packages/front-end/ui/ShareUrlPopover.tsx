import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";
import styles from "./ShareUrlPopover.module.scss";

interface ShareUrlPopoverProps {
  trigger: React.ReactNode;
  url?: string;
  title: string;
  description?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export default function ShareUrlPopover({
  trigger,
  url,
  title,
  description,
  side = "bottom",
  align = "center",
}: ShareUrlPopoverProps) {
  const shareUrl =
    url ?? (typeof window !== "undefined" ? window.location.href : "");
  const { copySuccess, performCopy } = useCopyToClipboard({ timeout: 2000 });

  return (
    <Popover
      trigger={trigger}
      side={side}
      align={align}
      showCloseButton
      showArrow={false}
      contentStyle={{ padding: 0 }}
      contentClassName={styles.popoverContent}
      content={
        <Box className={styles.inner}>
          <Flex direction="column" gap="1" mb="5">
            <Heading as="h3" size="medium" color="text-high">
              {title}
            </Heading>
            {description && (
              <Text size="medium" color="text-mid">
                {description}
              </Text>
            )}
          </Flex>
          <Flex gap="2" align="center">
            <Box className={styles.urlField} title={shareUrl}>
              <Text size="medium" color="text-high">
                {shareUrl}
              </Text>
            </Box>
            <Button
              variant="outline"
              color="violet"
              size="md"
              icon={copySuccess ? <PiCheck /> : <PiCopy />}
              onClick={() => performCopy(shareUrl)}
            >
              {copySuccess ? "Copied!" : "Copy link"}
            </Button>
          </Flex>
        </Box>
      }
    />
  );
}
