import React from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { RiDraggable } from "react-icons/ri";
import Badge from "@/ui/Badge";
import cornerStyles from "./CornerActions.module.scss";
import styles from "./RuleCard.module.scss";

export type RuleCardSideColor =
  | "active"
  | "skipped"
  | "disabled"
  | "unreachable"
  | "removed";

const sideColorVar: Record<RuleCardSideColor, string> = {
  active: "var(--green-9)",
  skipped: "var(--amber-7)",
  disabled: "var(--gray-5)",
  unreachable: "var(--orange-7)",
  removed: "var(--red-7)",
};

// A rule header's row, which the handle and number center on: the height of
// its actions menu button.
const HEADER_HEIGHT = 28;
const HANDLE_WIDTH = 14;

interface Props {
  index: number;
  sideColor: RuleCardSideColor;
  // Spread onto the drag handle div (e.g. `useSortable`'s attributes +
  // listeners). When omitted, the column stays reserved but empty so
  // rule cards align in the same column whether draggable or not.
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  header: React.ReactNode;
  // Callouts shown as a full-width strip under the header.
  ribbon?: React.ReactNode;
  children: React.ReactNode;
}

export default function RuleCard({
  index,
  sideColor,
  dragHandleProps,
  header,
  ribbon,
  children,
}: Props) {
  // Its values' copy and fullscreen buttons show while it's hovered.
  return (
    <Card
      className={cornerStyles.hoverActions}
      style={{
        // The soft layer of the page tab bar's pinned shadow.
        boxShadow: "0 4px 4px var(--lift-shadow-far)",
        // Set below, so the header sits snug.
        padding: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "4px",
          backgroundColor: sideColorVar[sideColor],
        }}
      />
      <Box px="2" pt="2" pb="3">
        <Flex align="start" gap="2" mb="2">
          <Flex align="center" gap="1" style={{ height: HEADER_HEIGHT }}>
            <Flex
              align="center"
              className={cornerStyles.actions}
              style={{ width: HANDLE_WIDTH }}
            >
              {dragHandleProps ? (
                <div
                  {...dragHandleProps}
                  title="Drag and drop to re-order rules"
                  style={{ cursor: "grab" }}
                >
                  <RiDraggable size={16} />
                </div>
              ) : (
                <Box aria-hidden style={{ opacity: 0.25 }}>
                  <RiDraggable size={16} />
                </Box>
              )}
            </Flex>
            <Badge
              label={<>{index}</>}
              radius="full"
              color="gray"
              style={{ minWidth: 20 }}
            />
          </Flex>
          <Flex
            align="center"
            flexGrow="1"
            minWidth="0"
            style={{ minHeight: HEADER_HEIGHT }}
          >
            <Box width="100%">{header}</Box>
          </Flex>
        </Flex>
        {ribbon ? (
          <div className={styles.ribbon}>{ribbon}</div>
        ) : (
          // Across the card from beside the side bar, as a section box's is.
          <div
            aria-hidden
            style={{
              height: 1,
              margin: "0 calc(-1 * var(--space-2)) var(--space-3) -4px",
              backgroundColor: "var(--gray-a5)",
            }}
          />
        )}
        {/* Lined up with the index badge. */}
        <Box
          style={{
            paddingLeft: `calc(${HANDLE_WIDTH}px + var(--space-1))`,
          }}
        >
          {children}
        </Box>
      </Box>
    </Card>
  );
}
