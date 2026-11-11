import React from "react";
import clsx from "clsx";
import { Box, Card, Flex } from "@radix-ui/themes";
import { PiDotsSixVertical } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import CopyableCode from "@/components/Settings/CopyableCode";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import cornerStyles from "./CornerActions.module.scss";
import styles from "./RuleCard.module.scss";
import { useFeaturePageRedesign } from "./FeaturePageRedesign";

// A header row (title or actions) that keeps its place when the title grows a
// second line.
export const ruleHeaderRowClass = styles.headerRow;

// A rule card's ⋮, shown on hover with the card's other actions.
export const ruleRowMenuClass = clsx(cornerStyles.actions, styles.rowMenu);

// A rule card's Edit, in its header and shown on hover, as its ⋮ is.
export function RuleEditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cornerStyles.actions}
      onClick={onClick}
    >
      Edit
    </Button>
  );
}

// A rule card's id under its title, for "Show rule IDs".
export function RuleIdLine({ id }: { id: string }) {
  return (
    <Flex align="center" gap="1" mt="1">
      <Text size="sm" color="text-low">
        Rule ID:
      </Text>
      <Text size="sm">
        <CopyableCode value={id} muted />
      </Text>
    </Flex>
  );
}

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
  const redesign = useFeaturePageRedesign();
  const handle = dragHandleProps ? (
    <Tooltip content="Drag and drop to re-order rules">
      <div {...dragHandleProps} className={styles.grab}>
        <PiDotsSixVertical size={16} />
      </div>
    </Tooltip>
  ) : (
    <Box aria-hidden className={styles.idleHandle}>
      <PiDotsSixVertical size={16} />
    </Box>
  );
  const indexBadge = (
    <Badge
      label={<>{index}</>}
      radius="full"
      color="gray"
      className={styles.index}
    />
  );

  // The page it's tested against: header and details in one column.
  if (!redesign) {
    return (
      <Card className={styles.badges}>
        <div className={clsx(styles.sideBar, styles[sideColor])} />
        <Flex align="start" justify="between" gap="2" p="1">
          <Box className={styles.handle}>{handle}</Box>
          {indexBadge}
          <Box flexGrow="1" pr="2" minWidth="0">
            <Box mb="3">{header}</Box>
            {ribbon ? <Box mb="3">{ribbon}</Box> : null}
            {children}
          </Box>
        </Flex>
      </Card>
    );
  }

  // Its values' copy and fullscreen buttons show while it's hovered.
  return (
    <Card
      className={clsx(cornerStyles.hoverActions, styles.card, styles.badges)}
    >
      <div className={clsx(styles.sideBar, styles[sideColor])} />
      <Box px="2" pt="2" pb="4">
        <Flex align="start" gap="2" mb="2">
          <Flex align="center" gap="1" className={styles.leading}>
            <Flex
              align="center"
              className={clsx(cornerStyles.actions, styles.handle)}
            >
              {handle}
            </Flex>
            {indexBadge}
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
