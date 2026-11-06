import React from "react";
import clsx from "clsx";
import { Box, Card, Flex } from "@radix-ui/themes";
import { PiDotsSixVertical } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import cornerStyles from "./CornerActions.module.scss";
import styles from "./RuleCard.module.scss";

export type RuleCardSideColor =
  | "active"
  | "skipped"
  | "disabled"
  | "unreachable"
  | "removed";

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
    <Card className={clsx(cornerStyles.hoverActions, styles.card)}>
      <div className={clsx(styles.sideBar, styles[sideColor])} />
      <Box px="2" pt="2" pb="4">
        <Flex align="start" gap="2" mb="2">
          <Flex align="center" gap="1" className={styles.leading}>
            <Flex
              align="center"
              className={clsx(cornerStyles.actions, styles.handle)}
            >
              {dragHandleProps ? (
                <Tooltip content="Drag and drop to re-order rules">
                  <div {...dragHandleProps} className={styles.grab}>
                    <PiDotsSixVertical size={16} />
                  </div>
                </Tooltip>
              ) : (
                <Box aria-hidden className={styles.idleHandle}>
                  <PiDotsSixVertical size={16} />
                </Box>
              )}
            </Flex>
            <Badge
              label={<>{index}</>}
              radius="full"
              color="gray"
              className={styles.index}
            />
          </Flex>
          <Flex
            align="center"
            flexGrow="1"
            minWidth="0"
            className={styles.header}
          >
            <Box width="100%">{header}</Box>
          </Flex>
        </Flex>
        {ribbon ? (
          <div className={styles.ribbon}>{ribbon}</div>
        ) : (
          <div aria-hidden className={styles.divider} />
        )}
        <Box className={styles.body}>{children}</Box>
      </Box>
    </Card>
  );
}
