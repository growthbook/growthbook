import { CSSProperties, ReactNode, useRef } from "react";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { FeatureValueType } from "shared/types/feature";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import ScrollArea, { pinnedTo } from "@/ui/ScrollArea";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import styles from "./PrerequisiteTable.module.scss";

// Wide enough for an environment's name and its status, before they truncate.
const ENVIRONMENT_COLUMN_WIDTH = 96;
const TYPE_COLUMN_WIDTH = 80;
const DEFAULT_COLUMN_WIDTH = 160;

type PrerequisiteTableRow = {
  key: string | number;
  name: ReactNode;
  // Its type and default value, when the table shows them.
  details?: { valueType: FeatureValueType; defaultValue: ReactNode };
  // Its state in an environment; none leaves the cell empty.
  state?: (environment: string) => ReactNode;
};

// Cut short to its column, with the full name on hover when it is.
function EnvironmentColumnName({ env }: { env: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const truncated = useIsOverflowingX(ref);
  return (
    <Tooltip content={env} enabled={truncated}>
      <div
        ref={ref}
        className={styles.environmentColumnName}
        style={{ maxWidth: ENVIRONMENT_COLUMN_WIDTH - 16 }}
      >
        {env}
      </div>
    </Tooltip>
  );
}

// Prerequisite features down the side, pinned while their state in each
// environment scrolls under them.
export default function PrerequisiteTable({
  rows,
  environments,
  showDetails = false,
  nameWidth = 260,
}: {
  rows: PrerequisiteTableRow[];
  environments: string[];
  // Adds each one's type and default value, pinned with its name.
  showDetails?: boolean;
  nameWidth?: number;
}) {
  const pinned = [
    { width: nameWidth },
    ...(showDetails
      ? [{ width: TYPE_COLUMN_WIDTH }, { width: DEFAULT_COLUMN_WIDTH }]
      : []),
  ];
  // Each pinned column sticks beside the ones before it; the last casts the
  // shadow over what scrolls under.
  const pinnedCell = (
    i: number,
  ): { className: string; style: CSSProperties } => ({
    className: clsx(styles.pinned, i === pinned.length - 1 && pinnedTo.left),
    style: {
      left: pinned.slice(0, i).reduce((sum, c) => sum + c.width, 0),
      width: pinned[i].width,
    },
  });
  const pinnedWidth = pinned.reduce((sum, c) => sum + c.width, 0);
  return (
    <ScrollArea
      direction="horizontal"
      wheelScrollsSideways
      // The pinned columns shadow what scrolls under them; the far end fades.
      edgeCue="fade"
      skipEdges={["left"]}
    >
      {/* Its columns' width: stretched, they'd spread across the area. */}
      <div
        style={{
          width: pinnedWidth + environments.length * ENVIRONMENT_COLUMN_WIDTH,
        }}
      >
        <Table variant="ghost" size="sm" className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableColumnHeader {...pinnedCell(0)}>Feature</TableColumnHeader>
              {showDetails ? (
                <>
                  <TableColumnHeader {...pinnedCell(1)}>Type</TableColumnHeader>
                  <TableColumnHeader {...pinnedCell(2)}>
                    Default value
                  </TableColumnHeader>
                </>
              ) : null}
              {environments.map((env) => (
                <TableColumnHeader
                  key={env}
                  justify="center"
                  style={{ width: ENVIRONMENT_COLUMN_WIDTH }}
                >
                  <EnvironmentColumnName env={env} />
                </TableColumnHeader>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell {...pinnedCell(0)}>
                  <Flex align="center" gap="2" minWidth="0">
                    {row.name}
                  </Flex>
                </TableCell>
                {showDetails ? (
                  <>
                    <TableCell {...pinnedCell(1)}>
                      {row.details ? (
                        <Text color="text-mid">
                          {row.details.valueType === "json"
                            ? "JSON"
                            : row.details.valueType}
                        </Text>
                      ) : null}
                    </TableCell>
                    <TableCell {...pinnedCell(2)}>
                      {row.details?.defaultValue}
                    </TableCell>
                  </>
                ) : null}
                {environments.map((env) => (
                  <TableCell key={env} justify="center">
                    <Flex justify="center">{row.state?.(env)}</Flex>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ScrollArea>
  );
}
