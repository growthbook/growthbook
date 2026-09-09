import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import SortedTags from "@/components/Tags/SortedTags";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";

export const OPTION_LABEL_MAX_WIDTH = 200;
const TOOLTIP_MAX_WIDTH = 280;

export type OptionContext = "menu" | "value";

export function useProjectNames(ids?: string[]): string[] {
  const { getProjectById } = useDefinitions();
  return (ids ?? []).map((id) => getProjectById(id)?.name || id);
}

export function OptionTooltipShell({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Flex
      direction="column"
      gap="2"
      style={{ minWidth: 0, maxWidth: TOOLTIP_MAX_WIDTH }}
    >
      <Link href={href} target="_blank" weight="bold" size="md">
        <span style={{ overflowWrap: "anywhere" }} className="mr-1">
          {title}
        </span>
        <PiArrowSquareOut />
      </Link>
      {children}
    </Flex>
  );
}

export function OptionTooltipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Text size="sm" as="div">
      <Text size="sm" as="span" weight="semibold">
        {label}{" "}
      </Text>
      {children}
    </Text>
  );
}

export function OptionTooltipSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Text size="sm" as="div" weight="semibold">
        {label}
      </Text>
      {children}
    </div>
  );
}

export function OptionTooltipProjectsRow({ names }: { names: string[] }) {
  return (
    <OptionTooltipRow label={names.length === 1 ? "Project:" : "Projects:"}>
      {names.length ? names.join(", ") : "All Projects"}
    </OptionTooltipRow>
  );
}

export function OptionTooltipTags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <OptionTooltipSection label="Tags:">
      <SortedTags
        tags={tags}
        shouldShowEllipsis={true}
        showEllipsisAtIndex={20}
        ellipsisFormat={(n) => `+${n}`}
      />
    </OptionTooltipSection>
  );
}

export function OptionTooltipDescription({
  description,
}: {
  description?: string;
}) {
  if (!description) return null;
  return (
    <OptionTooltipSection label="Description:">
      <div
        className="fade-mask-bottom-1rem"
        style={{ maxHeight: 120, overflow: "hidden", paddingBottom: "1rem" }}
      >
        <Markdown style={{ fontSize: 12 }}>{description}</Markdown>
      </div>
    </OptionTooltipSection>
  );
}

export function OptionPopover({
  context = "menu",
  content,
  children,
}: {
  context?: OptionContext;
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  const isValue = context === "value";
  return (
    <Popover
      openOnHover
      anchorOnly
      side={isValue ? "top" : "right"}
      sideOffset={8}
      trigger={
        <div
          style={{
            position: "relative",
            display: isValue ? "flex" : "block",
            alignItems: isValue ? "center" : undefined,
            minWidth: isValue ? undefined : 80,
            maxWidth: 400,
          }}
        >
          {children}
        </div>
      }
      content={content}
    />
  );
}

export function OptionLabel({
  label,
  style,
}: {
  label: string;
  style?: React.CSSProperties;
}) {
  return (
    <Text size="md">
      <OverflowText maxWidth={OPTION_LABEL_MAX_WIDTH} style={style}>
        {label}
      </OverflowText>
    </Text>
  );
}

export function OptionMenuRow({
  label,
  right,
  truncate = false,
  labelStyle,
}: {
  label: string;
  right?: React.ReactNode;
  truncate?: boolean;
  labelStyle?: React.CSSProperties;
}) {
  return (
    <Flex align="center" gap="3">
      {truncate ? (
        <OptionLabel label={label} style={labelStyle} />
      ) : (
        <Text size="md">
          <span style={labelStyle}>{label}</span>
        </Text>
      )}
      {right}
    </Flex>
  );
}

export function OptionProjectsLabel({
  names,
  extra,
}: {
  names: string[];
  extra?: React.ReactNode;
}) {
  if (!names.length && !extra) return null;
  return (
    <Flex ml="auto" flexShrink="0" align="center" style={{ fontSize: 11 }}>
      <Text size="inherit">
        {names.length > 0 && (
          <>
            <Text size="inherit" color="text-low">
              {names.length > 1 ? "Projects:" : "Project:"}
            </Text>{" "}
            <Text size="inherit" color="text-high">
              <OverflowText maxWidth={150}>{names.join(", ")}</OverflowText>
            </Text>
          </>
        )}
        {extra}
      </Text>
    </Flex>
  );
}
