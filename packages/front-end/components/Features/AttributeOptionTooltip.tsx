import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import SortedTags from "@/components/Tags/SortedTags";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";

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
    <Flex direction="column" gap="2" style={{ minWidth: 0, maxWidth: 280 }}>
      <Link
        href={`/attributes/${option.value}`}
        target="_blank"
        weight="bold"
        size="2"
      >
        <span style={{ overflowWrap: "anywhere" }} className="mr-1">
          {option.label}
        </span>
        <PiArrowSquareOut />
      </Link>
      <Text size="small" as="div">
        <Text size="small" as="span" weight="semibold">
          Type:{" "}
        </Text>
        {option.datatype ?? "unknown"}
      </Text>
      {option.hashAttribute === true && (
        <Text size="small" as="div" weight="semibold">
          Identifier
        </Text>
      )}
      {option.tags && option.tags.length > 0 && (
        <div>
          <Text size="small" as="div" weight="semibold">
            Tags:
          </Text>
          <SortedTags
            tags={option.tags}
            shouldShowEllipsis={true}
            showEllipsisAtIndex={20}
            ellipsisFormat={(n) => `+${n}`}
          />
        </div>
      )}
      {option.description && (
        <Flex direction="column" gap="1">
          <Text size="small" as="div" weight="semibold">
            Description:
          </Text>
          <Text size="small" as="div">
            <Markdown style={{ fontSize: 12 }}>{option.description}</Markdown>
          </Text>
        </Flex>
      )}
    </Flex>
  );
}

export function AttributeOptionWithTooltip({
  option,
  children,
}: {
  option: AttributeOptionForTooltip;
  children: React.ReactNode;
}) {
  return (
    <Tooltip
      body={<AttributeOptionTooltipContent option={option} />}
      tipPosition="right"
      usePortal
      flipTheme={false}
    >
      {/* Expand hit area to fill the full option row (bleeds into RS padding, restores with positive padding) */}
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
