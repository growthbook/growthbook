import clsx from "clsx";
import { ReactNode } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { DropdownMenu } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
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
  showingLive: boolean;
};

export type ImplementationColumn = {
  key: string;
  staged: boolean;
  render: (layout: ColumnLayout) => ReactNode;
};

export function CardHeaderDivider() {
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
}: {
  children: ReactNode;
  truncate?: boolean;
  muted?: boolean;
}) {
  return (
    <Text
      weight={muted ? "regular" : "medium"}
      color={muted ? "text-mid" : "text-high"}
      whiteSpace="nowrap"
      truncate={truncate}
    >
      {children}
    </Text>
  );
}

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
  problem?: string | null;
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
        {icon ? (
          <Flex flexShrink="0" style={{ color: "var(--color-text-low)" }}>
            {icon}
          </Flex>
        ) : null}
        {title ? (
          <Flex align="center" gap="1" minWidth="0">
            {title}
          </Flex>
        ) : null}
        {problem ? (
          <Tooltip content={problem}>
            <Flex flexShrink="0" style={{ color: "var(--amber-11)" }}>
              <PiWarningFill />
            </Flex>
          </Tooltip>
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
            {typeof kind === "string" ? (
              <span className={styles.headerType}>
                <Text size="sm" color="text-high" whiteSpace="nowrap">
                  {kind}
                </Text>
              </span>
            ) : (
              kind
            )}
            {kind && menu.length ? <CardHeaderDivider /> : null}
            {menu.length ? (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="1"
                    highContrast
                    aria-label={menuLabel}
                  >
                    <BsThreeDotsVertical size={14} />
                  </IconButton>
                }
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
    <Flex direction="column" gap="2">
      <HelperText status="info" size="sm">
        {children}
      </HelperText>
      <Flex justify="end">
        <Button variant="outline" size="sm" onClick={onUndo}>
          Undo
        </Button>
      </Flex>
    </Flex>
  );
}
