import React from "react";
import { Box, Flex, Theme } from "@radix-ui/themes";
import Markdown from "@/components/Markdown/Markdown";
import SortedTags from "@/components/Tags/SortedTags";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

export interface AttributeOptionForTooltip {
  label: string;
  value: string;
  description?: string;
  tags?: string[];
  datatype?: string;
  hashAttribute?: boolean;
}

export function AttributeOptionTooltipContent({
  option,
}: {
  option: AttributeOptionForTooltip;
}) {
  return (
    <Box style={{ maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
      <Flex direction="column" gap="2" style={{ minWidth: 0 }}>
        <Box
          style={{
            minWidth: 0,
            overflow: "hidden",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          <Text size="small" as="div" weight="semibold">
            {option.label}
          </Text>
        </Box>
        {option.description && (
          <Flex direction="column" gap="1">
            <Text size="small" as="div" weight="semibold">
              Description:
            </Text>
            <Box>
              <Text size="small" as="div">
                <Markdown style={{ fontSize: 12 }}>
                  {option.description}
                </Markdown>
              </Text>
            </Box>
          </Flex>
        )}
        <Flex direction="column" gap="1">
          <Text size="small" as="div">
            <Text as="span" weight="semibold">
              Data type:{" "}
            </Text>
            {option.datatype ?? "unknown"}
          </Text>
          {option.hashAttribute === true && (
            <Text size="small" as="div" weight="semibold">
              Identifier
            </Text>
          )}
        </Flex>
        {option.tags && option.tags.length > 0 && (
          <Flex direction="column" gap="1">
            <Text size="small" as="div" weight="semibold">
              Tags:
            </Text>
            <Box>
              <SortedTags
                tags={option.tags}
                shouldShowEllipsis={true}
                showEllipsisAtIndex={20}
                ellipsisFormat={(n) => `+${n}`}
              />
            </Box>
          </Flex>
        )}
      </Flex>
    </Box>
  );
}

export function AttributeOptionWithTooltip({
  option,
  children,
}: {
  option: AttributeOptionForTooltip;
  children: React.ReactNode;
}) {
  const { theme } = useAppearanceUITheme();
  // Match app theme so text/tags use the same scale as tooltip bg (--surface-background-color)
  return (
    <Tooltip
      side="right"
      disableHoverableContent={false}
      content={
        <div data-attribute-option-tooltip>
          <Theme appearance={theme} hasBackground={false}>
            <AttributeOptionTooltipContent option={option} />
          </Theme>
        </div>
      }
    >
      <Box
        as="span"
        style={{
          display: "block",
          width: "100%",
          margin: "-2px -8px",
          padding: "2px 8px",
          minHeight: "100%",
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
