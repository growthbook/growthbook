import { Fragment, ReactNode } from "react";
import { PiMinus, PiPlus, PiTriangle } from "react-icons/pi";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import { draftStatusDotColor } from "@/components/Reviews/RevisionStatusBadge";
import StatusDot from "@/components/Experiment/StatusDot";
import styles from "./DraftChangesPopover.module.scss";

export type DraftChangeSection = {
  title: string;
  // `text` says the row in words, for screen readers.
  rows: { label: ReactNode; value: ReactNode; text: string }[];
};

const MARKS = {
  added: { Icon: PiPlus, color: "green" },
  removed: { Icon: PiMinus, color: "red" },
  edited: { Icon: PiTriangle, color: "amber" },
} as const;

export function DraftChangeMark({
  change,
  spelled = false,
}: {
  change: keyof typeof MARKS;
  spelled?: boolean;
}) {
  const { Icon, color } = MARKS[change];
  return spelled ? (
    <Badge
      size="xs"
      variant="soft"
      radius="small"
      color={color}
      label={
        <>
          <Icon size={11} aria-hidden />
          {change}
        </>
      }
    />
  ) : (
    <Avatar size="xs" variant="soft" radius="small" color={color}>
      <Icon size={11} aria-hidden />
      {/* Read out in place of the icon. */}
      <VisuallyHidden>{change}</VisuallyHidden>
    </Avatar>
  );
}

export default function DraftChangesPopover({
  sections,
  children,
}: {
  sections: DraftChangeSection[];
  children: ReactNode;
}) {
  return (
    <Popover
      openOnHover
      hoverDelay={350}
      anchorOnly
      side="top"
      align="start"
      sideOffset={5}
      // Above a row-wide click layer (CollapseTrigger's), which would take
      // the hover. As the anchor it's an atomic box an ellipsis around it
      // can't reach, so it shrinks to its room and cuts its own text short.
      trigger={
        <span style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {children}
          </span>
          {/* The hover can't be reached by keyboard or read out, so what it
              shows is said here instead. */}
          <VisuallyHidden>
            {` (${sections
              .flatMap((s) => s.rows.map((r) => r.text))
              .join(", ")} in this draft)`}
          </VisuallyHidden>
        </span>
      }
      contentStyle={{ maxWidth: 320, padding: 0 }}
      content={
        // Portaled, but React still bubbles its clicks to whatever holds the
        // marker: an accordion's toggle, a card's drilldown. It holds the
        // padding, so clicks there are caught too.
        <Flex
          direction="column"
          gap="3"
          style={{ padding: "15px 20px" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* The draft ribbon's own label color. */}
          <Flex align="center" style={{ gap: 6, color: "var(--amber-11)" }}>
            <StatusDot color={draftStatusDotColor("draft")} />
            <Text size="md" weight="medium">
              Draft changes:
            </Text>
          </Flex>
          {sections.map((s) => (
            <Box key={s.title}>
              <Text as="div" size="md" weight="medium" color="text-high" mb="1">
                {s.title}
              </Text>
              <div className={styles.rows}>
                {s.rows.map((r, i) => (
                  <Fragment key={i}>
                    <span className={styles.label}>
                      <Text color="text-high" truncate>
                        {r.label}
                      </Text>
                    </span>
                    <div className={styles.value}>
                      {typeof r.value === "string" ? (
                        <Text truncate>{r.value}</Text>
                      ) : (
                        r.value
                      )}
                    </div>
                  </Fragment>
                ))}
              </div>
            </Box>
          ))}
        </Flex>
      }
    />
  );
}
