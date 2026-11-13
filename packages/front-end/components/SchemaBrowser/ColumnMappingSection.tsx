import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import type { SourceTable } from "@/components/SchemaBrowser/useSourceTable";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Table, { TableBody } from "@/ui/Table";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";

export default function ColumnMappingSection({
  source,
  canRefresh,
  canRunQueries,
  columnsDetected,
  missingColumns,
  children,
  messages,
}: {
  source: SourceTable;
  /** Shows Refresh columns, for a saved query being edited. */
  canRefresh: boolean;
  canRunQueries: boolean;
  /** False while only the columns the saved mapping uses are known. */
  columnsDetected: boolean;
  /** Mapped columns the query no longer returns, with the role each fills. */
  missingColumns: { column: string; role: string }[];
  /** The mapping rows. */
  children: ReactNode;
  /** Shown under the table, e.g. the modal's own warnings. */
  messages?: ReactNode;
}) {
  return (
    <Box>
      <Flex align="center" justify="between" mb="2">
        <Text as="div" weight="semibold">
          Column mapping
        </Text>
        {canRefresh ? (
          <UITooltip
            content="You don't have permission to run test queries"
            enabled={!canRunQueries}
          >
            <span style={{ display: "inline-flex" }}>
              <Button
                size="sm"
                variant="ghost"
                icon={<PiArrowClockwise />}
                onClick={source.refreshSqlColumns}
                loading={source.refreshingSqlColumns}
                disabled={!canRunQueries || !source.querySql}
              >
                Refresh columns
              </Button>
            </span>
          </UITooltip>
        ) : null}
      </Flex>
      {!columnsDetected ? (
        <Callout status="info" mb="2">
          Only the columns this query already uses are listed.
          {canRunQueries
            ? " Refresh columns to see everything it returns."
            : ""}
        </Callout>
      ) : null}
      {source.refreshSqlError ? (
        <Callout status="error" mb="2">
          {source.refreshSqlError}
        </Callout>
      ) : null}
      {missingColumns.length > 0 ? (
        <Callout status="warning" mb="2">
          {`Your query no longer returns ${missingColumns
            .map(({ column, role }) => `"${column}" (${role})`)
            .join(", ")}. Select a new column for each.`}
        </Callout>
      ) : null}
      <Table size="sm" variant="surface" layout="fixed" mb="2">
        <TableBody>{children}</TableBody>
      </Table>
      {messages}
    </Box>
  );
}
