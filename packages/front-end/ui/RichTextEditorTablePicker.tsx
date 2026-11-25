import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import Text from "@/ui/Text";
import styles from "./RichTextEditor.module.scss";

const MAX = 4;

/** A grid to choose a new table's rows and columns, the first row its header. */
export default function RichTextEditorTablePicker({
  onPick,
}: {
  onPick: (rows: number, columns: number) => void;
}) {
  const { t } = useLingui();
  const rowCount = (n: number) => (n === 1 ? t`${n} row` : t`${n} rows`);
  const columnCount = (n: number) =>
    n === 1 ? t`${n} column` : t`${n} columns`;
  const [size, setSize] = useState({ rows: 1, columns: 1 });
  const sizeRows = size.rows;
  const sizeColumns = size.columns;
  return (
    <Flex
      direction="column"
      align="center"
      gap="2"
      className={styles.tablePickerBody}
    >
      <div className={styles.tablePicker}>
        {Array.from({ length: MAX * MAX }, (_, i) => {
          const rows = Math.floor(i / MAX) + 1;
          const columns = (i % MAX) + 1;
          return (
            <button
              key={i}
              type="button"
              aria-label={`${rowCount(rows)}, ${columnCount(columns)}`}
              className={clsx(
                styles.tablePickerCell,
                rows <= size.rows &&
                  columns <= size.columns &&
                  styles.tablePickerCellOn,
              )}
              onMouseEnter={() => setSize({ rows, columns })}
              onFocus={() => setSize({ rows, columns })}
              onClick={() => onPick(rows, columns)}
            />
          );
        })}
      </div>
      <Text size="sm" color="text-mid">
        <Trans>
          <Plural value={sizeRows} one="# row" other="# rows" /> ×{" "}
          <Plural value={sizeColumns} one="# column" other="# columns" />
        </Trans>
      </Text>
    </Flex>
  );
}
