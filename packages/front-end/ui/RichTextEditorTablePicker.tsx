import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import Text from "@/ui/Text";
import styles from "./RichTextEditor.module.scss";

const MAX = 4;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A grid to choose a new table's rows and columns, the first row its header. */
export default function RichTextEditorTablePicker({
  onPick,
}: {
  onPick: (rows: number, columns: number) => void;
}) {
  const [size, setSize] = useState({ rows: 1, columns: 1 });
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
              aria-label={`${count(rows, "row")}, ${count(columns, "column")}`}
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
        {count(size.rows, "row")} × {count(size.columns, "column")}
      </Text>
    </Flex>
  );
}
