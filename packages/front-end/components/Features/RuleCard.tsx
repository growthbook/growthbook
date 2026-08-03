import React from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { RiDraggable } from "react-icons/ri";
import Badge from "@/ui/Badge";

// Shared visual chrome for `Rule` and `HoldoutRule`. Owns the outer
// Card + colored side bar + drag-handle slot + index badge + content
// flex column. Heading row, env badges, body, and modals stay in the
// per-rule callers.

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
  unreachable: "var(--amber-7)",
  removed: "var(--red-7)",
};

interface Props {
  index: number;
  sideColor: RuleCardSideColor;
  // Spread onto the drag handle div (e.g. `useSortable`'s attributes +
  // listeners). When omitted, the column stays reserved but empty so
  // rule cards align in the same column whether draggable or not.
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}

export default function RuleCard({
  index,
  sideColor,
  dragHandleProps,
  children,
}: Props) {
  return (
    <Card>
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
      <Flex align="start" justify="between" gap="2" p="1">
        <Box style={{ width: 14 }}>
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
        </Box>
        <Box>
          <Badge
            label={<>{index}</>}
            radius="full"
            color="gray"
            style={{ minWidth: 20 }}
          />
        </Box>
        <Box flexGrow="1" pr="2" style={{ maxWidth: "100%" }}>
          {children}
        </Box>
      </Flex>
    </Card>
  );
}
