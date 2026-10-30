import clsx from "clsx";
import { ReactNode } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import { DropdownMenu, MoreMenuTrigger } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import HelperText, { getRadixColor, RadixStatusIcon } from "@/ui/HelperText";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./VariationValuesTable.module.scss";

export type ShownVariation = ReturnType<
  typeof getLatestPhaseVariations
>[number];

export type ColumnLayout = {
  column: number;
  last: boolean;
  firstValueRow: number;
  detailsRow: number;
  variations: ShownVariation[];
  // A warning about the whole table, given to one column to show.
  tableNote: string | null;
};

export type ImplementationColumn = {
  key: string;
  // What each variation gets from it, so the table can tell rows apart.
  served: Record<string, string>;
  render: (layout: ColumnLayout) => ReactNode;
};

function CardHeaderDivider() {
  return (
    <Box
      style={{ width: 1, alignSelf: "stretch", background: "var(--gray-a5)" }}
    />
  );
}

export function HeaderText({
  children,
  truncate = false,
  muted = false,
  small = false,
}: {
  children: ReactNode;
  truncate?: boolean;
  muted?: boolean;
  small?: boolean;
}) {
  return (
    <Text
      size={small ? "sm" : "md"}
      weight={muted ? "regular" : "medium"}
      color={muted ? "text-mid" : "text-high"}
      whiteSpace="nowrap"
      truncate={truncate}
    >
      {children}
    </Text>
  );
}

export function HeaderKind({ children }: { children: ReactNode }) {
  return (
    <span className={styles.headerType}>
      <Text size="sm" color="text-high" whiteSpace="nowrap">
        {children}
      </Text>
    </span>
  );
}

// As severe as the column's note about it.
export type ColumnProblem = {
  text: string;
  status: "error" | "warning" | "info";
};

export function ColumnHeader({
  layout,
  icon = null,
  title = null,
  problem = null,
  kind = null,
  menu = [],
  menuLabel,
}: {
  layout: ColumnLayout;
  icon?: ReactNode;
  title?: ReactNode;
  problem?: ColumnProblem | null;
  kind?: ReactNode;
  menu?: ReactNode[];
  menuLabel: string;
}) {
  const menuOnly = !kind && menu.length > 0;
  return (
    <div
      className={clsx(
        styles.headerCell,
        styles.columnHeader,
        layout.last && styles.lastColumn,
      )}
      style={{ gridRow: 1, gridColumn: layout.column }}
    >
      <Flex
        align="center"
        gap="2"
        width="100%"
        minWidth="0"
        className={clsx(menuOnly && styles.clearOfMenu)}
      >
        {problem ? (
          <Tooltip content={problem.text}>
            <Flex
              flexShrink="0"
              tabIndex={0}
              role="img"
              aria-label={problem.text}
              style={{
                color: `var(--${getRadixColor(problem.status)}-11)`,
              }}
            >
              <RadixStatusIcon status={problem.status} size="md" />
            </Flex>
          </Tooltip>
        ) : null}
        {icon ? (
          <Flex flexShrink="0" style={{ color: "var(--color-text-low)" }}>
            {icon}
          </Flex>
        ) : null}
        {title ? (
          <Flex align="baseline" gap="1" minWidth="0">
            {title}
          </Flex>
        ) : null}
        {kind || menu.length ? (
          <Flex
            align="center"
            gap="2"
            className={clsx(
              styles.revealOnHover,
              styles.headerActions,
              menuOnly && styles.menuOnly,
            )}
          >
            {typeof kind === "string" ? <HeaderKind>{kind}</HeaderKind> : kind}
            {kind && menu.length ? <CardHeaderDivider /> : null}
            {menu.length ? (
              <DropdownMenu
                trigger={<MoreMenuTrigger label={menuLabel} />}
                menuPlacement="end"
                variant="soft"
              >
                {menu}
              </DropdownMenu>
            ) : null}
          </Flex>
        ) : null}
      </Flex>
    </div>
  );
}

export function ColumnCell({
  layout,
  row,
  fieldLine = false,
  children,
}: {
  layout: ColumnLayout;
  row: number;
  fieldLine?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={clsx(styles.cell, layout.last && styles.lastColumn)}
      style={{ gridRow: layout.firstValueRow + row, gridColumn: layout.column }}
    >
      {fieldLine ? (
        <div className={styles.fieldLine}>{children}</div>
      ) : (
        children
      )}
    </div>
  );
}

export function ColumnFooter({
  layout,
  start = null,
  end = null,
  children,
}: {
  layout: ColumnLayout;
  start?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={clsx(styles.detailsCell, layout.last && styles.lastColumn)}
      style={{ gridRow: layout.detailsRow, gridColumn: layout.column }}
    >
      {start || end ? (
        <div className={styles.footerLine}>
          {start}
          <Box flexGrow="1" />
          {end}
        </div>
      ) : null}
      <Flex direction="column" gap="1" className={styles.footerMessages}>
        {children}
        {layout.tableNote ? (
          <HelperText status="warning" size="sm">
            {layout.tableNote}
          </HelperText>
        ) : null}
      </Flex>
    </div>
  );
}

export function StagedNote({
  children,
  onUndo,
}: {
  children: ReactNode;
  onUndo: () => void;
}) {
  return (
    <Flex align="center" gap="3">
      <Box flexGrow="1" minWidth="0">
        <HelperText status="info" size="sm">
          {children}
        </HelperText>
      </Box>
      <Box flexShrink="0">
        <Button variant="outline" size="sm" onClick={onUndo}>
          Undo
        </Button>
      </Box>
    </Flex>
  );
}
