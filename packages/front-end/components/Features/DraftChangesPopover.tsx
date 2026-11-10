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
  rows: { label: ReactNode; value: ReactNode }[];
};

const MARKS = {
  added: { Icon: PiPlus, color: "green" },
  removed: { Icon: PiMinus, color: "red" },
  edited: { Icon: PiTriangle, color: "amber" },
} as const;

// How the draft changes something: its icon in a tinted box, or spelled out
// beside it.
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

// Hovering a draft-changed marker previews what the draft changes. Clicks pass
// through to whatever holds it.
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
                      {/* A name of any length, cut short. */}
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
